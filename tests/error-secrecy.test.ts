import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorErrorCodes } from '@logto/connector-kit';
import type { SocialConnector } from '@logto/connector-kit';

import { sanitizeIdentity, sanitizeProviderText } from '../src/sanitize.js';

import type { FetchMock, SessionHarness } from './support.js';
import {
  ACCESS_TOKEN,
  CODE,
  FIXTURE_SECRETS,
  ID_TOKEN,
  REFRESH_TOKEN,
  SERVICE_TOKEN,
  STATE,
  VALID_VERIFIER,
  VK_PROFILE,
  authorizationPayload,
  callbackData,
  captureError,
  configWith,
  createFetchMock,
  createSessionHarness,
  createTestConnector,
  expectConnectorError,
  expectNoSecretsInError,
  getTokenResponseAndUserInfo,
  htmlResponse,
  queueJson,
  queueSuccessfulExchange,
  queueTokenResponse,
  queueVkUser,
  seedSession,
} from './support.js';

/**
 * True when the string contains a C0/C1 control character. Written as a character scan so the test
 * does not need a regular expression full of control characters.
 */
const hasControlCharacters = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 0x20 || (code >= 0x7f && code <= 0x9f);
  });

describe('no secrets in diagnostics or returned profiles (scenario 15)', () => {
  let fetchMock: FetchMock;
  let connector: SocialConnector;
  let harness: SessionHarness;

  beforeEach(async () => {
    fetchMock = createFetchMock();
    connector = await createTestConnector(configWith({ serviceToken: SERVICE_TOKEN }));
    harness = createSessionHarness();
    seedSession(harness);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('[S15] a token endpoint 500 body with token fields never reaches the error', async () => {
    queueJson(
      fetchMock,
      {
        error: 'server_error',
        access_token: ACCESS_TOKEN,
        refresh_token: REFRESH_TOKEN,
        id_token: ID_TOKEN,
      },
      500,
    );

    const error = await expectConnectorError(
      connector.getUserInfo(callbackData(), harness.getSession),
      ConnectorErrorCodes.General,
    );

    expectNoSecretsInError(error, FIXTURE_SECRETS);
  });

  it('[S15] a userinfo 500 body with token fields never reaches the error', async () => {
    queueTokenResponse(fetchMock);
    queueJson(
      fetchMock,
      { error: 'server_error', access_token: ACCESS_TOKEN, refresh_token: REFRESH_TOKEN },
      500,
    );

    const error = await expectConnectorError(
      connector.getUserInfo(callbackData(), harness.getSession),
      ConnectorErrorCodes.General,
    );

    expectNoSecretsInError(error, FIXTURE_SECRETS);
  });

  it('[S15] a 401 body carrying the access token is not echoed as SocialAccessTokenInvalid', async () => {
    queueTokenResponse(fetchMock);
    queueJson(fetchMock, { error: 'invalid_token', access_token: ACCESS_TOKEN }, 401);

    const error = await expectConnectorError(
      connector.getUserInfo(callbackData(), harness.getSession),
      ConnectorErrorCodes.SocialAccessTokenInvalid,
    );

    expect(error.data).not.toHaveProperty('access_token');
    expectNoSecretsInError(error, FIXTURE_SECRETS);
  });

  it('[S15] a non-JSON body containing secrets is not echoed as InvalidResponse', async () => {
    fetchMock.mockResolvedValueOnce(
      htmlResponse(`<html>access_token=${ACCESS_TOKEN} code=${CODE}</html>`),
    );

    const error = await expectConnectorError(
      connector.getUserInfo(callbackData(), harness.getSession),
      ConnectorErrorCodes.InvalidResponse,
    );

    expectNoSecretsInError(error, FIXTURE_SECRETS);
  });

  it('[S15] invalid configuration never leaks the configured service token', async () => {
    const invalidConnector = await createTestConnector(
      configWith({ clientId: '', serviceToken: SERVICE_TOKEN, apiBaseUrl: 'not-a-url' }),
    );
    const invalidHarness = createSessionHarness();
    const error = await expectConnectorError(
      invalidConnector.getAuthorizationUri(authorizationPayload(), invalidHarness.setSession),
      ConnectorErrorCodes.InvalidConfig,
    );

    expectNoSecretsInError(error, [SERVICE_TOKEN, ACCESS_TOKEN, REFRESH_TOKEN, ID_TOKEN]);
  });

  it('[S15] a request timeout never exposes request-body secrets', async () => {
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    fetchMock.mockRejectedValueOnce(timeout);

    const error = await captureError(connector.getUserInfo(callbackData(), harness.getSession));

    expectNoSecretsInError(error, FIXTURE_SECRETS);
  });

  it('[S15] an invalid callback payload is not echoed into InvalidRequestParameters', async () => {
    const data = {
      code: '',
      device_id: 'device-id',
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
    };

    const error = await expectConnectorError(
      connector.getUserInfo(data, harness.getSession),
      ConnectorErrorCodes.InvalidRequestParameters,
    );

    expectNoSecretsInError(error, FIXTURE_SECRETS);
  });

  it('[S15] a session validation failure does not echo the stored verifier', async () => {
    harness.set({
      vk_code_verifier: VALID_VERIFIER,
      vk_redirect_uri: 'https://logto.example.com/cb',
      // vk_state intentionally missing.
    });

    const error = await expectConnectorError(
      connector.getUserInfo(callbackData(), harness.getSession),
      ConnectorErrorCodes.InvalidRequestParameters,
    );

    expectNoSecretsInError(error, [VALID_VERIFIER, ...FIXTURE_SECRETS]);
  });

  it('[S15] a successful userInfo response never contains tokens or the service token', async () => {
    queueSuccessfulExchange(fetchMock);

    const userInfo = await connector.getUserInfo(callbackData(), harness.getSession);
    const serialized = JSON.stringify(userInfo);

    for (const secret of [
      ACCESS_TOKEN,
      REFRESH_TOKEN,
      ID_TOKEN,
      SERVICE_TOKEN,
      CODE,
      VALID_VERIFIER,
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).not.toContain(VK_PROFILE.user.email);
    expect(serialized).not.toContain(VK_PROFILE.user.phone);
  });

  it('[S15] the forwarded token response excludes non-documented VK fields', async () => {
    queueTokenResponse(fetchMock, {
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
      id_token: ID_TOKEN,
      expires_in: 3600,
      user_id: 42,
      state: STATE,
      scope: 'vkid.personal_info',
      token_type: 'Bearer',
      extra_vk_field: 'must-not-be-forwarded',
    });
    queueVkUser(fetchMock);

    const result = await getTokenResponseAndUserInfo(connector, callbackData(), harness.getSession);
    const serialized = JSON.stringify(result.tokenResponse ?? {});

    expect(serialized).not.toContain(STATE);
    expect(serialized).not.toContain('"user_id"');
    expect(serialized).not.toContain('extra_vk_field');
    expect(serialized).not.toContain(CODE);
    expect(serialized).not.toContain(VALID_VERIFIER);
  });

  it('[S15] sanitises a user-controlled provider error callback before it reaches the error', async () => {
    const description = `denied\u001b[2J\n2026-01-01T00:00:00Z INFO access_token=FAKE\n${'A'.repeat(5000)}`;

    const error = await expectConnectorError(
      connector.getUserInfo(
        { error: 'access_denied\nFAKE LOG LINE', error_description: description },
        harness.getSession,
      ),
      ConnectorErrorCodes.AuthorizationFailed,
    );

    const data = error.data as { error?: string; error_description?: string };

    // Control characters are removed (no forged log lines, no ANSI escapes) ...
    expect(data.error).toBe('access_denied FAKE LOG LINE');
    expect(hasControlCharacters(data.error_description ?? '')).toBe(false);
    // ... and the description is bounded, so a 5 kB query parameter cannot flood the log.
    expect(data.error_description?.length).toBeLessThanOrEqual(200);
    expect(data.error_description).toContain('access_token=FAKE');
    expectNoSecretsInError(error, [
      ACCESS_TOKEN,
      REFRESH_TOKEN,
      ID_TOKEN,
      SERVICE_TOKEN,
      VALID_VERIFIER,
    ]);
  });

  it('[S15] bounds and sanitises provider error fields from the token endpoint', async () => {
    queueJson(
      fetchMock,
      {
        error: 'invalid_grant\nFAKE LOG LINE',
        error_description: `bad\tverifier ${'B'.repeat(5000)}`,
      },
      400,
    );

    const error = await expectConnectorError(
      connector.getUserInfo(callbackData(), harness.getSession),
      ConnectorErrorCodes.SocialAuthCodeInvalid,
    );

    const data = error.data as { error?: string; error_description?: string };
    expect(data.error).toBe('invalid_grant FAKE LOG LINE');
    expect(data.error_description?.length).toBeLessThanOrEqual(200);
    expect(hasControlCharacters(data.error_description ?? '')).toBe(false);
    expectNoSecretsInError(error, FIXTURE_SECRETS);
  });
});

describe('input sanitisation helpers', () => {
  it('drops non-string, empty and control-only diagnostic values', () => {
    expect(sanitizeProviderText(undefined)).toBeUndefined();
    expect(sanitizeProviderText(42)).toBeUndefined();
    expect(sanitizeProviderText({ error: 'x' })).toBeUndefined();
    expect(sanitizeProviderText('   ')).toBeUndefined();
    expect(sanitizeProviderText('\u0000\u001b')).toBeUndefined();
  });

  it('bounds a diagnostic value to the requested length', () => {
    expect(sanitizeProviderText('x'.repeat(500), 64)).toHaveLength(64);
  });

  it('accepts only short ASCII identities and rejects everything else', () => {
    expect(sanitizeIdentity('1001')).toBe('1001');
    expect(sanitizeIdentity(' 1001 ')).toBe('1001');
    expect(sanitizeIdentity('user:1_a-b.c')).toBe('user:1_a-b.c');
    expect(sanitizeIdentity('1001\nFAKE')).toBeUndefined();
    expect(sanitizeIdentity('1001\u202e')).toBeUndefined();
    expect(sanitizeIdentity('')).toBeUndefined();
    expect(sanitizeIdentity('a'.repeat(65))).toBeUndefined();
  });
});
