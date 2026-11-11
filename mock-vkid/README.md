# mock-vkid

A dependency-free mock of the **modern VK ID OAuth 2.1** provider
(`id.vk.ru` / `id.vk.com`). It exists so the Logto VK ID social connector can be
tested end-to-end in Docker without touching real VK ID credentials.

- Node.js >= 20, ESM, **zero npm dependencies** (only `node:http`, `node:crypto`).
- Listens on `0.0.0.0:8090` by default.
- In-memory state only: no files, no database, no network egress.
- Verifies **PKCE S256** itself (`code_challenge` at `/authorize` vs
  `code_verifier` at the token endpoint) and enforces **single-use** codes.
- Switchable failure modes for negative-path tests (see below).

## Run directly

```powershell
node mock-vkid/src/index.mjs
# or
cmd /c "npm --prefix mock-vkid start"
```

```bash
node mock-vkid/src/index.mjs
```

## Run the smoke tests

```powershell
cmd /c "npm --prefix mock-vkid test"
```

```bash
node --test   # from inside mock-vkid/
```

The suite covers the S256 primitive (RFC 7636 test vector), the authorize
validation matrix, PKCE verification, single-use and concurrent code
redemption, token-endpoint error/HTTP/JSON variants, `user_info` variants,
request recording and secret redaction.

## Endpoints

| Method | Path                | Purpose                                                                                                                                                                                                                             |
| ------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/authorize`        | VK ID authorization endpoint: validates the request, PKCE S256 challenge, `client_id`, `redirect_uri` allowlist, `response_type=code`, `state`; issues a one-time code and 302-redirects to `redirect_uri?code=&state=&device_id=`. |
| POST   | `/oauth2/auth`      | Token endpoint (`application/x-www-form-urlencoded`): `grant_type=authorization_code` (and `refresh_token`), verifies single-use `code`, PKCE `code_verifier`, `client_id`, `redirect_uri`, `device_id`.                            |
| POST   | `/oauth2/user_info` | Returns `{ "user": { user_id, first_name, last_name, avatar, email, phone, sex, verified, birthday } }`. Accepts `access_token` in the form body, query string, or `Authorization: Bearer`.                                         |
| GET    | `/health`           | Liveness/readiness probe, returns `200 {"status":"ok", ...}`.                                                                                                                                                                       |
| GET    | `/debug/state`      | Recorded requests, counters and live-token counts. Credentials are redacted.                                                                                                                                                        |
| POST   | `/debug/reset`      | Clears all in-memory state (useful between integration tests).                                                                                                                                                                      |
| GET    | `/`                 | Endpoint map (handy for a quick browser check).                                                                                                                                                                                     |

## Configuration (env vars)

| Variable                                       | Default                                                                                                                             | Meaning                                                                                                                                                                                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MOCK_VKID_HOST`                               | `0.0.0.0`                                                                                                                           | Bind address.                                                                                                                                                                                                                     |
| `MOCK_VKID_PORT`                               | `8090`                                                                                                                              | Bind port.                                                                                                                                                                                                                        |
| `MOCK_VKID_CLIENT_IDS` / `MOCK_VKID_CLIENT_ID` | `mock-vkid-client-id`                                                                                                               | Comma-separated allowlist of accepted client IDs.                                                                                                                                                                                 |
| `MOCK_VKID_CLIENT_SECRET`                      | unset                                                                                                                               | If set, a provided `client_secret` must match. VK ID public clients normally do not send one.                                                                                                                                     |
| `MOCK_VKID_REDIRECT_URIS`                      | `.../callback`, `.../callback/vkid`, `.../callback/mock-vkid`, `http://127.0.0.1:3001/callback`, `http://localhost:3001/callback/*` | Comma-separated allowlist of redirect URIs. An entry ending in `*` is a prefix wildcard that keeps scheme + host + path prefix pinned (used by the compose stack, because Logto derives the callback path from the connector id). |
| `MOCK_VKID_ALLOW_ANY_REDIRECT`                 | `0`                                                                                                                                 | **Insecure.** Accept any redirect URI; only for ad-hoc debugging.                                                                                                                                                                 |
| `MOCK_VKID_STATE_OPTIONAL`                     | `0`                                                                                                                                 | Set to `1` to stop requiring `state` at `/authorize`.                                                                                                                                                                             |
| `MOCK_VKID_DEVICE_ID_OPTIONAL`                 | `0`                                                                                                                                 | Set to `1` to stop binding `device_id` to the code.                                                                                                                                                                               |
| `MOCK_VKID_SLOW_MS`                            | `30000`                                                                                                                             | Delay used by `?mock_slow=1` (simulates a provider that never answers in time).                                                                                                                                                   |
| `MOCK_VKID_TOKEN_MODE`                         | unset                                                                                                                               | Default token-response variant, see below.                                                                                                                                                                                        |
| `MOCK_VKID_USER_MODE`                          | unset                                                                                                                               | Default `user_info` variant, see below.                                                                                                                                                                                           |
| `MOCK_VKID_USER_JSON`                          | unset                                                                                                                               | JSON object merged over the default mock user.                                                                                                                                                                                    |
| `MOCK_VKID_AUTH_CODE_TTL_MS`                   | `300000`                                                                                                                            | Authorization code lifetime.                                                                                                                                                                                                      |
| `MOCK_VKID_ACCESS_TOKEN_TTL_SECONDS`           | `3600`                                                                                                                              | Access token lifetime.                                                                                                                                                                                                            |
| `MOCK_VKID_LOG_REQUESTS`                       | `1`                                                                                                                                 | Record requests for `/debug/state`.                                                                                                                                                                                               |

## Failure modes

All modes are accepted either as env vars (globally) or as query/form
parameters (per request). Modes set on `/authorize` are stored with the
authorization code, so a connector that never forwards `mock_*` parameters can
still be exercised end-to-end.

### `/authorize`

| Trigger                                                                                                                                                                               | Behavior                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `mock_error=access_denied` (also `invalid_request`, `invalid_client`, `invalid_scope`, `unauthorized_client`, `unsupported_response_type`, `server_error`, `temporarily_unavailable`) | 302 back to `redirect_uri` with `error`, `error_description`, `state`.  |
| `mock_error_description=...`                                                                                                                                                          | Custom `error_description`.                                             |
| `mock_no_device_id=1`                                                                                                                                                                 | Redirect omits `device_id` (and the token endpoint stops requiring it). |
| `mock_no_state=1`                                                                                                                                                                     | Redirect omits the `state` echo.                                        |
| `mock_authorize_status=500`                                                                                                                                                           | Returns that raw HTTP status from `/authorize` (no redirect).           |
| `mock_slow=1`                                                                                                                                                                         | Delays `MOCK_VKID_SLOW_MS` before responding.                           |
| `mock_bad_pkce=1`                                                                                                                                                                     | Code is issued, but the token endpoint rejects the (correct) verifier.  |
| `mock_token_mode=<mode>`                                                                                                                                                              | Stores a token-endpoint variant with the code.                          |
| `mock_user_mode=<mode>`                                                                                                                                                               | Stores a `user_info` variant with the token.                            |

### `/oauth2/auth`

| Mode                               | Behavior                                                   |
| ---------------------------------- | ---------------------------------------------------------- |
| `http_400`, `http_401`, `http_500` | Return that HTTP status with a JSON error body.            |
| `invalid_json`                     | HTTP 200 with a deliberately truncated (unparseable) body. |
| `empty`                            | HTTP 200 with `{}`.                                        |
| `missing_access_token`             | Omit `access_token`.                                       |
| `missing_refresh_token`            | Omit `refresh_token`.                                      |
| `missing_id_token`                 | Omit `id_token`.                                           |
| `missing_user_id`                  | Omit `user_id`.                                            |
| `missing_scope`                    | Omit `scope`.                                              |
| `missing_state`                    | Omit `state`.                                              |
| `missing_expires_in`               | Omit `expires_in`.                                         |

### `/oauth2/user_info`

| Mode                                                                                                                                       | Behavior                           |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| `http_500`, `http_401`                                                                                                                     | Return that HTTP status.           |
| `invalid_json`                                                                                                                             | HTTP 200 with an unparseable body. |
| `missing_email` / `missing_avatar` / `missing_phone` / `missing_birthday` / `missing_first_name` / `missing_last_name` / `missing_user_id` | Omit that field.                   |
| `empty_strings`                                                                                                                            | Every string field becomes `""`.   |
| `null_fields`                                                                                                                              | Every field becomes `null`.        |
| `empty_user`                                                                                                                               | `{ "user": {} }`.                  |

## Example: full happy-path exchange

```powershell
# 1. authorize with PKCE S256 (verifier shown for demonstration only)
node -e "const c=require('node:crypto');const v=c.randomBytes(48).toString('base64url');console.log('verifier='+v);console.log('challenge='+c.createHash('sha256').update(v).digest('base64url'))"
```

Then open the printed `http://localhost:8090/authorize?...` URL with the printed
challenge, take the `code` **and** `device_id` from the redirected URL (the
provider produces `device_id` - it is not a request parameter), and exchange
the code:

```powershell
Invoke-WebRequest -Method POST -Uri http://localhost:8090/oauth2/auth `
  -ContentType application/x-www-form-urlencoded `
  -Body "grant_type=authorization_code&code=$code&code_verifier=$verifier&client_id=mock-vkid-client-id&redirect_uri=http%3A%2F%2Flocalhost%3A3001%2Fcallback%2Fvk-universal&device_id=$deviceId"
```

A ready-made script is not committed on purpose: the integration-test driver in
`tests/` (owned by the connector team) drives these endpoints directly.

## Running inside the compose stack

`docker compose -f compose.test.yaml up -d --build` runs this mock with
`network_mode: "service:logto"`, i.e. **inside the Logto container's network
namespace**. That keeps a single origin (`http://localhost:8090`) valid for both
the Logto connector and the host browser, while the host reaches it through the
port published by the `logto` service (`8090` by default, `MOCK_VKID_HOST_PORT` to
override). The connector accepts an explicit plain-HTTP `apiBaseUrl`, so a LAN
address would also work — the shared namespace is simply the zero-config choice.
