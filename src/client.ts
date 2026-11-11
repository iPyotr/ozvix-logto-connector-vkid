import { ConnectorError, ConnectorErrorCodes } from '@logto/connector-kit';

import {
  authorizationPath,
  defaultApiBaseUrl,
  defaultScope,
  defaultTimeout,
  tokenPath,
  userInfoPath,
} from './constant.js';
import { postForm, VkApiError, type FetchLike } from './http.js';
import { MAX_PROVIDER_ERROR_CODE_LENGTH, sanitizeProviderText } from './sanitize.js';
import {
  tokenResponseGuard,
  userInfoResponseGuard,
  type VkTokenResponse,
  type VkUser,
  type VkidConfig,
} from './types.js';

/**
 * Thin VK ID API client: authorization URL construction, code exchange and profile lookup.
 *
 * Keeping these as standalone functions (instead of closures over `getConfig`) makes every
 * request shape directly unit-testable without a running Logto instance.
 */

export type AuthorizationUrlOptions = {
  clientId: string;
  redirectUri: string;
  state: string;
  scope?: string | undefined;
  codeChallenge: string;
  apiBaseUrl?: string | undefined;
  /** Extra parameters, used by tests to exercise VK ID failure modes. */
  extraParams?: Record<string, string> | undefined;
};

/** Resolve the configured API origin, with the trailing slash stripped. */
export const resolveApiBaseUrl = (config?: Pick<VkidConfig, 'apiBaseUrl'>): string =>
  (config?.apiBaseUrl ?? defaultApiBaseUrl).replace(/\/+$/, '');

/**
 * Error payload built from a non-2xx VK ID response.
 *
 * VK ID does not standardise its error bodies, so `error` and `error_description` are provider text
 * of unknown shape and length. Both are sanitised and bounded here: Logto serialises this payload
 * into the error message and logs it, so an unbounded or control-character-laden description would
 * otherwise become a log-flooding vector.
 */
const providerErrorData = (error: VkApiError): Record<string, unknown> => {
  const errorCode = sanitizeProviderText(error.oauthError, MAX_PROVIDER_ERROR_CODE_LENGTH);
  const errorDescription = sanitizeProviderText(error.oauthErrorDescription);

  return {
    status: error.status,
    ...(errorCode !== undefined && { error: errorCode }),
    ...(errorDescription !== undefined && { error_description: errorDescription }),
  };
};

/**
 * Build the VK ID authorization URL.
 *
 * The request is a standard OAuth 2.1 authorization code request with PKCE (`S256`). `state` is
 * generated and verified by Logto core; the connector only forwards it. `response_type=code` is
 * explicit and no client secret is sent through the browser.
 */
export const buildAuthorizationUrl = ({
  clientId,
  redirectUri,
  state,
  scope,
  codeChallenge,
  apiBaseUrl,
  extraParams,
}: AuthorizationUrlOptions): string => {
  const url = new URL(
    `${(apiBaseUrl ?? defaultApiBaseUrl).replace(/\/+$/, '')}${authorizationPath}`,
  );

  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: scope ?? defaultScope,
    response_type: 'code',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  for (const [key, value] of Object.entries(extraParams ?? {})) {
    query.set(key, value);
  }

  url.search = query.toString();

  return url.toString();
};

export type ExchangeCodeOptions = {
  config: VkidConfig;
  code: string;
  deviceId: string;
  codeVerifier: string;
  redirectUri: string;
  state: string;
  fetchImpl?: FetchLike | undefined;
};

/**
 * Map a non-2xx VK ID response onto the connector error taxonomy.
 *
 * The two endpoints need different semantics: at the token endpoint any 4xx means the code, the
 * PKCE verifier, the redirect URI or the device id did not match the authorization request (VK
 * documents only a generic `404 NOT FOUND` for malformed exchanges), while at the profile endpoint
 * 401/403 mean the access token is invalid and 5xx is a provider failure.
 */
const toConnectorError = (error: VkApiError, endpoint: 'token' | 'userinfo'): ConnectorError => {
  if (endpoint === 'token') {
    return error.status >= 400 && error.status < 500
      ? new ConnectorError(ConnectorErrorCodes.SocialAuthCodeInvalid, providerErrorData(error))
      : new ConnectorError(ConnectorErrorCodes.General, {
          message: 'VK ID token endpoint rejected the request',
          ...providerErrorData(error),
        });
  }

  const code =
    error.status === 401 || error.status === 403
      ? ConnectorErrorCodes.SocialAccessTokenInvalid
      : ConnectorErrorCodes.General;

  return new ConnectorError(code, {
    message: 'VK ID user info endpoint rejected the request',
    ...providerErrorData(error),
  });
};

/**
 * Exchange an authorization code for tokens at `POST /oauth2/auth`.
 *
 * The request replays the *original* `state` and `redirect_uri` from the authorization request,
 * together with the PKCE verifier and the `device_id` VK ID returned in the callback. Both
 * `redirect_uri` and `state` are required by VK ID and neither is available at callback time
 * otherwise; the upstream implementation fabricated a fresh random `state` instead of replaying
 * the original one, which discards VK ID's documented integrity check.
 *
 * Confidential applications additionally send `service_token`, never `client_secret`: VK ID has no
 * `client_secret` parameter in its token exchange.
 */
export const exchangeAuthorizationCode = async ({
  config,
  code,
  deviceId,
  codeVerifier,
  redirectUri,
  state,
  fetchImpl,
}: ExchangeCodeOptions): Promise<VkTokenResponse> => {
  const baseUrl = resolveApiBaseUrl(config);

  let payload: unknown;

  try {
    payload = await postForm({
      url: `${baseUrl}${tokenPath}`,
      params: {
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        client_id: config.clientId,
        service_token: config.serviceToken,
        device_id: deviceId,
        redirect_uri: redirectUri,
        state,
      },
      timeoutMs: config.timeout ?? defaultTimeout,
      fetchImpl,
    });
  } catch (error: unknown) {
    if (error instanceof VkApiError) {
      throw toConnectorError(error, 'token');
    }

    throw error;
  }

  const result = tokenResponseGuard.safeParse(payload);

  if (!result.success) {
    throw new ConnectorError(ConnectorErrorCodes.InvalidResponse, {
      message: 'VK ID token response does not match the expected schema',
      issues: result.error.issues.map(({ path, message }) => ({ path, message })),
    });
  }

  return result.data;
};

export type FetchUserOptions = {
  config: VkidConfig;
  accessToken: string;
  fetchImpl?: FetchLike | undefined;
};

/**
 * Read the VK ID profile at `POST /oauth2/user_info`.
 *
 * The request shape follows the official `vkid-web-sdk` and the Web/iOS/Android no-SDK guides:
 * the client id is a *query* parameter and the access token is a form body parameter. VK ID does
 * not document a `Bearer` header for the server-to-server redirect flow, and a body parameter
 * avoids a CORS preflight in browser contexts that VK ID explicitly warns about.
 */
export const fetchVkUser = async ({
  config,
  accessToken,
  fetchImpl,
}: FetchUserOptions): Promise<VkUser> => {
  const baseUrl = resolveApiBaseUrl(config);
  const url = new URL(`${baseUrl}${userInfoPath}`);
  url.searchParams.set('client_id', config.clientId);

  let payload: unknown;

  try {
    payload = await postForm({
      url: url.toString(),
      params: {
        access_token: accessToken,
      },
      timeoutMs: config.timeout ?? defaultTimeout,
      fetchImpl,
    });
  } catch (error: unknown) {
    if (error instanceof VkApiError) {
      throw toConnectorError(error, 'userinfo');
    }

    throw error;
  }

  const result = userInfoResponseGuard.safeParse(payload);

  if (!result.success) {
    throw new ConnectorError(ConnectorErrorCodes.InvalidResponse, {
      message: 'VK ID user info response does not match the expected schema',
      issues: result.error.issues.map(({ path, message }) => ({ path, message })),
    });
  }

  return result.data.user;
};
