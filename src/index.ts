import type {
  CreateConnector,
  GetAuthorizationUri,
  GetConnectorConfig,
  GetSession,
  GetTokenResponseAndUserInfo,
  GetUserInfo,
  SocialConnector,
  SocialUserInfo,
} from '@logto/connector-kit';
import {
  ConnectorError,
  ConnectorErrorCodes,
  ConnectorType,
  validateConfig,
} from '@logto/connector-kit';

import {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  fetchVkUser,
  resolveApiBaseUrl,
} from './client.js';
import { connectorId, metadata } from './constant.js';
import { createCodeChallenge, createCodeVerifier } from './pkce.js';
import { mapVkUser } from './profile.js';
import { MAX_PROVIDER_ERROR_CODE_LENGTH, sanitizeProviderText } from './sanitize.js';
import {
  authorizationCallbackGuard,
  authorizationErrorGuard,
  connectorSessionGuard,
  vkidConfigGuard,
  type AuthorizationCallback,
  type VkidConfig,
  type VkidConnectorSession,
} from './types.js';

/**
 * VK ID social connector for Logto OSS.
 *
 * Flow (OAuth 2.1 authorization code + PKCE, `S256`):
 * 1. `getAuthorizationUri`: read the connector config, mint a PKCE verifier, store
 *    `{verifier, redirect_uri, state}` in the Logto interaction session, return the VK ID
 *    authorize URL. Logto generates and later verifies `state`; this connector only forwards it.
 * 2. Logto redirects the browser to VK ID and receives the callback with `code` + `device_id`.
 * 3. `getUserInfo` / `getTokenResponseAndUserInfo`: validate the callback, exchange the code at
 *    VK ID's token endpoint (replaying verifier, `device_id`, redirect URI and state), then read
 *    the profile from `/oauth2/user_info` and normalize it for Logto.
 */

/** Read and validate the connector configuration stored in the Logto database. */
const readConfig = async (getConfig: GetConnectorConfig): Promise<VkidConfig> => {
  const config = await getConfig(connectorId);

  validateConfig(config, vkidConfigGuard);

  return config;
};

/**
 * Read the transient OAuth state the connector persisted during `getAuthorizationUri`.
 *
 * A missing or malformed entry means the interaction session is stale (expired, or the callback
 * was replayed against a fresh session). It is reported as `invalid_request_parameters` rather
 * than as a provider error: nothing was sent to VK ID at that point.
 */
const readSession = async (getSession: GetSession): Promise<VkidConnectorSession> => {
  const session = await getSession();
  const result = connectorSessionGuard.safeParse(session);

  if (!result.success) {
    throw new ConnectorError(ConnectorErrorCodes.InvalidRequestParameters, {
      message:
        'VK ID authorization session is missing or expired; the PKCE code verifier, redirect URI ' +
        'or state was not found in the Logto connector session',
      issues: result.error.issues.map(({ path }) => path),
    });
  }

  return result.data;
};

/**
 * Validate the provider callback parameters.
 *
 * Logto core already turns a declined authorization (`error=access_denied`, ...) into a 401
 * `connector.authorization_failed` before the connector is called. The check is repeated here so
 * the connector behaves correctly when used directly, and so a provider error is never reported as
 * a generic "invalid parameters" error with the raw callback object attached.
 */
const parseCallback = (data: unknown): AuthorizationCallback => {
  const providerError = authorizationErrorGuard.safeParse(data);

  if (providerError.success) {
    // The callback query string is fully attacker-controlled: anyone can open the redirect URI with
    // arbitrary `error`/`error_description` values. Logto serialises this payload into the error
    // message and writes it to its log, so both values are sanitised (control and format characters
    // removed) and bounded before they are forwarded.
    const errorCode = sanitizeProviderText(
      providerError.data.error,
      MAX_PROVIDER_ERROR_CODE_LENGTH,
    );
    const errorDescription = sanitizeProviderText(providerError.data.error_description);

    throw new ConnectorError(ConnectorErrorCodes.AuthorizationFailed, {
      message: 'VK ID rejected the authorization request',
      ...(errorCode !== undefined && { error: errorCode }),
      ...(errorDescription !== undefined && { error_description: errorDescription }),
    });
  }

  const result = authorizationCallbackGuard.safeParse(data);

  if (!result.success) {
    throw new ConnectorError(ConnectorErrorCodes.InvalidRequestParameters, {
      message:
        'The VK ID callback is missing the authorization code or device_id. ' +
        'Make sure the VK ID application redirect URI points to this Logto connector.',
      issues: result.error.issues.map(({ path }) => path),
    });
  }

  return result.data;
};

type CallbackResult = {
  config: VkidConfig;
  callback: AuthorizationCallback;
  session: VkidConnectorSession;
  userInfo: SocialUserInfo;
  tokens: Awaited<ReturnType<typeof exchangeAuthorizationCode>>;
};

/**
 * The complete callback handling pipeline shared by `getUserInfo` and
 * `getTokenResponseAndUserInfo`.
 *
 * `code_verifier` never leaves the server, and neither the access token nor the refresh token is
 * ever written to a log line, an error payload or a response body that Logto could print.
 */
const handleCallback = async (
  getConfig: GetConnectorConfig,
  data: unknown,
  getSession: GetSession,
): Promise<CallbackResult> => {
  const session = await readSession(getSession);
  const callback = parseCallback(data);
  const config = await readConfig(getConfig);

  // Defense in depth: Logto core owns `state` verification, but if VK ID echoed it we require the
  // echoed value to match the value this connector bound to the session.
  if (callback.state !== undefined && callback.state !== session.vk_state) {
    throw new ConnectorError(ConnectorErrorCodes.InvalidRequestParameters, {
      message: 'The VK ID callback state does not match the authorization session',
    });
  }

  const tokens = await exchangeAuthorizationCode({
    config,
    code: callback.code,
    deviceId: callback.device_id,
    codeVerifier: session.vk_code_verifier,
    redirectUri: session.vk_redirect_uri,
    state: session.vk_state,
  });

  // VK ID echoes `state` in the token response and documents that it must match the value sent at
  // authorization time. An empty string is possible on refresh responses, so only a non-empty
  // mismatch is fatal.
  if (tokens.state !== undefined && tokens.state !== '' && tokens.state !== session.vk_state) {
    throw new ConnectorError(ConnectorErrorCodes.InvalidRequestParameters, {
      message: 'The VK ID token response state does not match the authorization session',
    });
  }

  const user = await fetchVkUser({ config, accessToken: tokens.access_token });

  // The VK user id is present in both the token response and the profile. A mismatch means the
  // access token belongs to a different user than the profile being read (token substitution);
  // Logto would otherwise attach the wrong identity to the authorization code.
  if (tokens.user_id !== undefined && String(tokens.user_id).trim() !== user.user_id) {
    throw new ConnectorError(ConnectorErrorCodes.SocialAccessTokenInvalid, {
      message: 'The VK ID token response and profile refer to different users',
    });
  }

  return {
    config,
    callback,
    session,
    tokens,
    userInfo: mapVkUser(config, user),
  };
};

/** Only the documented, non-secret-bearing fields are forwarded to Logto's token storage. */
const toTokenResponse = (tokens: CallbackResult['tokens']) => ({
  access_token: tokens.access_token,
  ...(tokens.refresh_token !== undefined && { refresh_token: tokens.refresh_token }),
  ...(tokens.id_token !== undefined && { id_token: tokens.id_token }),
  ...(tokens.expires_in !== undefined && { expires_in: tokens.expires_in }),
  ...(tokens.scope !== undefined && { scope: tokens.scope }),
  ...(tokens.token_type !== undefined && { token_type: tokens.token_type }),
});

const getAuthorizationUri =
  (getConfig: GetConnectorConfig): GetAuthorizationUri =>
  async (payload, setSession) => {
    const config = await readConfig(getConfig);
    const codeVerifier = createCodeVerifier();
    const codeChallenge = createCodeChallenge(codeVerifier);

    // Persist everything the token exchange cannot know later: the verifier (never sent to the
    // browser), the redirect URI Logto used, and the state Logto generated.
    await setSession({
      vk_code_verifier: codeVerifier,
      vk_redirect_uri: payload.redirectUri,
      vk_state: payload.state,
    });

    return buildAuthorizationUrl({
      clientId: config.clientId,
      redirectUri: payload.redirectUri,
      state: payload.state,
      scope: payload.scope ?? config.scope,
      codeChallenge,
      apiBaseUrl: resolveApiBaseUrl(config),
    });
  };

const getUserInfo =
  (getConfig: GetConnectorConfig): GetUserInfo =>
  async (data, getSession) => {
    const { userInfo } = await handleCallback(getConfig, data, getSession);

    return userInfo;
  };

const getTokenResponseAndUserInfo =
  (getConfig: GetConnectorConfig): GetTokenResponseAndUserInfo =>
  async (data, getSession) => {
    const { tokens, userInfo } = await handleCallback(getConfig, data, getSession);

    return { tokenResponse: toTokenResponse(tokens), userInfo };
  };

// Logto's CreateConnector contract returns a Promise; there is nothing to await here.
// eslint-disable-next-line @typescript-eslint/require-await
const createVkidConnector: CreateConnector<SocialConnector> = async ({ getConfig }) => ({
  metadata,
  type: ConnectorType.Social,
  configGuard: vkidConfigGuard,
  getAuthorizationUri: getAuthorizationUri(getConfig),
  getUserInfo: getUserInfo(getConfig),
  getTokenResponseAndUserInfo: getTokenResponseAndUserInfo(getConfig),
});

export default createVkidConnector;

// Re-exported for unit tests and for integrators who build their own wrapper.
export { buildAuthorizationUrl, exchangeAuthorizationCode, fetchVkUser } from './client.js';
export { connectorId, metadata } from './constant.js';
export { createCodeChallenge, createCodeVerifier } from './pkce.js';
export { mapVkUser } from './profile.js';
export { vkidConfigGuard } from './types.js';
