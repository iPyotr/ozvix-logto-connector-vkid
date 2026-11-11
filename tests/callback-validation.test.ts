import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorErrorCodes } from '@logto/connector-kit';
import type { SocialConnector } from '@logto/connector-kit';

import type { FetchMock, SessionHarness } from './support.js';
import {
  ACCESS_TOKEN,
  API_BASE,
  STATE,
  VALID_VERIFIER,
  callbackData,
  createConnectorWithConfig,
  createFetchMock,
  createSessionHarness,
  createTestConnector,
  expectConnectorError,
  expectFetchNotCalled,
  getTokenResponseAndUserInfo,
  queueSuccessfulExchange,
  queueTokenResponse,
  seedSession,
} from './support.js';

describe('callback and session validation (scenarios 6, 7, 8, 16a, 16c)', () => {
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

  it('[S6] rejects a callback missing device_id before calling VK ID', async () => {
    const data = callbackData();
    delete data.device_id;

    const error = await expectConnectorError(
      connector.getUserInfo(data, harness.getSession),
      ConnectorErrorCodes.InvalidRequestParameters,
    );

    expect(error.message).toContain('device_id');
    expectFetchNotCalled(fetchMock);
  });

  it('[S6] rejects a callback missing the authorization code', async () => {
    const data = callbackData();
    delete data.code;

    const error = await expectConnectorError(
      connector.getUserInfo(data, harness.getSession),
      ConnectorErrorCodes.InvalidRequestParameters,
    );

    expect(error.message).toContain('code');
    expectFetchNotCalled(fetchMock);
  });

  it('[S6] rejects a callback that is not an object', async () => {
    await expectConnectorError(
      connector.getUserInfo('code=abc&device_id=def', harness.getSession),
      ConnectorErrorCodes.InvalidRequestParameters,
    );
    expectFetchNotCalled(fetchMock);
  });

  it('[S6] enforces the same callback guard for getTokenResponseAndUserInfo', async () => {
    const data = callbackData();
    delete data.device_id;

    await expectConnectorError(
      getTokenResponseAndUserInfo(connector, data, harness.getSession),
      ConnectorErrorCodes.InvalidRequestParameters,
    );
    expectFetchNotCalled(fetchMock);
  });

  it('[S7/S16c] rejects an empty session (expired interaction or replayed callback)', async () => {
    harness.set({});

    const error = await expectConnectorError(
      connector.getUserInfo(callbackData(), harness.getSession),
      ConnectorErrorCodes.InvalidRequestParameters,
    );

    expect(error.message).toContain('session');
    expectFetchNotCalled(fetchMock);
  });

  it('[S7] validates the session before the callback (session-first ordering)', async () => {
    harness.set({});

    // An authorization-error callback would map to AuthorizationFailed; the missing session wins,
    // proving nothing was trusted from the callback before the request binding was verified.
    await expectConnectorError(
      connector.getUserInfo(
        { error: 'access_denied', error_description: 'blocked' },
        harness.getSession,
      ),
      ConnectorErrorCodes.InvalidRequestParameters,
    );
    expectFetchNotCalled(fetchMock);
  });

  it('[S7] rejects a too-short code_verifier in the session', async () => {
    seedSession(harness, { vk_code_verifier: 'too-short' });

    await expectConnectorError(
      connector.getUserInfo(callbackData(), harness.getSession),
      ConnectorErrorCodes.InvalidRequestParameters,
    );
    expectFetchNotCalled(fetchMock);
  });

  it('[S7] rejects a code_verifier longer than 128 characters', async () => {
    seedSession(harness, { vk_code_verifier: 'A'.repeat(129) });

    await expectConnectorError(
      connector.getUserInfo(callbackData(), harness.getSession),
      ConnectorErrorCodes.InvalidRequestParameters,
    );
    expectFetchNotCalled(fetchMock);
  });

  it('[S7] rejects a code_verifier with characters outside the PKCE unreserved set', async () => {
    seedSession(harness, { vk_code_verifier: `${'A'.repeat(42)}!` });

    await expectConnectorError(
      connector.getUserInfo(callbackData(), harness.getSession),
      ConnectorErrorCodes.InvalidRequestParameters,
    );
    expectFetchNotCalled(fetchMock);
  });

  it('[S7] rejects a session missing vk_redirect_uri', async () => {
    harness.set({ vk_code_verifier: VALID_VERIFIER, vk_state: STATE });

    await expectConnectorError(
      connector.getUserInfo(callbackData(), harness.getSession),
      ConnectorErrorCodes.InvalidRequestParameters,
    );
    expectFetchNotCalled(fetchMock);
  });

  it('[S7] rejects a session missing vk_state', async () => {
    harness.set({
      vk_code_verifier: VALID_VERIFIER,
      vk_redirect_uri: 'https://logto.example.com/cb',
    });

    await expectConnectorError(
      connector.getUserInfo(callbackData(), harness.getSession),
      ConnectorErrorCodes.InvalidRequestParameters,
    );
    expectFetchNotCalled(fetchMock);
  });

  it('[S8] maps a VK authorization error callback to AuthorizationFailed naming access_denied', async () => {
    const error = await expectConnectorError(
      connector.getUserInfo(
        { error: 'access_denied', error_description: 'account is blocked' },
        harness.getSession,
      ),
      ConnectorErrorCodes.AuthorizationFailed,
    );

    expect(error.message).toContain('access_denied');
    expect(error.message).toContain('account is blocked');
    expect(error.message).not.toContain('access_token');
    expectFetchNotCalled(fetchMock);
  });

  it('[S8] reports the provider authorization error before validating the connector config', async () => {
    const invalidConfigConnector = await createConnectorWithConfig({ clientId: '' });

    await expectConnectorError(
      invalidConfigConnector.getUserInfo(
        { error: 'access_denied', error_description: 'blocked' },
        harness.getSession,
      ),
      ConnectorErrorCodes.AuthorizationFailed,
    );
    expectFetchNotCalled(fetchMock);
  });

  it('[S16a] rejects a callback state that does not match the session binding before any fetch', async () => {
    const error = await expectConnectorError(
      connector.getUserInfo(
        callbackData({ state: 'attacker-controlled-state' }),
        harness.getSession,
      ),
      ConnectorErrorCodes.InvalidRequestParameters,
    );

    expect(error.message).toContain('state');
    expectFetchNotCalled(fetchMock);
  });

  it('[S16a] accepts a callback state equal to the session state', async () => {
    queueSuccessfulExchange(fetchMock);

    const userInfo = await connector.getUserInfo(
      callbackData({ state: STATE }),
      harness.getSession,
    );

    expect(userInfo.id).toBe('42');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('[STATE] rejects a state mismatch echoed by the token endpoint before fetching the profile', async () => {
    queueTokenResponse(fetchMock, {
      access_token: ACCESS_TOKEN,
      user_id: 42,
      state: 'foreign-state',
    });

    const error = await expectConnectorError(
      connector.getUserInfo(callbackData(), harness.getSession),
      ConnectorErrorCodes.InvalidRequestParameters,
    );

    expect(error.message).toContain('state');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${API_BASE}/oauth2/auth`);
  });
});
