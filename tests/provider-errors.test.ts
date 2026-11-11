import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorErrorCodes } from '@logto/connector-kit';
import type { SocialConnector } from '@logto/connector-kit';

import type { FetchMock, SessionHarness } from './support.js';
import {
  ACCESS_TOKEN,
  API_BASE,
  CODE,
  FIXTURE_SECRETS,
  REFRESH_TOKEN,
  TOKEN_RESPONSE,
  VK_PROFILE,
  callbackData,
  createFetchMock,
  createSessionHarness,
  createTestConnector,
  expectConnectorError,
  expectNoSecretsInError,
  getFetchRequest,
  getTokenResponseAndUserInfo,
  htmlResponse,
  queueJson,
  queueTokenResponse,
  queueVkUser,
  seedSession,
} from './support.js';

describe('provider error mapping (scenarios 9, 10, 11, 16b, 16d)', () => {
  let fetchMock: FetchMock;
  let connector: SocialConnector;
  let harness: SessionHarness;

  beforeEach(async () => {
    fetchMock = createFetchMock();
    connector = await createTestConnector();
    harness = createSessionHarness();
    seedSession(harness);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('[S9] maps a token endpoint 400 to SocialAuthCodeInvalid', async () => {
    queueJson(fetchMock, { error: 'invalid_grant', error_description: 'code expired' }, 400);

    const error = await expectConnectorError(
      connector.getUserInfo(callbackData(), harness.getSession),
      ConnectorErrorCodes.SocialAuthCodeInvalid,
    );

    expect(error.data).toEqual({
      status: 400,
      error: 'invalid_grant',
      error_description: 'code expired',
    });
    expect(error.data).not.toHaveProperty('access_token');
    expect(error.data).not.toHaveProperty('refresh_token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expectNoSecretsInError(error, FIXTURE_SECRETS);
  });

  it('[S9] maps a token endpoint 404 (documented for malformed exchanges) to SocialAuthCodeInvalid', async () => {
    fetchMock.mockResolvedValueOnce(htmlResponse('<html>404 NOT FOUND</html>', 404));

    const error = await expectConnectorError(
      connector.getUserInfo(callbackData(), harness.getSession),
      ConnectorErrorCodes.SocialAuthCodeInvalid,
    );

    expect(error.data).toMatchObject({ status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('[S9] maps a token endpoint 500 to General', async () => {
    queueJson(fetchMock, { error: 'server_error', error_description: 'boom' }, 500);

    const error = await expectConnectorError(
      connector.getUserInfo(callbackData(), harness.getSession),
      ConnectorErrorCodes.General,
    );

    expect(error.message).toContain('token endpoint');
    expect(error.data).toMatchObject({ status: 500, error: 'server_error' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('[S9] maps a token endpoint 503 with an HTML body to General', async () => {
    fetchMock.mockResolvedValueOnce(htmlResponse('<html>upstream down</html>', 503));

    const error = await expectConnectorError(
      connector.getUserInfo(callbackData(), harness.getSession),
      ConnectorErrorCodes.General,
    );

    expect(error.data).toMatchObject({ status: 503 });
  });

  it('[S10] maps userinfo 401 to SocialAccessTokenInvalid', async () => {
    queueTokenResponse(fetchMock);
    queueJson(fetchMock, { error: 'invalid_token', error_description: 'token revoked' }, 401);

    const error = await expectConnectorError(
      connector.getUserInfo(callbackData(), harness.getSession),
      ConnectorErrorCodes.SocialAccessTokenInvalid,
    );

    expect(error.data).toMatchObject({ status: 401, error: 'invalid_token' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expectNoSecretsInError(error, FIXTURE_SECRETS);
  });

  it('[S10] maps userinfo 403 to SocialAccessTokenInvalid', async () => {
    queueTokenResponse(fetchMock);
    queueJson(fetchMock, { error: 'forbidden' }, 403);

    await expectConnectorError(
      connector.getUserInfo(callbackData(), harness.getSession),
      ConnectorErrorCodes.SocialAccessTokenInvalid,
    );
  });

  it('[S10] maps userinfo 500 to General', async () => {
    queueTokenResponse(fetchMock);
    queueJson(fetchMock, { error: 'server_error' }, 500);

    const error = await expectConnectorError(
      connector.getUserInfo(callbackData(), harness.getSession),
      ConnectorErrorCodes.General,
    );

    expect(error.message).toContain('user info endpoint');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('[S11] maps a non-JSON token response body to InvalidResponse', async () => {
    fetchMock.mockResolvedValueOnce(htmlResponse());

    const error = await expectConnectorError(
      connector.getUserInfo(callbackData(), harness.getSession),
      ConnectorErrorCodes.InvalidResponse,
    );

    expect(error.message).toContain('not valid JSON');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('[S11] maps a non-JSON userinfo response body to InvalidResponse', async () => {
    queueTokenResponse(fetchMock);
    fetchMock.mockResolvedValueOnce(htmlResponse());

    const error = await expectConnectorError(
      connector.getUserInfo(callbackData(), harness.getSession),
      ConnectorErrorCodes.InvalidResponse,
    );

    expect(error.message).toContain('not valid JSON');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('[S11] maps a token response missing access_token to InvalidResponse', async () => {
    queueJson(fetchMock, {});

    const error = await expectConnectorError(
      connector.getUserInfo(callbackData(), harness.getSession),
      ConnectorErrorCodes.InvalidResponse,
    );

    expect(error.message).toContain('token response does not match the expected schema');
    expectNoSecretsInError(error, FIXTURE_SECRETS);
  });

  it('[S11] maps a userinfo response without the user envelope to InvalidResponse', async () => {
    queueTokenResponse(fetchMock);
    queueJson(fetchMock, { unexpected: 'shape' });

    const error = await expectConnectorError(
      connector.getUserInfo(callbackData(), harness.getSession),
      ConnectorErrorCodes.InvalidResponse,
    );

    expect(error.message).toContain('user info response does not match the expected schema');
    expectNoSecretsInError(error, FIXTURE_SECRETS);
  });

  it('[S16b] rejects a replayed authorization code (now invalid_grant) as SocialAuthCodeInvalid', async () => {
    // First exchange succeeds and consumes the authorization code.
    queueTokenResponse(fetchMock);
    queueVkUser(fetchMock);
    await expect(connector.getUserInfo(callbackData(), harness.getSession)).resolves.toEqual({
      id: '42',
      name: 'Ivan Ivanov',
      avatar: 'https://pp.userapi.com/avatar.png',
    });

    // The same interaction session is replayed; VK ID now rejects the already-used code.
    queueJson(fetchMock, { error: 'invalid_grant', error_description: 'code already used' }, 400);
    const error = await expectConnectorError(
      connector.getUserInfo(callbackData(), harness.getSession),
      ConnectorErrorCodes.SocialAuthCodeInvalid,
    );

    expect(error.data).toMatchObject({ status: 400, error: 'invalid_grant' });
    const replayRequest = getFetchRequest(fetchMock, 2);
    expect(replayRequest.url).toBe(`${API_BASE}/oauth2/auth`);
    // The session (and therefore the verifier) was bound to the interaction, so it is replayed.
    expect(replayRequest.body.get('code_verifier')).toBe(harness.peek().vk_code_verifier);
    expect(replayRequest.body.get('code')).toBe(CODE);
    expectNoSecretsInError(error, FIXTURE_SECRETS);
  });

  it('[S16d] accepts a numeric token user_id matching the string profile user_id', async () => {
    queueTokenResponse(fetchMock, { ...TOKEN_RESPONSE, user_id: 42 });
    queueVkUser(fetchMock, { user: { ...VK_PROFILE.user, user_id: '42' } });

    const result = await getTokenResponseAndUserInfo(connector, callbackData(), harness.getSession);

    expect(result.userInfo.id).toBe('42');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('[S16d] rejects a token user_id that differs from the profile user_id', async () => {
    queueTokenResponse(fetchMock, { ...TOKEN_RESPONSE, user_id: 42 });
    queueVkUser(fetchMock, { user: { ...VK_PROFILE.user, user_id: '99' } });

    const error = await expectConnectorError(
      getTokenResponseAndUserInfo(connector, callbackData(), harness.getSession),
      ConnectorErrorCodes.SocialAccessTokenInvalid,
    );

    expect(error.message).toContain('different users');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(error.data).not.toHaveProperty('access_token');
    expectNoSecretsInError(error, [ACCESS_TOKEN, REFRESH_TOKEN]);
  });

  it('[S11] rejects a profile whose user id is not a plain ASCII token', async () => {
    queueTokenResponse(fetchMock);
    queueVkUser(fetchMock, {
      user: { ...VK_PROFILE.user, user_id: '42\nFAKE LOG LINE\u202e' },
    });

    const error = await expectConnectorError(
      connector.getUserInfo(callbackData(), harness.getSession),
      ConnectorErrorCodes.InvalidResponse,
    );

    // The identity is the one value Logto stores and displays verbatim, so a hostile value fails
    // closed instead of being normalised, and the value itself is never echoed into the error.
    expect(JSON.stringify(error.data)).not.toContain('FAKE LOG LINE');
    expectNoSecretsInError(error, FIXTURE_SECRETS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
