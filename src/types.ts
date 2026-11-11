import { z } from 'zod';

import { MAX_IDENTITY_LENGTH, sanitizeIdentity } from './sanitize.js';

/**
 * Connector configuration, editable in the Logto Admin Console.
 *
 * Only settings that are genuinely required to run the connector safely are exposed. Every
 * optional field has a documented default, so an administrator only has to provide
 * `clientId` for the common case.
 */

/**
 * Base URL of the VK ID API.
 *
 * VK ID serves the same API from `https://id.vk.com` (canonical) and `https://id.vk.ru`
 * (same service, RU-facing host). The value is a single origin with no path, query or hash.
 * HTTPS is the default and what production should use. An explicit `http:` origin is accepted
 * because the origin is an administrator decision (a mirror, or a LAN test host): the connector
 * cannot know whether that host is trusted, only the person configuring it can. The risk is
 * documented in the README: over plain HTTP the access token, the authorization code and the PKCE
 * verifier travel unencrypted.
 */
export const apiBaseUrlGuard = z
  .string()
  .trim()
  .min(1)
  .superRefine((value, context) => {
    const url = (() => {
      try {
        return new URL(value);
      } catch {
        return undefined;
      }
    })();

    if (!url) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Must be an absolute URL.' });
      return;
    }

    if (url.username !== '' || url.password !== '') {
      // Credentials in the origin would be echoed into the timeout error message (which carries the
      // request URL) and would turn a typo into a credential leak. The origin is also sent on every
      // token and profile request, so there is no legitimate reason to embed them here.
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Must not contain credentials in the URL.',
      });
      return;
    }

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Must use http or https.',
      });
      return;
    }

    if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Must be an origin without path, query or hash.',
      });
    }
  });

/**
 * Scope string as accepted by VK ID: space-separated, lowercase ASCII scope tokens.
 * A malformed scope makes the authorize endpoint fail with a redirect error that is hard to
 * diagnose, so it is validated up front.
 */
export const scopeGuard = z
  .string()
  .trim()
  .min(1)
  .refine((value) => value.split(/\s+/).every((token) => /^[\w.:-]+$/.test(token)), {
    message: 'Scope must be a space-separated list of scope tokens.',
  });

export const vkidConfigGuard = z.object({
  /** VK ID application ID (a.k.a. client id). */
  clientId: z.string().trim().min(1),
  /**
   * VK ID *service* token ("Сервисный ключ доступа"), sent as the `service_token` POST parameter.
   *
   * Only confidential VK ID applications need it, and those additionally have to call from an
   * allow-listed egress IP address. VK ID has no `client_secret` parameter in its token exchange:
   * the "protected key" (`client_secret`) is only used by client-side SDKs, so it must never be
   * sent to the token endpoint.
   */
  serviceToken: z.string().trim().min(1).optional(),
  /** Requested scopes. Defaults to `vkid.personal_info`. */
  scope: scopeGuard.optional(),
  /**
   * Include the VK ID e-mail in the Logto profile. Disabled by default: Logto links an existing
   * account to a social identity by e-mail, and an unverified e-mail must never become a
   * cross-provider link target by accident.
   */
  syncEmail: z.boolean().optional(),
  /** Include the VK ID phone number in the Logto profile. Disabled by default, same reasoning. */
  syncPhone: z.boolean().optional(),
  /** Override the VK ID API origin (mirror host or the local mock server in tests). */
  apiBaseUrl: apiBaseUrlGuard.optional(),
  /** Network timeout for the VK ID token and user info endpoints, in milliseconds. */
  timeout: z.coerce.number().int().min(1000).max(60_000).optional(),
});

export type VkidConfig = z.infer<typeof vkidConfigGuard>;

/**
 * Parameters VK ID appends to the redirect URI on a successful authorization.
 *
 * `device_id` is issued by VK ID and must be replayed to the token endpoint; losing it makes the
 * code unexchangeable. `redirect_uri` is *not* part of the VK ID callback, which is why the
 * redirect URI has to be persisted in the Logto connector session during `getAuthorizationUri`.
 */
export const authorizationCallbackGuard = z.object({
  code: z.string().min(1),
  device_id: z.string().min(1),
  state: z.string().min(1).optional(),
});

export type AuthorizationCallback = z.infer<typeof authorizationCallbackGuard>;

/** A callback carrying `error` instead of `code` (user declined consent, misconfiguration, ...). */
export const authorizationErrorGuard = z.object({
  error: z.string().min(1),
  error_description: z.string().optional(),
  error_uri: z.string().optional(),
});

export type AuthorizationError = z.infer<typeof authorizationErrorGuard>;

/**
 * Token endpoint response.
 *
 * Only `access_token` is mandatory. VK ID omits `refresh_token` unless offline access is
 * requested, and `id_token` is not guaranteed for every application type, so requiring them
 * (as the upstream implementation did) rejects otherwise valid logins.
 */
export const tokenResponseGuard = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  id_token: z.string().min(1).optional(),
  expires_in: z.coerce.number().int().positive().optional(),
  /** VK ID returns the numeric VK user id here; some responses encode it as a string. */
  user_id: z.union([z.number().int(), z.string().min(1)]).optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

export type VkTokenResponse = z.infer<typeof tokenResponseGuard>;

/** `POST /oauth2/user_info` response envelope. */
export const vkUserGuard = z.object({
  /**
   * The stable VK user id. It becomes `SocialUserInfo.id`, i.e. the only value Logto uses to
   * recognise a returning social account, and it is stored and displayed verbatim. A value that is
   * not a short ASCII token (control characters, a newline, a bidi override, an unbounded string)
   * is rejected instead of being silently rewritten.
   */
  user_id: z
    .union([z.string(), z.number().int()])
    .transform((value) => String(value).trim())
    .superRefine((value, context) => {
      if (sanitizeIdentity(value) === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `VK user id must be 1-${MAX_IDENTITY_LENGTH} characters from [A-Za-z0-9._:-]`,
        });
      }
    }),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  patronymic: z.string().optional(),
  phone: z.string().optional(),
  avatar: z.string().optional(),
  email: z.string().optional(),
  sex: z.number().optional(),
  verified: z.boolean().optional(),
  birthday: z.string().optional(),
});

export type VkUser = z.infer<typeof vkUserGuard>;

export const userInfoResponseGuard = z.object({ user: vkUserGuard });

export type UserInfoResponse = z.infer<typeof userInfoResponseGuard>;

/**
 * PKCE verifier and request binding persisted in the Logto connector session.
 *
 * RFC 7636 §4.1: 43 to 128 characters from the unreserved set. The redirect URI and the original
 * `state` are stored next to the verifier, because the VK ID token endpoint requires both to be
 * replayed exactly as they were sent to the authorize endpoint - and neither is available to the
 * connector at callback time otherwise.
 *
 * The keys are namespaced with `vk_` so they can never collide with the session keys Logto core
 * writes itself (`state`, `redirectUri`, `connectorId`, ...), whose values the connector must not
 * overwrite.
 */
export const connectorSessionGuard = z.object({
  vk_code_verifier: z
    .string()
    .min(43)
    .max(128)
    .regex(/^[\w\-._~]+$/),
  vk_redirect_uri: z.string().min(1),
  vk_state: z.string().min(1),
});

export type VkidConnectorSession = z.infer<typeof connectorSessionGuard>;
