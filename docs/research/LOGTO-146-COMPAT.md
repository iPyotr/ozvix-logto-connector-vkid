# Logto OSS 1.46.0 — connector compatibility notes

Everything below was verified against the real `svhd/logto:1.46.0` image and the
[`logto-io/logto`](https://github.com/logto-io/logto) source at tag `v1.46.0`. Commands and output
are quoted; anything not verified is marked **UNCONFIRMED**.

This file is the evidence base for [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §6 and
[`../INSTALL-LOGTO-DOCKER.md`](../INSTALL-LOGTO-DOCKER.md) §1.

---

## 1. Runtime

```console
$ docker run --rm --entrypoint sh svhd/logto:1.46.0 -c "node --version"
v26.13.0
```

The image is `node:26-alpine` based (root `Dockerfile` at v1.46.0:
`FROM node:26-alpine AS app`, `WORKDIR /etc/logto`, `ENTRYPOINT ["npm","run"]`, `CMD ["start"]`).
Connector code therefore runs on Node.js 26 with full ESM support, `fetch`, `AbortSignal.timeout`
and `node:crypto`.

`@logto/core` 1.46.0 declares `engines: { node: "^22.23.4 || ^24.22.1 || ^26.12.1" }`.

## 2. Connector Kit version

```console
$ docker run --rm --entrypoint sh svhd/logto:1.46.0 -c \
    "head -4 /etc/logto/packages/core/node_modules/@logto/connector-kit/package.json"
{
  "name": "@logto/connector-kit",
  "version": "5.2.0",
```

`packages/toolkit/connector-kit/package.json` at `v1.46.0` also says `5.2.0`, so the tag and the
published image agree. The connector-kit package is `"type": "module"`, exports `./lib/index.js`,
`optionalDependencies: { zod: "3.24.3" }`, `peerDependencies: { ky: "^1.2.3" }`.

**Consequence:** a connector that pins `"@logto/connector-kit": "5.1.2"` (as the upstream package
does) is rejected by the loader — see §5.

## 3. API surface the connector must implement

From `packages/toolkit/connector-kit/src/types/*.ts` at `v1.46.0`:

```ts
// social.ts
export type GetAuthorizationUri = (
  payload: {
    state: string;
    redirectUri: string;
    connectorId: string;
    connectorFactoryId: string;
    jti: string;
    headers: { userAgent?: string };
    scope?: string;
  },
  setSession: SetSession,
) => Promise<string>;

export type SocialUserInfo = {
  id: string;
  email?: string;
  phone?: string;
  name?: string;
  avatar?: string;
  rawData?: Json;
};

export const socialUserInfoGuard = z.object({
  id: z.string(),
  email: z.string().optional(),
  phone: z.string().optional(),
  name: z.string().optional(),
  avatar: z.string().optional(),
  rawData: jsonGuard.optional(),
});

export type GetUserInfo = (data: unknown, getSession: GetSession) => Promise<SocialUserInfo>;

export type TokenResponse = {
  id_token?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number | string;
  scope?: string;
  token_type?: string;
};

export type GetTokenResponseAndUserInfo = (
  data: unknown,
  getSession: GetSession,
) => Promise<{ tokenResponse?: TokenResponse; userInfo: SocialUserInfo }>;

export type SocialConnector = BaseConnector<ConnectorType.Social> & {
  getAuthorizationUri: GetAuthorizationUri;
  getUserInfo: GetUserInfo;
  getTokenResponseAndUserInfo?: GetTokenResponseAndUserInfo;
  getAccessTokenByRefreshToken?: (refreshToken: string) => Promise<TokenResponse>;
  validateSamlAssertion?: ValidateSamlAssertion;
};
```

```ts
// foundation.ts
export type BaseConnector<Type extends ConnectorType> = {
  type: Type;
  metadata: ConnectorMetadata;
  configGuard: ZodType;
};
```

```ts
// metadata.ts — required fields (note `logoDark` is required but nullable)
export type ConnectorMetadata = {
  id: string;
  target: string;
  name: I18nPhrases;
  description: I18nPhrases;
  logo: string;
  logoDark: Nullable<string>;
  readme: string;
  configTemplate?: string;
  formItems?: Array<z.infer<typeof connectorConfigFormItemGuard>>;
  customData?: Record<string, unknown>;
} & SocialConnectorMetadata; // platform, isStandard?, isTokenStorageSupported?
```

```ts
// error.ts
export enum ConnectorErrorCodes {
  General,
  InvalidMetadata,
  UnexpectedType,
  InvalidConfigGuard,
  InvalidRequestParameters,
  InsufficientRequestParameters,
  InvalidConfig,
  InvalidCertificate,
  InvalidResponse,
  TemplateNotFound,
  TemplateNotSupported,
  RateLimitExceeded,
  UsageLimitExceeded,
  NotImplemented,
  SocialAuthCodeInvalid,
  SocialAccessTokenInvalid,
  SocialIdTokenInvalid,
  AuthorizationFailed,
}
export class ConnectorError extends Error {
  constructor(code: ConnectorErrorCodes, data?: unknown) {
    const message = `ConnectorError: ${data ? JSON.stringify(data) : code}`;
    // …
  }
}
```

Notes that matter in practice:

- `ConnectorError` stringifies `data` into `message`. Anything put into `data` may be logged by
  Logto, so provider payloads (which contain tokens) must never be passed.
- `configGuard` must be a zod guard; `validateConfig(config, guard)` throws
  `ConnectorErrorCodes.InvalidConfig` on failure.
- `formItems` supports `isConfidential` on `Text` items (used for secrets in the Admin Console).
- `ConnectorErrorCodes.AuthorizationFailed` exists in 5.2.0 and is what Logto returns as
  `401 connector.authorization_failed`.

## 4. Session API

`setSession(storage)` / `getSession()` are implemented in Logto core, not in the kit.
`setSession` stores the object inside the interaction result:

```ts
// packages/core/src/libraries/verification-helpers/social-verification.ts
export const assignConnectorSessionResult = async (ctx, provider, connectorSession) => {
  const details = await provider.interactionDetails(ctx.req, ctx.res);
  await provider.interactionResult(ctx.req, ctx.res, { ...details.result, connectorSession });
};

export const getConnectorSessionResult = async (ctx, provider) => {
  const { result } = await provider.interactionDetails(ctx.req, ctx.res);
  const signInResult = z.object({ connectorSession: connectorSessionGuard }).safeParse(result);
  assertThat(result && signInResult.success, 'session.connector_validation_session_not_found');
  const { connectorSession, ...rest } = result;
  await provider.interactionResult(ctx.req, ctx.res, { ...rest }); // ← clears it
  return signInResult.data.connectorSession;
};
```

Consequences:

- The session lives in the OIDC interaction result (server side, tied to the browser session), so it
  is **read-once**: after the connector session is read it is removed, which gives replay protection
  for free.
- Lifetime = the interaction session: `interaction` TTL is **3600 s** (`packages/core/src/oidc/init.ts`
  at v1.46.0). No connector-specific TTL.
- `connectorSessionGuard` is `.partial()` with `.catchall(z.unknown())`, so arbitrary extra keys are
  preserved. This is what makes it safe for the connector to store
  `{ vk_code_verifier, vk_redirect_uri, vk_state }` next to Logto's own keys. Verified directly:
  parsing `{ nonce, redirectUri, state, code_verifier: 'abc', extra: 'e' }` returns **all** keys.
- Values must be JSON-serialisable (they go through the interaction result store).

## 5. Connector loading (the decisive mechanism)

### 5.1 Directory and naming

```console
$ docker run --rm --entrypoint sh svhd/logto:1.46.0 -c \
    "ls -la /etc/logto/packages/core/connectors | head -5"
total 8
drwxr-xr-x  2 root root 4096 Nov  5 06:12 .
drwxr-xr-x  7 root root 4096 Nov  5 06:12 ..
lrwxrwxrwx  1 root root   40 Nov  5 06:12 @logto-connector-alipay-native -> ../../connectors/connector-alipay-native
lrwxrwxrwx  1 root root   33 root Nov  5 06:12 @logto-connector-github -> ../../connectors/connector-github
```

`packages/core/src/utils/connectors/index.ts`:

```ts
const coreDirectory = cliDirectory && path.join(cliDirectory, '../core');
const directory = coreDirectory && path.join(coreDirectory, connectorDirectory); // 'connectors'
const connectorPackages = await getConnectorPackagesFromDirectory(directory);
const connectorFactories = await _loadConnectorFactories(connectorPackages, /* ignoreVersionCheck */ …);
```

`packages/cli/src/utils.ts`:

```ts
const getConnectorPackageName = async (directory) => {
  const { name } = z.object({ name: z.string() }).parse(JSON.parse(await readFile(...)));
  if (name.startsWith('connector-') || Boolean(name.split('/')[1]?.startsWith('connector-'))) {
    return name;
  }
};
export const getConnectorPackagesFromDirectory = async (directory) => { /* direct children only */ };
```

So: **the directory is scanned at runtime, one level deep, and the filter is on the
`package.json` `name` field**, not on the directory name. `@ozvix/connector-vkid` passes
(`split('/')[1] === 'connector-vkid'`).

### 5.2 Version gate and import

`packages/cli/src/connector/loader.ts`:

```ts
const checkConnectorKitVersion = (dependencies, ignoreVersionMismatch) => {
  if (isKeyInObject(dependencies, connectorKit)) {
    const value = dependencies[connectorKit];
    if (typeof value === 'string') {
      if (value.startsWith('workspace:') || satisfies(currentVersion, value)) return;
      const message = `Connector requires ${connectorKit} to be ${value}, but the version here is ${currentVersion}.`;
      if (ignoreVersionMismatch) { consoleLog.warn(…); return; }
      throw new Error(message);
    }
  }
  throw new Error(`Cannot find ${connectorKit} in connector's dependency`);
};

export const loadConnector = async (connectorPath, ignoreVersionMismatch) => {
  const { default: { dependencies } } = await import(path.join(connectorPath, 'package.json'), …);
  checkConnectorKitVersion(dependencies, ignoreVersionMismatch);
  const loaded = await import(path.join(connectorPath, 'lib/index.js'));
  // accepts ESM default function, or CJS default.default
};
```

Failures are swallowed per connector:

```ts
// packages/core/.../connectors/index.ts (via cli factories.ts)
consoleLog.error(`[load-connector] skip ${name} due to error: ${error.message}`);
```

**Verified in the real image.** Our built package was mounted at the real deployment path and loaded
through the image's own loader:

```console
$ docker run --rm --entrypoint node \
    -v <repo>/package:/etc/logto/packages/core/connectors/connector-ozvix-vkid:ro \
    svhd/logto:1.46.0 --input-type=module -e "
      const { loadConnector } = await import('/etc/logto/packages/cli/lib/connector/loader.js');
      const f = await loadConnector('/etc/logto/packages/core/connectors/connector-ozvix-vkid', false);
      const c = await f({ getConfig: async () => ({ clientId: '12345' }) });
      …"
LOADED vk-universal | vk | Social
isTokenStorageSupported: true
getAuthorizationUri: function | getUserInfo: function | getTokenResponseAndUserInfo: function
configGuard ok: true
```

and the generated authorize URL / session inside that image:

```
origin+path: https://id.vk.ru/authorize
params: client_id,code_challenge,code_challenge_method,redirect_uri,response_type,scope,state
scope: vkid.personal_info | method: S256
challenge length: 43
session keys: vk_code_verifier,vk_redirect_uri,vk_state | verifier length: 43
```

Control test — the same mount with the upstream package:

```
REJECTED upstream-0.0.4 -> Connector requires @logto/connector-kit to be 5.1.2, but the version here is 5.2.0.
```

This is the definitive proof that (a) drop-in mounting works, (b) `@logto/connector-kit` and `zod`
resolve from `/etc/logto/packages/core/node_modules` (the connector directory needs no
`node_modules`), and (c) the exact `5.1.2` pin is fatal on 1.46.0.

Two further details confirmed in the image:

- The only escape hatch for a version mismatch is the environment variable
  **`IGNORE_CONNECTOR_VERSION_CHECK=true`**, which downgrades the error to
  `This is highly discouraged in production` and loads the connector anyway. This project does not
  need it (`^5.2.0` satisfies 5.2.0).
- A full Logto boot with a drop-in connector directory was also performed: the connector directory
  was bind-mounted at `/etc/logto/packages/core/connectors/connector-ozvix-test` and the container
  started with `sh -c "npm run cli db seed -- --swe && npm start"`. Logto logged the connector being
  imported as ESM and then `Core app is running at http://localhost:3001/`; 51 of 52 packages loaded,
  the one bad-version fixture was skipped. No rebuild, no `connector link`.
- `loadConnector` calls `createConnector({ getConfig: notImplemented })` **at load time** just to
  read `metadata`/`type`/`configGuard`. A connector factory must therefore not call `getConfig()`
  eagerly at creation time — this project only calls it inside the request handlers.
- `logo`/`readme` paths are resolved relative to the package directory and inlined
  (`.svg`/`.png` only for images, as a `data:` URI; text files read as UTF-8). A missing asset
  degrades to the literal path string rather than failing the load.

### 5.3 Where connectors come from in the official image

The root `Dockerfile` at `v1.46.0` runs, between build and prune:

```dockerfile
ARG additional_connector_args
ENV ADDITIONAL_CONNECTOR_ARGS=${additional_connector_args}
RUN pnpm cli connector link $ADDITIONAL_CONNECTOR_ARGS -p .
```

`pnpm cli connector link` (`packages/cli/src/commands/connector/link.ts`) symlinks every
`packages/connectors/connector-*` directory into `packages/core/connectors/@logto-connector-*`.
It does **not** produce a compiled registry: the symlinks are resolved by the runtime scan in §5.1.
There is no `@logto/connectors` package in 1.46.0.

So an external connector does **not** need `logto cli connector link`; it only needs its directory
to exist under `/etc/logto/packages/core/connectors/` with the right `package.json` name and
`lib/index.js`.

## 6. Who verifies OAuth `state`?

**Not Logto core.** In `packages/core/src/libraries/verification-helpers/social-verification.ts`,
`verifySocialIdentity()` calls `connector.getUserInfo(data, getSession)` directly; the only
callback-shape checks before that are for Google One Tap. `createSocialAuthorizationUrl()` only
asserts `state && redirectUri` (`session.insufficient_info`) and forwards them to
`connector.getAuthorizationUri({ state, redirectUri, … }, setSession)`. `assertNoAuthorizationError(data)`
handles only provider `error` responses.

The `state` value is minted and validated in the Logto **SPA**
(`packages/experience/src/utils/social-connectors.ts`, `generateState`/`validateState`, values are
prefixed with `se_`). Nonce is not validated by core for social connectors.

**Consequence for the connector:** it is the only server-side component that can bind the callback
to the authorization request, which is why this connector persists `vk_state` and re-checks it.

## 7. `getUserInfo` vs `getTokenResponseAndUserInfo`, and token storage

`packages/core/src/libraries/social.ts`:

```ts
const { metadata: { isTokenStorageSupported }, dbEntry: { enableTokenStorage },
        getUserInfo, getTokenResponseAndUserInfo } = connector;

assertNoAuthorizationError(data);

if (enableTokenStorage && isTokenStorageSupported && getTokenResponseAndUserInfo) {
  const { userInfo, tokenResponse } = await callSocialProvider(
    connectorId, async () => getTokenResponseAndUserInfo(data, getConnectorSession), ctx);
  if (!tokenResponse?.access_token) return { userInfo };
  const encryptedTokenSet = trySafe(() => encryptAndSerializeTokenResponse(tokenResponse), …);
  return { userInfo, encryptedTokenSet };
}
return { userInfo: await callSocialProvider(connectorId, () => getUserInfo(data, getConnectorSession), ctx) };
```

Token storage is therefore triggered by three things that must all be true: the connector advertises
`metadata.isTokenStorageSupported`, the administrator enabled token storage on the connector row
(`enableTokenStorage`), and the connector exposes `getTokenResponseAndUserInfo`. A missing
`access_token` quietly skips storage; encryption failures are caught and only the user info is used.

`refreshTokenSetSecret()` requires the connector to implement `getAccessTokenByRefreshToken`,
otherwise it throws `422 connector.token_storage_not_supported`. The connector in this repository
does not implement it (VK ID refresh needs the authorization-time `device_id`; see
`../ARCHITECTURE.md` §7).

## 8. Markers returned to the Admin Console

`transpileLogtoConnector()` returns `{ type, ...metadata, ...pick(dbEntry, 'id','connectorId',
'syncProfile','metadata','enableTokenStorage'), isDemo, config, extraInfo }`, i.e. the
`syncProfile` ("Only at sign-up" / "Always sync") toggle is a **core-level connector setting**, not a
connector config field. The connector does not need a profile-sync option of its own; for social
sign-in, core syncs `name`/`avatar` (and, for new users, a free e-mail/phone) according to that
setting (`SocialVerification.toSyncedProfile()`).

`assertNoAuthorizationError()` maps `access_denied`, `user_cancelled_authorize` and
`user_cancelled_login` to `ConnectorErrorCodes.AuthorizationFailed` (HTTP 401
`connector.authorization_failed`) before the connector runs.

Transport-level errors are detected by `packages/core/src/utils/connectors/transport-failure.ts`:
a `got` `RequestError`, a **`ky` `TimeoutError`** (`name === 'TimeoutError'` and a `request` object),
or a `fetch` `TypeError` with `cause.code`. They become
`502 connector.social_provider_unreachable` with the network code as `reason`; the logged URL is
reduced to origin + path.

## 9. Environment for a local Logto 1.46.0

Used by `compose.test.yaml` (see `../LOCAL-TESTING.md`):

| Variable             | Value in tests                                                                  |
| -------------------- | ------------------------------------------------------------------------------- |
| `DB_URL`             | `postgres://logto:<password>@postgres:5432/logto`                               |
| `ENDPOINT`           | `http://localhost:3001`                                                         |
| `ADMIN_ENDPOINT`     | `http://localhost:3002`                                                         |
| `TRUST_PROXY_HEADER` | `1` (this is the variable Logto 1.46.0 reads; a stale `TRUST_PROXY` is ignored) |
| entrypoint override  | `sh -c "npm run cli db seed -- --swe && npm start"`                             |

The image does not seed the database by itself; the official compose file runs
`npm run cli db seed -- --swe` before `npm start` (a fresh volume throws on undeployed alterations
or an unseeded database otherwise). First-run admin registration happens in the Admin Console at
`:3002`.

Public HTTPS deployments need `SECRET_VAULT_KEK` if token storage is enabled — without it the
encryption step throws, Logto logs the failure via `trySafe` and still returns the user info. This
project does not require token storage for sign-in.

Health endpoint used by the compose health check: `GET http://127.0.0.1:3001/api/status`.

## 10. Recommended install path

Because loading is a **runtime directory scan**, both options work. Verified recommendation:

**Option A — derived image (recommended).**
`FROM svhd/logto:1.46.0` + `COPY` the connector package into
`/etc/logto/packages/core/connectors/connector-ozvix-vkid`. No Logto rebuild, no
`connector link`, immutable and tag-rollbackable. Implemented by the repository `Dockerfile`,
verified to build and to contain a loadable connector.

**Option B — bind mount.** Mount a host directory at the connector's _subdirectory_ inside
`/etc/logto/packages/core/connectors/`. Works for the same reason, but the artifact lives on the
host filesystem and must be re-copied per host. Never mount over
`/etc/logto/packages/core/connectors` itself — that hides every official connector.

## 11. Things that break the upstream connector specifically

1. `@logto/connector-kit` pinned to `5.1.2` → loader version gate → silently skipped (verified in
   §5.2).
2. Callback guard requires `redirectUri`, which VK ID never sends → every login fails (see
   `../SECURITY-AUDIT.md` F-01).
3. `ky` peer dependency: `@logto/connector-kit` itself imports `ky`, and Logto ships it for its own
   connectors; a connector that bundles a _second_ copy of `@logto/connector-kit` would break
   `instanceof ConnectorError`. Keeping the kit and `zod` external (as this project does) is
   required.
4. An ESM connector is fine: the loader uses dynamic `import()` and the connectors package is ESM,
   but the file must be `lib/index.js` with a default-exported function.

**UNCONFIRMED:** behaviour of this connector on Logto versions other than 1.46.0, and on Logto
Cloud. The loader version gate makes a version mismatch visible (skip + log line) rather than silent
at runtime, but it was not tested.
