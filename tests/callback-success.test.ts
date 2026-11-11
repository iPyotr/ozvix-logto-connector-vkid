import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SocialConnector } from '@logto/connector-kit';

import type { FetchMock, SessionHarness } from './support.js';
import {
  ACCESS_TOKEN,
  API_BASE,
  CLIENT_ID,
  DEFAULT_API_BASE,
  ID_TOKEN,
  REFRESH_TOKEN,
  SERVICE_TOKEN,
  TOKEN_RESPONSE,
  authorize,
  callbackData,
  configWith,
  createConnectorWithConfig,
  createFetchMock,
  createSessionHarness,
  createTestConnector,
  expectFormBodyEquals,
  expectedTokenParams,
  getFetchRequest,
  getTokenResponseAndUserInfo,
  queueSuccessfulExchange,
  queueTokenResponse,
  queueVkUser,
} from './support.js';

const EXPECTED_USER_INFO = {
  id: '42',
  name: 'Ivan Ivanov',
  avatar: 'https://pp.userapi.com/avatar.png',
};

describe('successful callback pipeline (scenarios 3, 4, 5)', () => {
  let fetchMock: FetchMock;
  let connector: SocialConnector;
  let harness: SessionHarness;
  let verifier: string;

  beforeEach(async () => {
    fetchMock = createFetchMock();
    connector = await createTestConnector();
    harness = createSessionHarness();
    ({ verifier } = await authorize(connector, harness));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('[S3] getUserInfo exchanges the code and returns the normalized VK profile', async () => {
    queueSuccessfulExchange(fetchMock);

    const userInfo = await connector.getUserInfo(callbackData(), harness.getSession);

    expect(userInfo).toEqual(EXPECTED_USER_INFO);
    expect(Object.keys(userInfo).sort()).toEqual(['avatar', 'id', 'name']);
    expect('email' in userInfo).toBe(false);
    expect('phone' in userInfo).toBe(false);
    expect('rawData' in userInfo).toBe(false);
    expect(harness.getSession).toHaveBeenCalledTimes(1);
    expect(await harness.getSession()).toEqual(harness.peek());
    expect(harness.peek().vk_code_verifier).toBe(verifier);
  });

  it('[S3] getTokenResponseAndUserInfo returns both the token response and the user info', async () => {
    queueSuccessfulExchange(fetchMock);

    const result = await getTokenResponseAndUserInfo(connector, callbackData(), harness.getSession);
    const tokenResponse = result.tokenResponse;

    if (!tokenResponse) {
      throw new Error('getTokenResponseAndUserInfo did not return a tokenResponse');
    }

    expect(tokenResponse).toEqual({
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
      id_token: ID_TOKEN,
      expires_in: 3600,
      scope: 'vkid.personal_info',
      token_type: 'Bearer',
    });
    expect(Object.keys(tokenResponse).sort()).toEqual([
      'access_token',
      'expires_in',
      'id_token',
      'refresh_token',
      'scope',
      'token_type',
    ]);
    // VK-specific extras from the token payload must not be forwarded to Logto token storage.
    expect(tokenResponse).not.toHaveProperty('state');
    expect(tokenResponse).not.toHaveProperty('user_id');
    expect(tokenResponse).not.toHaveProperty('error');
    expect(result.userInfo).toEqual(EXPECTED_USER_INFO);
  });

  it('[S4] token exchange replays the exact session binding in an x-www-form-urlencoded POST', async () => {
    queueSuccessfulExchange(fetchMock);

    await connector.getUserInfo(callbackData(), harness.getSession);
    const request = getFetchRequest(fetchMock, 0);

    expect(request.url).toBe(`${API_BASE}/oauth2/auth`);
    expect(request.method).toBe('POST');
    expect(request.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(request.headers.accept).toBe('application/json');
    expectFormBodyEquals(request, expectedTokenParams(verifier));
    expect(request.body.has('client_secret')).toBe(false);
    expect(request.body.has('service_token')).toBe(false);
  });

  it('[S4] adds service_token only when a confidential app configures it', async () => {
    const confidentialConnector = await createTestConnector(
      configWith({ serviceToken: SERVICE_TOKEN }),
    );
    const confidentialHarness = createSessionHarness();
    const { verifier: confidentialVerifier } = await authorize(
      confidentialConnector,
      confidentialHarness,
    );
    queueSuccessfulExchange(fetchMock);

    await confidentialConnector.getUserInfo(callbackData(), confidentialHarness.getSession);
    const request = getFetchRequest(fetchMock, 0);

    expectFormBodyEquals(
      request,
      expectedTokenParams(confidentialVerifier, { service_token: SERVICE_TOKEN }),
    );
    expect(request.body.get('service_token')).toBe(SERVICE_TOKEN);
    expect(request.body.has('client_secret')).toBe(false);
  });

  it('[S4] never sends client_secret, even if a legacy config still carries the field', async () => {
    const legacyConnector = await createConnectorWithConfig({
      clientId: CLIENT_ID,
      apiBaseUrl: API_BASE,
      clientSecret: 'LEGACY_CLIENT_SECRET_MUST_NOT_LEAK',
    });
    const legacyHarness = createSessionHarness();
    await authorize(legacyConnector, legacyHarness);
    queueSuccessfulExchange(fetchMock);

    await legacyConnector.getUserInfo(callbackData(), legacyHarness.getSession);
    const request = getFetchRequest(fetchMock, 0);

    expect(request.body.has('client_secret')).toBe(false);
    expect(request.body.toString()).not.toContain('LEGACY_CLIENT_SECRET_MUST_NOT_LEAK');
    expect(Object.fromEntries(request.body.entries())).toEqual(
      expectedTokenParams(legacyHarness.peek().vk_code_verifier ?? ''),
    );
  });

  it('[S5] profile lookup posts the access token and passes client_id in the query string', async () => {
    queueSuccessfulExchange(fetchMock);

    await connector.getUserInfo(callbackData(), harness.getSession);
    const request = getFetchRequest(fetchMock, 1);
    const url = new URL(request.url);

    expect(request.url).toBe(`${API_BASE}/oauth2/user_info?client_id=${CLIENT_ID}`);
    expect(url.pathname).toBe('/oauth2/user_info');
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(request.method).toBe('POST');
    expect(request.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(request.headers.accept).toBe('application/json');
    expectFormBodyEquals(request, { access_token: ACCESS_TOKEN });
    expect(request.body.has('client_id')).toBe(false);
  });

  it('[S3] defaults to the canonical https://id.vk.ru origin for both API calls', async () => {
    const defaultConnector = await createTestConnector({ clientId: CLIENT_ID });
    const defaultHarness = createSessionHarness();
    await authorize(defaultConnector, defaultHarness);
    queueSuccessfulExchange(fetchMock);

    await defaultConnector.getUserInfo(callbackData(), defaultHarness.getSession);

    expect(getFetchRequest(fetchMock, 0).url).toBe(`${DEFAULT_API_BASE}/oauth2/auth`);
    expect(getFetchRequest(fetchMock, 1).url).toBe(
      `${DEFAULT_API_BASE}/oauth2/user_info?client_id=${CLIENT_ID}`,
    );
  });

  it('[S3] forwards only the documented token fields when a minimal token response is returned', async () => {
    queueTokenResponse(fetchMock, { access_token: ACCESS_TOKEN });
    queueVkUser(fetchMock);

    const result = await getTokenResponseAndUserInfo(connector, callbackData(), harness.getSession);

    expect(result.tokenResponse).toEqual({ access_token: ACCESS_TOKEN });
    expect(Object.keys(result.tokenResponse ?? {})).toEqual(['access_token']);
    expect(result.userInfo).toEqual(EXPECTED_USER_INFO);
  });

  it('[S3] accepts a callback without a state parameter', async () => {
    const data = callbackData();
    delete data.state;
    queueSuccessfulExchange(fetchMock);

    await expect(connector.getUserInfo(data, harness.getSession)).resolves.toEqual(
      EXPECTED_USER_INFO,
    );
  });

  it('[S3] accepts a token response without a state field', async () => {
    const tokenBody: Record<string, unknown> = { ...TOKEN_RESPONSE };
    delete tokenBody.state;
    queueTokenResponse(fetchMock, tokenBody);
    queueVkUser(fetchMock);

    await expect(connector.getUserInfo(callbackData(), harness.getSession)).resolves.toEqual(
      EXPECTED_USER_INFO,
    );
  });

  it('[S3] tolerates an empty-string state echoed by the token endpoint', async () => {
    queueTokenResponse(fetchMock, { ...TOKEN_RESPONSE, state: '' });
    queueVkUser(fetchMock);

    await expect(connector.getUserInfo(callbackData(), harness.getSession)).resolves.toEqual(
      EXPECTED_USER_INFO,
    );
  });

  it('[S3] matches a token user_id encoded as a string against the profile user_id', async () => {
    queueSuccessfulExchange(fetchMock, { ...TOKEN_RESPONSE, user_id: '42' });

    const userInfo = await connector.getUserInfo(callbackData(), harness.getSession);

    expect(userInfo.id).toBe('42');
    expect(userInfo).toEqual(EXPECTED_USER_INFO);
  });

  it('[S3] returns the same normalized user info from both entry points', async () => {
    queueSuccessfulExchange(fetchMock);
    const fromGetUserInfo = await connector.getUserInfo(callbackData(), harness.getSession);
    queueSuccessfulExchange(fetchMock);
    const fromCombined = await getTokenResponseAndUserInfo(
      connector,
      callbackData(),
      harness.getSession,
    );

    expect(fromGetUserInfo).toEqual(fromCombined.userInfo);
  });

  it('[S3] does not mutate the session it reads', async () => {
    const before = { ...harness.peek() };
    queueSuccessfulExchange(fetchMock);

    await connector.getUserInfo(callbackData(), harness.getSession);

    expect(harness.peek()).toEqual(before);
    expect(harness.getSession).toHaveBeenCalledTimes(1);
  });
});
