import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorError, ConnectorErrorCodes } from '@logto/connector-kit';
import type { SocialConnector } from '@logto/connector-kit';

import type { FetchMock, SessionHarness } from './support.js';
import {
  ACCESS_TOKEN,
  API_BASE,
  CLIENT_ID,
  DEVICE_ID,
  SERVICE_TOKEN,
  VALID_VERIFIER,
  callbackData,
  captureError,
  configWith,
  createFetchMock,
  createSessionHarness,
  createTestConnector,
  getFetchRequest,
  queueFetchRejection,
  queueTokenResponse,
  seedSession,
} from './support.js';

describe('timeouts and network transport failures (scenario 14)', () => {
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

  it('[S14] converts a token-request timeout into the Logto 1.46 duck-typed TimeoutError shape', async () => {
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    queueFetchRejection(fetchMock, timeout);

    const error = await captureError(connector.getUserInfo(callbackData(), harness.getSession));

    expect(error).not.toBeInstanceOf(ConnectorError);
    const timeoutError = error as Error & { request: { url: string } };
    expect(timeoutError).toBeInstanceOf(Error);
    expect(timeoutError.name).toBe('TimeoutError');
    expect(timeoutError.message).toContain(`${API_BASE}/oauth2/auth`);
    expect(timeoutError.request).toEqual({ url: `${API_BASE}/oauth2/auth` });
    expect(Object.keys(timeoutError.request)).toEqual(['url']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('[S14] converts a userinfo-request timeout into a TimeoutError carrying the userinfo URL', async () => {
    queueTokenResponse(fetchMock);
    queueFetchRejection(
      fetchMock,
      new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
    );

    const error = await captureError(connector.getUserInfo(callbackData(), harness.getSession));

    expect(error).not.toBeInstanceOf(ConnectorError);
    const timeoutError = error as Error & { request: { url: string } };
    expect(timeoutError.name).toBe('TimeoutError');
    expect(timeoutError.request.url).toBe(`${API_BASE}/oauth2/user_info?client_id=${CLIENT_ID}`);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('[S14] normalizes a caller AbortError to the same TimeoutError shape', async () => {
    queueFetchRejection(fetchMock, new DOMException('The operation was aborted', 'AbortError'));

    const error = await captureError(connector.getUserInfo(callbackData(), harness.getSession));

    expect((error as Error).name).toBe('TimeoutError');
    expect((error as Error & { request: { url: string } }).request.url).toBe(
      `${API_BASE}/oauth2/auth`,
    );
  });

  it('[S14] timeout errors never expose the request body, code or verifier', async () => {
    const confidentialConnector = await createTestConnector(
      configWith({ serviceToken: SERVICE_TOKEN }),
    );
    queueFetchRejection(
      fetchMock,
      new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
    );

    const error = await captureError(
      confidentialConnector.getUserInfo(callbackData(), harness.getSession),
    );
    const diagnostics = JSON.stringify(error) + (error as Error).message;

    for (const secret of [SERVICE_TOKEN, VALID_VERIFIER, DEVICE_ID]) {
      expect(diagnostics).not.toContain(secret);
    }
    expect(diagnostics).not.toContain(ACCESS_TOKEN);
  });

  it('[S14] propagates a DNS failure TypeError unchanged (Logto must see ENOTFOUND, not a ConnectorError)', async () => {
    const networkError = new TypeError('fetch failed', {
      cause: { code: 'ENOTFOUND' },
    });
    queueFetchRejection(fetchMock, networkError);

    const error = await captureError(connector.getUserInfo(callbackData(), harness.getSession));

    expect(error).toBe(networkError);
    expect(error).not.toBeInstanceOf(ConnectorError);
    expect((error as TypeError).cause).toEqual({ code: 'ENOTFOUND' });
    const request = getFetchRequest(fetchMock, 0);
    expect(request.url).toBe(`${API_BASE}/oauth2/auth`);
  });

  it('[S14] propagates a userinfo transport failure unchanged', async () => {
    queueTokenResponse(fetchMock);
    const networkError = new TypeError('fetch failed', {
      cause: { code: 'ECONNRESET' },
    });
    queueFetchRejection(fetchMock, networkError);

    const error = await captureError(connector.getUserInfo(callbackData(), harness.getSession));

    expect(error).toBe(networkError);
    expect((error as TypeError).cause).toEqual({ code: 'ECONNRESET' });
  });

  it('[S14] propagates an arbitrary transport error unchanged', async () => {
    const socketError = new Error('socket hang up');
    queueFetchRejection(fetchMock, socketError);

    const error = await captureError(connector.getUserInfo(callbackData(), harness.getSession));

    expect(error).toBe(socketError);
    expect(error).not.toBeInstanceOf(ConnectorError);
  });

  it('[S14] rejects an oversized provider response instead of buffering it', async () => {
    const body = JSON.stringify({ access_token: ACCESS_TOKEN, id_token: 'x'.repeat(1_100_000) });
    fetchMock.mockResolvedValueOnce(
      new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const error = await captureError(connector.getUserInfo(callbackData(), harness.getSession));

    expect(error).toBeInstanceOf(ConnectorError);
    expect((error as ConnectorError).code).toBe(ConnectorErrorCodes.InvalidResponse);
    expect((error as ConnectorError).message).toContain('oversized');
    expect((error as ConnectorError).message).not.toContain(ACCESS_TOKEN);
  });

  it('[S14] rejects an oversized body already announced by content-length', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json', 'content-length': '999999999' },
      }),
    );

    const error = await captureError(connector.getUserInfo(callbackData(), harness.getSession));

    expect(error).toBeInstanceOf(ConnectorError);
    expect((error as ConnectorError).code).toBe(ConnectorErrorCodes.InvalidResponse);
  });
});
