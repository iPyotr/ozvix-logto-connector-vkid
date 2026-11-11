/**
 * Shared fixtures and helpers for the VK ID connector unit tests.
 *
 * Everything here is intentionally explicit: fixture tokens are recognisable strings so that a
 * "no secret leaked into the error" assertion is meaningful, and request/response helpers parse
 * real `fetch` arguments instead of re-implementing the connector.
 */

import { createHash } from 'node:crypto';
import { inspect } from 'node:util';

import type {
  ConnectorErrorCodes,
  GetSession,
  SetSession,
  SocialConnector,
} from '@logto/connector-kit';
import { ConnectorError } from '@logto/connector-kit';
import type { Mock } from 'vitest';
import { expect, vi } from 'vitest';

import createVkidConnector from '../src/index.js';
import type { VkidConfig } from '../src/types.js';

/** Recognisable fixture secrets: no assertion below may find these in a thrown error. */
export const CLIENT_ID = '7915193';
export const REDIRECT_URI = 'https://logto.example.com/callback/vk-universal';
export const STATE = 'state-0123456789abcdef0123456789abcdef';
export const DEVICE_ID = 'device-0123456789abcdef';
export const CODE = 'vk2.a.TEST_AUTH_CODE_SECRET';
export const ACCESS_TOKEN = 'vk1.a.TEST_ACCESS_TOKEN_SECRET';
export const REFRESH_TOKEN = 'vk1.r.TEST_REFRESH_TOKEN_SECRET';
export const ID_TOKEN = 'header.TEST_ID_TOKEN_SECRET.signature';
export const SERVICE_TOKEN = 'TEST_SERVICE_TOKEN_SECRET';

/** RFC 7636 Appendix B verifier (43 characters, valid for `connectorSessionGuard`). */
export const VALID_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

/** Legacy-style override used only in tests; any HTTPS origin is accepted by the config guard. */
export const API_BASE = 'https://id.vk.test';

/** Canonical production origin used by the connector when no `apiBaseUrl` is configured. */
export const DEFAULT_API_BASE = 'https://id.vk.ru';

export const baseConfig: VkidConfig = {
  clientId: CLIENT_ID,
  apiBaseUrl: API_BASE,
};

export const configWith = (overrides: Partial<VkidConfig> = {}): VkidConfig => ({
  ...baseConfig,
  ...overrides,
});

export const TOKEN_RESPONSE = {
  access_token: ACCESS_TOKEN,
  refresh_token: REFRESH_TOKEN,
  id_token: ID_TOKEN,
  expires_in: 3600,
  user_id: 42,
  state: STATE,
  scope: 'vkid.personal_info',
  token_type: 'Bearer',
} as const;

export const VK_PROFILE = {
  user: {
    user_id: '42',
    first_name: 'Ivan',
    last_name: 'Ivanov',
    avatar: 'https://pp.userapi.com/avatar.png',
    email: 'Ivan@Example.COM',
    phone: '79001234567',
    verified: false,
  },
} as const;

export type TestSession = {
  vk_code_verifier?: string;
  vk_redirect_uri?: string;
  vk_state?: string;
};

export type SessionHarness = {
  setSession: Mock<SetSession>;
  getSession: Mock<GetSession>;
  peek: () => TestSession;
  set: (session: TestSession) => void;
};

export type FetchMock = Mock<(input: string | URL, init?: RequestInit) => Promise<Response>>;

/** An in-memory Logto connector session: `setSession` stores, `getSession` reads it back. */
export const createSessionHarness = (): SessionHarness => {
  let current: TestSession = {};

  return {
    setSession: vi.fn<SetSession>(async (session) => {
      // `ConnectorSession` does not declare the connector-namespaced `vk_*` keys; the connector
      // may persist any additional keys in the session, which is exactly what we are testing.
      current = session as unknown as TestSession;
    }),
    getSession: vi.fn<GetSession>(async () => current),
    peek: () => current,
    set: (session) => {
      current = session;
    },
  };
};

/** Install a `fetch` stub so that no test can ever reach the network. */
export const createFetchMock = (): FetchMock => {
  const fetchMock = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>();
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

/** Seed a session equivalent to what `getAuthorizationUri` persists. */
export const seedSession = (
  harness: SessionHarness,
  overrides: Partial<TestSession> = {},
): void => {
  harness.set({
    vk_code_verifier: VALID_VERIFIER,
    vk_redirect_uri: REDIRECT_URI,
    vk_state: STATE,
    ...overrides,
  });
};

export type AuthorizationPayloadOverrides = {
  state?: string;
  redirectUri?: string;
  scope?: string;
};

export const authorizationPayload = (overrides: AuthorizationPayloadOverrides = {}) => ({
  state: STATE,
  redirectUri: REDIRECT_URI,
  connectorId: 'vk-universal',
  connectorFactoryId: 'vk-universal',
  jti: 'test-jti',
  headers: {},
  ...overrides,
});

/** Run the authorize step and return the parsed URL plus the verifier it stored in the session. */
export const authorize = async (
  connector: SocialConnector,
  harness: SessionHarness,
  overrides: AuthorizationPayloadOverrides = {},
): Promise<{ url: URL; verifier: string }> => {
  const uri = await connector.getAuthorizationUri(
    authorizationPayload(overrides),
    harness.setSession,
  );
  const verifier = harness.peek().vk_code_verifier;

  if (!verifier) {
    throw new Error('getAuthorizationUri did not persist a PKCE verifier in the session');
  }

  return { url: new URL(uri), verifier };
};

export const callbackData = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  code: CODE,
  device_id: DEVICE_ID,
  state: STATE,
  ...overrides,
});

export const createConnectorWithConfig = async (config: unknown): Promise<SocialConnector> =>
  createVkidConnector({ getConfig: async () => config });

export const createTestConnector = async (
  config: VkidConfig = baseConfig,
): Promise<SocialConnector> => createConnectorWithConfig(config);

/** `getTokenResponseAndUserInfo` is optional on `SocialConnector`; the connector always provides it. */
export const getTokenResponseAndUserInfo = async (
  connector: SocialConnector,
  data: unknown,
  getSession: GetSession,
) => {
  const handler = connector.getTokenResponseAndUserInfo;

  if (!handler) {
    throw new Error('connector does not implement getTokenResponseAndUserInfo');
  }

  return handler(data, getSession);
};

export const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export const htmlResponse = (
  body = '<html><body>upstream error page</body></html>',
  status = 200,
): Response =>
  new Response(body, {
    status,
    headers: { 'content-type': 'text/html' },
  });

export const queueJson = (fetchMock: FetchMock, body: unknown, status = 200): void => {
  fetchMock.mockResolvedValueOnce(jsonResponse(body, status));
};

export const queueTokenResponse = (
  fetchMock: FetchMock,
  body: Record<string, unknown> = TOKEN_RESPONSE,
): void => {
  queueJson(fetchMock, body);
};

export const queueVkUser = (fetchMock: FetchMock, body: unknown = VK_PROFILE): void => {
  queueJson(fetchMock, body);
};

/** Queue a fully successful token + user_info exchange. */
export const queueSuccessfulExchange = (
  fetchMock: FetchMock,
  tokenBody: Record<string, unknown> = TOKEN_RESPONSE,
  profileBody: unknown = VK_PROFILE,
): void => {
  queueTokenResponse(fetchMock, tokenBody);
  queueVkUser(fetchMock, profileBody);
};

export const queueFetchRejection = (fetchMock: FetchMock, error: unknown): void => {
  fetchMock.mockRejectedValueOnce(error);
};

export type RecordedRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: URLSearchParams;
};

/** Read the arguments the connector passed to the stubbed `fetch` at `index`. */
export const getFetchRequest = (fetchMock: FetchMock, index = 0): RecordedRequest => {
  const call = fetchMock.mock.calls[index];

  if (!call) {
    throw new Error(`fetch was not called at index ${index}`);
  }

  const [input, init] = call;
  const rawBody = init?.body;
  const bodyText =
    typeof rawBody === 'string'
      ? rawBody
      : rawBody instanceof URLSearchParams
        ? rawBody.toString()
        : '';

  return {
    url: input instanceof URL ? input.toString() : input,
    method: init?.method ?? 'GET',
    headers: (init?.headers ?? {}) as Record<string, string>,
    body: new URLSearchParams(bodyText),
  };
};

/** Form body as an order-insensitive parameter map. */
export const getFormParams = (request: RecordedRequest): Record<string, string> =>
  Object.fromEntries(request.body.entries());

export const expectedTokenParams = (
  verifier: string,
  overrides: Record<string, string> = {},
): Record<string, string> => ({
  grant_type: 'authorization_code',
  code: CODE,
  code_verifier: verifier,
  client_id: CLIENT_ID,
  device_id: DEVICE_ID,
  redirect_uri: REDIRECT_URI,
  state: STATE,
  ...overrides,
});

export const expectFetchNotCalled = (fetchMock: FetchMock): void => {
  expect(fetchMock).not.toHaveBeenCalled();
};

/** Capture a rejection without relying on `rejects` matchers (keeps the error object inspectable). */
export const captureError = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }

  throw new Error('Expected the promise to reject, but it resolved');
};

export const expectConnectorError = async (
  promise: Promise<unknown>,
  code: ConnectorErrorCodes,
): Promise<ConnectorError> => {
  const error = await captureError(promise);
  expect(error).toBeInstanceOf(ConnectorError);
  const connectorError = error as ConnectorError;
  expect(connectorError.code).toBe(code);
  return connectorError;
};

/** Independent implementation of the S256 challenge, straight from `node:crypto`. */
export const sha256Challenge = (verifier: string): string =>
  createHash('sha256').update(verifier, 'ascii').digest('base64url');

const safeJson = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '<unserializable>';
  }
};

/**
 * Everything a Logto log line, an Admin Console error panel or a support bundle could expose
 * about a thrown value.
 */
export const describeError = (error: unknown): string => {
  const data =
    error instanceof ConnectorError
      ? error.data
      : (error as { data?: unknown } | null | undefined)?.data;

  return [
    error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    safeJson(error),
    safeJson(data),
    inspect(error, { depth: 10, showHidden: true }),
    inspect(data, { depth: 10, showHidden: true }),
  ].join('\n---\n');
};

/** Assert that no fixture secret appears anywhere in the serialized error. */
export const expectNoSecretsInError = (error: unknown, secrets: readonly string[]): void => {
  const diagnostics = describeError(error);

  for (const secret of secrets) {
    expect(diagnostics).not.toContain(secret);
  }
};

export const expectFormBodyEquals = (
  request: RecordedRequest,
  expected: Record<string, string>,
): void => {
  expect(getFormParams(request)).toEqual(expected);
  expect([...request.body.keys()].sort()).toEqual(Object.keys(expected).sort());
};

/** Union of the fixture secrets used by the no-leak tests. */
export const FIXTURE_SECRETS = [
  ACCESS_TOKEN,
  REFRESH_TOKEN,
  ID_TOKEN,
  SERVICE_TOKEN,
  CODE,
  VALID_VERIFIER,
] as const;
