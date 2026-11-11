# Security audit — upstream `@workingbit/connector-vk@0.0.4`

This document is the audit that preceded the rewrite. It records what was examined, what was
found, what was changed, and what remains.

**Status of this document:** findings refer to the upstream package as published on npm. The
"Fixed in" column points at the file in this repository where the behaviour changed.

---

## 1. Scope and method

| Item             | Value                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| Artifact         | `workingbit-connector-vk-0.0.4.tgz` (7 files, 12 212 bytes)                                                    |
| npm shasum       | `c4c73b88271b08a41271b9a14faf38e556d962d0`                                                                     |
| npm integrity    | `sha512-2epu6hd1rsam0JpraLz1pjUHuMhpF8Vg/dMmcKi3S2yI+eRfK4ZOJxQUPsn2Oos1cupMEq9NePPlkA0DOktgug==`              |
| Declared version | `0.0.4` (latest; published 2026-10-23, five versions in one day: `0.0.0-stage` → `0.0.4`)                      |
| Declared license | `MPL-2.0`                                                                                                      |
| Published files  | `lib/index.js`, `lib/index.js.map`, `lib/index.d.ts`, `logo.svg`, `logo-dark.svg`, `README.md`, `package.json` |

Method:

1. Bytes-on-disk are the authority. The published bundle, its source map and `package.json` were
   read directly.
2. The source map contains `sourcesContent`, so the original TypeScript was recovered byte for byte
   and cross-checked against the public repository (see §2). Every finding below was confirmed
   against both the shipped JavaScript and the recovered TypeScript.
3. Protocol correctness was verified against official VK documentation and the official
   `VKCOM/vkid-web-sdk` source (`docs/research/VK-ID-PROTOCOL.md`), not against the package's own
   assumptions.
4. Platform behaviour was verified against Logto OSS `v1.46.0`
   (`docs/research/LOGTO-146-COMPAT.md`), including the connector loader, session API, error
   mapping and version gate.
5. The dependency tree was checked with `npm audit`; the bundle was scanned for network endpoints,
   filesystem access, dynamic code loading, telemetry and secret handling.

The upstream artifacts are **not vendored in this repository**; they are listed here by hash so the
examined bytes can be fetched from npm and verified:

```
workingbit-connector-vk-0.0.4.tgz   # npm tarball, shasum c4c73b88271b08a41271b9a14faf38e556d962d0
package/…                           # extracted npm package, byte-identical
recovered-src/…                     # TypeScript recovered from lib/index.js.map
```

---

## 2. Provenance

The npm package does not declare a `repository` field, and the author field is a placeholder
(`Aleksei P. <user@example.com>`). Provenance was nevertheless established with a hash chain:

1. `package.json` in the tarball contains `"gitHead": "a8de9e8748e06dfda31cab06b55a53a0bffa846a"`.
2. The public repository [lynx-r/logto-connector-vk](https://github.com/lynx-r/logto-connector-vk)
   (`main`, commits dated 2026-10-23, same day as the npm publishes) contains
   `src/index.ts`, `src/constant.ts`, `src/types.ts`, `src/index.test.ts`, `src/mock.ts`,
   `logo.svg`, `logo-dark.svg` and a `package.json` named `@workingbit/connector-vk`.
3. The three recovered source files are **byte-identical** to the repository blobs:

   | File              | Git blob (recovered) | Git blob (GitHub) | Result    |
   | ----------------- | -------------------- | ----------------- | --------- |
   | `src/index.ts`    | `982740757cdb…`      | `982740757cdb…`   | identical |
   | `src/constant.ts` | `dc28c15f6aee…`      | `dc28c15f6aee…`   | identical |
   | `src/types.ts`    | `75f3fff83a76…`      | `75f3fff83a76…`   | identical |

4. The repository's `src/index.test.ts` and `README.md` are **copies of Logto's GitHub connector**
   (they nock `GET /user`, assert GitHub fields such as `avatar_url`, `rawData.userEmails`, the
   scope `read:user user:email`, and the Octocat fixture). The implementation under `src/` keeps
   the same call structure. The package is therefore, with high confidence, a renamed derivative
   of Logto's `connector-github`, retargeted at VK ID endpoints.

**Consequence:** the upstream package is derived from Logto code (MPL-2.0), declares MPL-2.0, and
must remain MPL-2.0. See §4.

---

## 3. Findings

Severity uses CVSS-style judgement: **Critical** = authentication can be subverted or credentials
leak; **High** = the integration cannot work correctly, or a documented security control is absent;
**Medium** = hardening gap with a plausible attack path; **Low** = correctness, robustness or
compliance; **Info** = observation.

| ID   | Severity | Finding                                                                                                                                | Fixed in                            |
| ---- | -------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| F-01 | Critical | Callback validation requires `redirectUri`, which VK ID never sends — every real login fails                                           | `src/types.ts`, `src/index.ts`      |
| F-02 | High     | OAuth `state` is never bound to the authorization request; a fresh random value is generated at token time                             | `src/types.ts`, `src/index.ts`      |
| F-03 | High     | Access/refresh/id tokens can be written into error payloads (`JSON.stringify(httpResponse)`)                                           | `src/http.ts`, `src/client.ts`      |
| F-04 | High     | `clientSecret` is mandatory in config but never used; confidential-app `service_token` is unsupported                                  | `src/types.ts`, `src/client.ts`     |
| F-05 | High     | Token exchange takes `redirect_uri` from callback parameters instead of server-side state                                              | `src/index.ts`                      |
| F-06 | High     | Incompatible with Logto 1.46.0: exact `@logto/connector-kit@5.1.2` pin fails the loader's version gate; connector is silently skipped  | `package.json`                      |
| F-07 | Medium   | Token-response schema requires `refresh_token`, `id_token`, `state`, `scope`, `user_id` — a valid response missing one fails           | `src/types.ts`                      |
| F-08 | Medium   | Profile name drops `last_name`                                                                                                         | `src/profile.ts`                    |
| F-09 | Medium   | Provider e-mail is forwarded with no verification policy, although Logto links accounts by e-mail                                      | `src/profile.ts`, `src/constant.ts` |
| F-10 | Medium   | Phone is forwarded unnormalized and without a linking policy, although Logto prefers phone over e-mail when linking                    | `src/profile.ts`                    |
| F-11 | Medium   | No `tokenResponse.user_id` ↔ `user_info.user_id` consistency check (token substitution undetected)                                    | `src/index.ts`                      |
| F-12 | Medium   | Declined-consent callbacks are not mapped to `AuthorizationFailed`; the raw callback object is stringified into the error              | `src/index.ts`                      |
| F-13 | Medium   | `code_verifier` is checked for presence only — no length/charset validation, and no session binding to redirect URI/state              | `src/index.ts`                      |
| F-14 | Low      | Avatar URL is forwarded unvalidated (`javascript:`/relative values reach Logto clients)                                                | `src/profile.ts`                    |
| F-15 | Low      | Config guard accepts empty strings and arbitrary `apiBaseUrl`; no endpoint/URL validation                                              | `src/types.ts`                      |
| F-16 | Low      | Timeout is hard-coded to 5 s and not configurable                                                                                      | `src/constant.ts`, `src/http.ts`    |
| F-17 | Low      | `isTokenStorageSupported: true` but no refresh-token support, and VK refresh requires the `device_id` that is never persisted          | `src/index.ts`                      |
| F-18 | Low      | `README.md` is a verbatim copy of Logto's **GitHub** connector README (GitHub setup steps, GitHub scopes)                              | `README.md`                         |
| F-19 | Low      | No `LICENSE` file in the package or the repository, despite `"license": "MPL-2.0"`; no attribution to Logto                            | `LICENSE`, `NOTICE`                 |
| F-20 | Low      | Published package does not declare `pkce-challenge` (imported by `src/index.ts`), only bundles it; rebuilding from source fails        | `src/pkce.ts`                       |
| F-21 | Low      | No working test suite: the shipped tests target the GitHub API and call a 2-argument `getAccessToken` that no longer exists            | `tests/**`                          |
| F-22 | Info     | Dead code: unused `authorizationCallbackErrorGuard`, always-true `assert(access_token)`, unused `generateState()` in the token request | `src/**`                            |

### F-01 — Critical — the callback guard rejects every genuine VK ID callback

`src/types.ts`:

```ts
export const authResponseGuard = z.object({
  code: z.string(),
  device_id: z.string(),
  redirectUri: z.string(), // ← never sent by VK ID
});
```

VK ID redirects to `redirect_uri?code=…&state=…&device_id=…` (plus an optional `type=code_v2`).
`redirect_uri` is **not** one of the callback parameters — confirmed against the VK ID API
reference, the web/iOS/Android "authorization without SDK" guides, the FAQ and the flow
descriptions (`docs/research/VK-ID-PROTOCOL.md` §3, six independent sources). The guard therefore
fails on every successful authorization and the connector throws
`ConnectorErrorCodes.General` with the callback object stringified into the message.

Reproduction: any authorization attempt. Also reproducible offline —

```js
require('zod')
  .object({ code: z.string(), device_id: z.string(), redirectUri: z.string() })
  .safeParse({ code: 'c', device_id: 'd' }).success === false;
```

Impact: total integration failure. Fix: require only `code` and `device_id`; obtain the redirect
URI from the connector session written during `getAuthorizationUri`.

### F-02 — High — `state` is not bound to the authorization request

```ts
const generateState = () => crypto.randomUUID().replaceAll('-', '');
// ...
const state = generateState();           // fresh value at token time
await ky.post(accessTokenEndpoint, { body: new URLSearchParams({ …, state }) });
```

The callback's `state` is never compared with anything. VK ID documents `state` as a
mandatory round-trip value ("Строка должна возвращаться сервису без изменений… значения должны
полностью совпадать, иначе ответ можно считать подменённым"), and the official SDK re-sends the
original value and verifies the echo. Sending a fabricated value discards that integrity check.
Logto core does not verify `state` server-side either (it is verified by the Logto client), so for
this connector the provider round-trip is the only server-side CSRF binding available.

Fix: persist the authorize `state` (and redirect URI) in the connector session, replay both at the
token endpoint, and fail on a non-empty mismatch in the token response or the callback.

### F-03 — High — tokens are placed into error payloads

```ts
const result = accessTokenResponseGuard.safeParse(httpResponse);
if (result.success) { … }
throw new ConnectorError(ConnectorErrorCodes.General, JSON.stringify(httpResponse)); // ← tokens
```

If VK ID returns a token payload that does not satisfy the (over-strict, see F-07) guard — for
example because `refresh_token` is absent — the _complete_ token response is serialised into a
`ConnectorError` message. `ConnectorError` builds its `message` from `JSON.stringify(data)`, and
Logto logs connector errors, so access and refresh tokens can land in the application log.
`authorizationCallbackHandler` has the same pattern with the callback object, which contains the
authorization code.

Fix: errors carry only OAuth error codes, HTTP statuses and field names — never raw provider
payloads. The new test suite asserts that no token ever appears in any error path (scenario 15).

### F-04 — High — wrong credential model

`clientSecret` is required by `vkConfigGuard` and by the Admin Console form, yet
`getAccessToken()` never sends it. VK ID's token exchange has **no** `client_secret` parameter at
all: the "protected key" is for client-side SDKs, and confidential applications instead send
`service_token` (and must call from an allow-listed IP). The upstream configuration is therefore
both misleading and unable to express the confidential-app case.

Fix: `clientSecret` removed; optional `serviceToken` added and mapped to `service_token`.

### F-05 — High — `redirect_uri` sourced from attacker-reachable input

Because the callback guard demanded `redirectUri`, the value used in the token request could only
have come from request parameters:

```ts
const { code, device_id, redirectUri } = authResponse; // authResponse = callback params
```

Had VK ID ever echoed such a parameter, an attacker could influence the token request. The correct
source is the server-side session captured at authorization time; the redirect URI is also required
to be byte-identical between authorize and token calls by VK ID.

### F-06 — High — silently skipped by Logto 1.46.0

`@logto/cli`'s `loadConnector()` reads `<pkg>/package.json` and requires
`semver.satisfies(<installed connector-kit version>, <declared range>)`. Logto 1.46.0 installs
`@logto/connector-kit` **5.2.0**, while the package declares the exact pin `"5.1.2"`.
`satisfies('5.2.0', '5.1.2') === false`, so the loader logs
`[load-connector] skip … due to error` and the connector never appears in the Admin Console.
The only workaround is `IGNORE_CONNECTOR_VERSION_CHECK`, which Logto documents as "highly
discouraged in production".

Fix: declare `"@logto/connector-kit": "^5.2.0"` and verify the API against the real 1.46.0 image.

### F-07 — Medium — over-strict token-response schema

```ts
export const accessTokenResponseGuard = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  id_token: z.string(),
  expires_in: z.number(),
  user_id: z.number(),
  state: z.string(),
  scope: z.string(),
});
```

Every field is mandatory. Only `access_token` is guaranteed. Any future or conditional variation
(no `scope`, `user_id` encoded as a string, an empty `state`) turns a successful login into a
failure — and, via F-03, into a token-leaking failure.

### F-08 — Medium — surname is dropped

```ts
const { user_id: id, avatar, email, first_name: name, phone } = result.data.user;
```

VK ID returns `first_name` and `last_name` separately. Logto displays `name`, so every VK user
would be shown by first name only. Fix: `name = [first_name, last_name, patronymic].join(' ')`.

### F-09 / F-10 — Medium — identifiers used for account linking are uncontrolled

`email` and `phone` are copied straight from the provider profile into `SocialUserInfo`. Logto's
`findSocialRelatedUser()` uses those values to attach a social identity to an **existing** Logto
account, preferring `phone` over `email`. Consequences:

- a VK ID e-mail that VK has not verified (or that has been changed) can be used to take over an
  existing Logto account that happens to use the same address;
- an unnormalized phone (`79991234567`) never matches Logto's normalized form, or matches wrongly;
- the phone path is the more dangerous one because Logto prefers it.

Fix: both identifiers are opt-in (`syncEmail`, `syncPhone`, default `false`), the e-mail is
validated and lower-cased, and the phone is normalized to E.164 or dropped. Administration
documentation explains the account-linking consequence.

### F-11 — Medium — no subject consistency check

The token endpoint returns a numeric `user_id`; `user_info` returns a string `user_id`. The
connector ignores the former. If an access token belonging to another user is substituted (or a
provider bug mixes responses), Logto attaches the wrong identity. Fix: compare both values and fail
with `SocialAccessTokenInvalid` on mismatch.

### F-12 — Medium — provider errors degrade to a generic stringified object

`authorizationCallbackErrorGuard` is defined and never used. A declined authorization therefore
fails `authResponseGuard` and produces
`new ConnectorError(ConnectorErrorCodes.General, JSON.stringify(parameterObject))`, which maps to a
500-class `connector.general` error and echoes callback parameters back. Logto 1.46.0 does map
`access_denied` to `connector.authorization_failed` before the connector runs, but the connector
must not depend on that and must never echo raw parameters.

### F-13 — Medium — session validation is presence-only

```ts
assert(code_verifier && typeof code_verifier === 'string', …);
```

No length or charset check (RFC 7636 requires 43–128 unreserved characters), and the session does
not record which redirect URI/state the verifier belongs to, so a stale or crossed session is
indistinguishable from a fresh one.

### F-14 … F-19 — Low — robustness, documentation, licensing

- **F-14** avatar: any string is forwarded; `javascript:` or relative URLs must not reach a client.
- **F-15** config: `z.string()` permits `""`; `apiBaseUrl` is not validated, so a typo silently
  breaks every login and a non-TLS origin would send tokens in clear text.
- **F-16** timeout fixed at 5 s, no timeout-specific error class.
- **F-17** token storage is advertised, but the refresh flow is not implemented and VK's refresh
  grant additionally needs the `device_id`, which is not persisted.
- **F-18** the README describes creating a **GitHub** OAuth app and GitHub scopes (`repo`,
  `read:user`) — content copied from Logto's GitHub connector. An administrator following it would
  configure the wrong provider.
- **F-19** `"license": "MPL-2.0"` is declared, but neither the tarball nor the repository contains
  the license text, and nothing acknowledges that the code derives from Logto. For a derivative
  work that is an attribution gap (§4).

---

## 4. Licensing

| Fact                                                         | Evidence                                             |
| ------------------------------------------------------------ | ---------------------------------------------------- |
| Upstream declares `MPL-2.0`                                  | `package.json` in tarball and repository             |
| No `LICENSE` file shipped or published                       | tarball file list (7 files); repository root listing |
| No `repository` field; author e-mail is a placeholder        | `package.json`                                       |
| Upstream derives from Logto's `connector-github` (MPL-2.0)   | §2.4 — copied tests and README, same structure       |
| Upstream's TypeScript source is published via the source map | `lib/index.js.map` contains `sourcesContent`         |

**Assessment.** The package is MPL-2.0 by declaration, and its origin (Logto, MPL-2.0) makes
MPL-2.0 the correct and required license for any derivative. Publishing a modified version is
permitted; the obligations are to keep the license, keep notices, make the source of the covered
files available, and identify modifications. The upstream package itself is incomplete on the
last two points (no license text, no attribution, no modification notice).

**What this repository does.**

- The whole project is licensed **MPL-2.0** (`LICENSE`), the same license as the upstream work;
  it is not relicensed and is not presented as original.
- `NOTICE` records the provenance chain:
  `@workingbit/connector-vk@0.0.4` → `lynx-r/logto-connector-vk` → Logto `connector-github`
  (`logto-io/logto`, MPL-2.0), with the upstream integrity hash.
- `NOTICE` lists every upstream file whose content was carried over and the nature of the changes
  (see `docs/ARCHITECTURE.md` §"Relationship to the upstream connector").
- Source is published in this repository in the same form as the distributed `lib/`.
- VK ID trademarks belong to their owners. The upstream logo files are **not** redistributed: the
  connector icon (`logo.png`/`logo-dark.png`) is artwork supplied for this project that carries the
  VK wordmark and is used nominatively to identify the provider. The upstream npm tarball is not
  redistributed here; its hash is recorded above as audit evidence, and it is never part of the
  build.

No license incompatibility was found. Publication of this derivative is therefore permitted.

---

## 5. Supply chain

### 5.1 Declared dependencies

| Package                  | Upstream                                    | Notes                                      |
| ------------------------ | ------------------------------------------- | ------------------------------------------ |
| `@logto/connector-kit`   | `5.1.2` (exact)                             | F-06; must be `^5.2.0` for Logto 1.46.0    |
| `@silverhand/essentials` | `^2.9.1`                                    | only used for `assert()`; removed          |
| `ky`                     | `^1.2.3`                                    | replaced with platform `fetch`             |
| `zod`                    | `3.24.3`                                    | kept (same instance Logto already bundles) |
| `pkce-challenge`         | dev-only in the tarball, imported by source | F-20; replaced with `node:crypto`          |

### 5.2 Marginal impact on the Logto image

The connector's runtime dependencies are `@logto/connector-kit` and `zod`. Both are already present
in the official Logto 1.46.0 image (`@logto/connector-kit` is what loads connectors, and
`@logto/core` pins `zod@3.24.3`). Node resolves both from the image, so installing this connector
adds **no new runtime package** to the Logto container.

### 5.3 `npm audit`

Observed on the build tree (`npm audit --json`): 2 critical, 5 high, 12 moderate, 1 low.

- **Critical** (`vitest`, `tinypool`): development-only test runner. Not shipped, not present in
  the Logto image, not reachable at runtime. Tracked for upgrade.
- **High** `zod < 4.6.6` (GHSA-mrhx-c7xc-m3w5, memory exhaustion while validating oversized
  constrained collections): inherited. Logto 1.46.0 itself pins `zod@3.24.3` and
  `@logto/connector-kit` requires that line, so the connector cannot upgrade it independently. The
  connector's own schemas contain no constrained array/collection validators, so the advisory's
  attack shape is not reachable through this connector's inputs.
- **High** `@logto/connector-kit` / `@withtyped/server` / `nanoid` / `@logto/language-kit`: all
  inherited from the kit and already present in the image; `nanoid` is not on any code path this
  connector executes.

CI therefore gates on **critical** advisories for production dependencies and reports the full
audit, instead of failing on advisories that come from Logto's own pinned packages (see
`.github/workflows/ci.yml`).

### 5.4 Bundle inspection — negative results

Scanned `lib/index.js` (the entire shipped code) for: absolute URLs, `eval`, `new Function`,
dynamic `require`, `child_process`, `node:fs`, `process.env`, `atob`, `Buffer`, base64 blobs,
obfuscation. Results:

- **Network endpoints — exactly three**, all VK ID: `https://id.vk.ru/authorize`,
  `https://id.vk.ru/oauth2/auth`, `https://id.vk.ru/oauth2/user_info`. No telemetry, analytics,
  survey, update-check or "phone home" endpoint of any kind.
- **No filesystem access, no process spawning, no environment reads, no dynamic code loading, no
  obfuscation.** The only dynamic import is `import("crypto")` inside the bundled
  `pkce-challenge` (a documented Node fallback for `globalThis.crypto`).
- **No secrets are hard-coded.** No tokens, keys, IPs or internal hostnames.
- The source map is complete and consistent with the bundle (no unreferenced extra code).

The one supply-chain smell is **F-20**: third-party code (`pkce-challenge`) is compiled into the
published artifact while the dependency is not declared, so the tarball's contents cannot be
reproduced from its own metadata.

---

## 6. What the rewrite changes

| Area                         | Upstream                                    | This project                                                   |
| ---------------------------- | ------------------------------------------- | -------------------------------------------------------------- |
| Callback parameters          | requires `code`, `device_id`, `redirectUri` | requires `code`, `device_id`; optional `state`                 |
| `redirect_uri` at token time | from callback                               | from connector session                                         |
| `state`                      | fabricated, unverified                      | persisted, replayed, verified (callback + token response)      |
| PKCE verifier                | from `pkce-challenge`, presence check       | `node:crypto`, 256-bit, RFC 7636 validated shape               |
| Session payload              | `code_verifier` only                        | `vk_code_verifier`, `vk_redirect_uri`, `vk_state` (namespaced) |
| Token request                | `client_id`, no secret, random state        | `client_id`, optional `service_token`, replay state/redirect   |
| Token errors                 | raw body stringified                        | OAuth error code + status only                                 |
| Token schema                 | 7 mandatory fields                          | `access_token` mandatory, rest optional                        |
| Subject binding              | none                                        | token `user_id` vs profile `user_id` compared                  |
| Profile `name`               | `first_name`                                | `first_name last_name [patronymic]`                            |
| E-mail / phone               | always forwarded                            | opt-in, validated, E.164-normalized                            |
| Avatar                       | raw string                                  | absolute http(s) URL only                                      |
| Provider errors              | generic + raw object                        | `AuthorizationFailed` for `error` callbacks                    |
| HTTP client                  | `ky` (extra dependency)                     | platform `fetch`, `AbortSignal.timeout`                        |
| Timeout error                | `ky` `TimeoutError`                         | equivalent shape, mapped by Logto to `502`                     |
| connector-kit                | exact `5.1.2`                               | range `^5.2.0` (loads in Logto 1.46.0)                         |
| Tests                        | GitHub connector tests, not runnable        | `tests/**`, 16 required scenarios                              |
| Docs                         | GitHub connector README                     | VK ID specific RU/EN docs                                      |

---

## 7. Residual and accepted risks

| Risk                                                                                                                   | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VK OAuth 2.1 requires `state` ≥ 32 characters; Logto 1.46.0 generates 14                                               | **Fixed in the derived image.** VK's API reference requires the length and the official SDKs enforce `kMinStateLength = 32`. The connector cannot lengthen the value (VK echoes it and the Experience compares it), so the Docker build patches the pinned Experience bundle to 32 random bytes (46 characters) and fails if the pattern changes.                                                                                                                                                                                             |
| VK ID only accepts redirect URIs on ports 80/443 (`localhost` included)                                                | **Open / environment.** A Logto dev instance on `:3001` cannot be a VK ID redirect target; production must use a public HTTPS host on 443. Documented in `docs/VK-ID-SETUP.md`.                                                                                                                                                                                                                                                                                                                                                               |
| `state` enforcement at VK ID's token endpoint is undocumented (API reference: required; iOS guide: optional)           | Mitigated: the value is always replayed; a non-empty mismatch fails.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Token-endpoint error codes are not standardized by VK ID                                                               | Mitigated: any 4xx is mapped to `SocialAuthCodeInvalid`; no branching on unverified codes.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `id_token` is not OIDC-verifiable (no discovery/JWKS; VK's own example is internally inconsistent about the algorithm) | Accepted: identity comes from `user_info` over TLS with a token obtained directly from VK ID; the JWT is never used as a trust anchor.                                                                                                                                                                                                                                                                                                                                                                                                        |
| Refresh tokens: VK rotates single-use refresh tokens and requires `device_id`                                          | Accepted: no refresh grant is implemented, so no half-working refresh path. Token storage still works for one access-token lifetime (1 h).                                                                                                                                                                                                                                                                                                                                                                                                    |
| `zod@3.24.3` advisory (5.3)                                                                                            | Accepted / inherited from Logto 1.46.0; not reachable via this connector's schemas.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Development-dependency advisories (`vitest`, `tinypool`)                                                               | Accepted: not shipped; tracked in CI report.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `apiBaseUrl` is administrator-controlled and can point the token exchange at any `http(s)` origin                      | **Accepted.** The value lives in the Logto connector configuration and only a Logto administrator can change it, so it is not an attacker-reachable SSRF primitive. HTTPS is the default; an explicit plain-HTTP origin is accepted because it is an administrator decision (LAN mirror or integration test), and the documentation states that the access token, the authorization code and the PKCE verifier then travel unencrypted. Also enforced: no credentials in the origin, no path/query/fragment, response bodies capped at 1 MiB. |
| An `error`/`error_description` value can carry arbitrary text into the Logto log                                       | **Mitigated.** Both are stripped of control and Unicode format characters and capped (200 / 64 characters) before they reach an error payload, so they cannot forge log lines or flood the log. Provider text is still provider text: it is bounded, not interpreted.                                                                                                                                                                                                                                                                         |
| The VK user id becomes a Logto social identity verbatim                                                                | **Mitigated.** It must match `[A-Za-z0-9._:-]{1,64}`; a hostile value fails closed with `InvalidResponse` and is never echoed into the error.                                                                                                                                                                                                                                                                                                                                                                                                 |

---

## 8. How the fixes were verified

- `npx tsc --noEmit` — strict typecheck.
- `npm run lint` — ESLint.
- `npm test` — unit tests covering the 16 required scenarios (PKCE, authorize URL, callback,
  token exchange, profile mapping, missing `device_id`, corrupted verifier, provider error, token
  error, userinfo error, invalid JSON, missing e-mail/avatar, invalid config, timeout/network
  error, absence of secrets in diagnostics, replay/session mismatch), plus the input-hardening
  tests: sanitised and bounded provider error text, strict identity validation, bidi/zero-width
  stripping, credential-bearing `apiBaseUrl` rejection and oversized-response rejection.
- `npm run build` — `lib/index.js` ESM bundle whose only imports are `@logto/connector-kit` and
  `zod` (verified by inspecting the emitted file).
- Docker integration against the real `svhd/logto:1.46.0` image with a mock VK ID server:
  connector discovery, configuration, authorize URL generation, callback handling and profile
  delivery — see `docs/LOCAL-TESTING.md` for the exact, actually executed steps and results.

Not verified (and not claimed): a real end-to-end login against the production VK ID service. That
requires a registered VK ID application, a 443 redirect URI and real user credentials; it is
documented as a manual test in `docs/VK-ID-SETUP.md` §"Manual verification".
