import { ConnectorError, ConnectorErrorCodes } from '@logto/connector-kit';

/**
 * Minimal HTTP transport for the VK ID endpoints.
 *
 * The connector uses the platform `fetch` (Node.js >= 22, and the official Logto 1.46.0 image
 * ships Node.js 26) instead of adding an HTTP client dependency. That keeps the number of
 * third-party packages that end up inside the Logto image at two, which is the smallest
 * supply-chain surface this connector can have.
 */

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

/**
 * Upper bound for a VK ID response body.
 *
 * The token and profile payloads are a few kilobytes; the cap exists so that a misconfigured
 * `apiBaseUrl` (or a compromised mirror) cannot make the Logto process buffer an arbitrarily large
 * body. It is a resource-exhaustion guard, not a protocol limit.
 */
const MAX_RESPONSE_BYTES = 1_048_576;

/**
 * A non-2xx response from a VK ID endpoint.
 *
 * Only the OAuth 2.0 error fields are retained. The raw body is never stored, logged or attached
 * to the thrown error: token endpoint bodies contain access and refresh tokens, and an error path
 * must not become a token leak.
 */
export class VkApiError extends Error {
  public override readonly name = 'VkApiError';

  constructor(
    public readonly status: number,
    public readonly oauthError?: string,
    public readonly oauthErrorDescription?: string,
  ) {
    super(`VK ID responded with HTTP ${status}${oauthError ? ` (${oauthError})` : ''}`);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseJsonSafely = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const readString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/**
 * Detect an aborted request (`AbortSignal.timeout` fires a `DOMException` named `TimeoutError`,
 * a caller-supplied signal fires one named `AbortError`).
 */
const isAbortError = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');

/**
 * Build the error Logto 1.46.0 recognises as a transport failure.
 *
 * `describeTransportFailure()` in `@logto/core` duck-types an aborted provider request as a
 * `ky` `TimeoutError`: an `Error` whose `name` is `TimeoutError` and that carries the offending
 * `request.url`. Matching that shape turns a VK ID timeout into the documented
 * `502 connector.social_provider_unreachable` (code `ETIMEDOUT`) instead of an indistinguishable
 * `500 internal error`. The URL is reduced to origin + path by Logto before it is logged, so the
 * query string (which can contain a client secret) never reaches the log.
 */
const createTimeoutError = (url: string): Error & { request: { url: string } } => {
  const error = new Error(`VK ID request timed out: ${url}`) as Error & {
    request: { url: string };
  };
  error.name = 'TimeoutError';
  error.request = { url };
  return error;
};

export type PostFormOptions = {
  url: string;
  params: Record<string, string | undefined>;
  timeoutMs: number;
  fetchImpl?: FetchLike | undefined;
};

/**
 * `POST` an `application/x-www-form-urlencoded` request and return the parsed JSON body.
 *
 * Error behaviour:
 * - transport failure (DNS, TLS, connection reset) is re-thrown untouched so Logto reports it as
 *   `502 connector.social_provider_unreachable`;
 * - timeout is converted to a `ky`-compatible `TimeoutError` (see {@link createTimeoutError});
 * - non-2xx becomes {@link VkApiError} carrying only the OAuth error fields;
 * - a 2xx body that is not JSON becomes `ConnectorErrorCodes.InvalidResponse`.
 */
export const postForm = async ({
  url,
  params,
  timeoutMs,
  fetchImpl = fetch,
}: PostFormOptions): Promise<unknown> => {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      body.set(key, value);
    }
  }

  const signal = AbortSignal.timeout(timeoutMs);

  let response: Response;
  let text: string;

  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: body.toString(),
      signal,
    });

    const contentLength = response.headers.get('content-length');
    const declaredLength = contentLength === null ? Number.NaN : Number(contentLength);

    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
      throw new ConnectorError(ConnectorErrorCodes.InvalidResponse, {
        message: 'VK ID returned an oversized response',
      });
    }

    text = await response.text();

    if (text.length > MAX_RESPONSE_BYTES) {
      throw new ConnectorError(ConnectorErrorCodes.InvalidResponse, {
        message: 'VK ID returned an oversized response',
      });
    }
  } catch (error: unknown) {
    if (isAbortError(error)) {
      throw createTimeoutError(url);
    }

    throw error;
  }

  if (!response.ok) {
    const parsed = parseJsonSafely(text);
    const errorCode = isRecord(parsed) ? readString(parsed.error) : undefined;
    const errorDescription = isRecord(parsed) ? readString(parsed.error_description) : undefined;

    throw new VkApiError(response.status, errorCode, errorDescription);
  }

  const parsed = parseJsonSafely(text);

  if (parsed === undefined) {
    throw new ConnectorError(ConnectorErrorCodes.InvalidResponse, {
      message: 'VK ID returned a response that is not valid JSON',
    });
  }

  return parsed;
};
