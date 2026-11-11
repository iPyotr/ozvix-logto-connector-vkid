# Local integration testing

This document describes the **reproducible local test environment** for
`ozvix-logto-connector-vkid`: Logto OSS **1.46.0 with the VK ID connector
pre-installed** + a throw-away PostgreSQL + a dependency-free **mock VK ID**
OAuth 2.1 provider, all wired with one Docker Compose file, plus the mock's
failure modes for negative-path tests.

> Everything here is local and disposable. **Never** point this harness at a
> production Logto or a production database. Real VK ID credentials are only
> needed for the manual end-to-end check (section 8) and must never be
> committed.

---

## 1. Prerequisites

| Requirement                      | Notes                                                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Windows 11 (or Linux/macOS)      | The commands below are given for **PowerShell 7** and **WSL2 bash**.                                                       |
| Docker Desktop with WSL2 backend | `docker version` must report a server version; Docker Desktop must be running.                                             |
| Docker Compose v2                | Bundled with Docker Desktop (`docker compose version`).                                                                    |
| Node.js >= 22 on the host        | Only for the mock's unit tests. The mock itself has **zero npm dependencies**; the connector image is built inside Docker. |
| `pwsh` (PowerShell 7)            | The repo's docs use `pwsh`.                                                                                                |

**Execution policy note (Windows):** the `npm.ps1`/`pnpm.ps1` shims are blocked
by the default PowerShell execution policy. Always call npm through `cmd`:

```powershell
cmd /c "npm --prefix mock-vkid test"
```

---

## 2. What gets started

| Service     | Image / build                                                                                                                | Host URL                                                                       | Published to host?                                                                                |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `postgres`  | `postgres:16-alpine`                                                                                                         | –                                                                              | **No** (`5432/tcp` internal only)                                                                 |
| `logto`     | **`ozvix/logto-vkid:test`** – built from `./Dockerfile`, derived from `svhd/logto:1.46.0` with the VK ID connector installed | http://localhost:3001 (Logto endpoint) / http://localhost:3002 (Admin Console) | Yes: `3001`, `3002`, and the mock's `8090` (see below)                                            |
| `mock-vkid` | built from `mock-vkid/` (`mock` profile only)                                                                                | http://localhost:8090 (default)                                                | Through the `logto` container, which publishes `8090` – the mock shares Logto's network namespace |

Compose project name: **`ozvix-logto-vkid-test`** (top-level `name:`).
Volume: `ozvix-logto-vkid-test_logto-pgdata` (project-scoped).
Network: `ozvix-logto-vkid-test-net` (project-scoped).

Because everything is project-scoped, `down -v` removes **only this project's**
containers, network and the test database volume - it never touches other
projects on the machine.

### Why the mock shares Logto's network namespace

The connector accepts any explicit `http(s)` origin in `apiBaseUrl` (HTTPS is the
documented default; a plain-HTTP origin is an administrator decision), so
`http://mock-vkid:8090` or a LAN address would pass the guard. The harness still
runs `mock-vkid` with `network_mode: "service:logto"` because that keeps one
origin working for both sides with a single published port: from inside the Logto
container the mock is served at **`http://localhost:8090`**, and the browser
reaches the same origin through the port published by the `logto` service. The
connector is configured with `apiBaseUrl = http://localhost:8090` (section 7).

Alternatives rejected: a TLS mock (needs certificate trust inside the image), or
publishing a second host port for the mock. The shared-namespace approach needs
**zero** changes to `src/` and matches the documented default setup.

---

## 3. Quick start

### PowerShell 7 (Windows)

```powershell
cd D:\AiAndCode\ozvix-logto-connector-vkid

# 1. Local, non-secret test configuration (.env is read by Docker Compose automatically)
Copy-Item .env.test.example .env -Force

# 2. One command up (builds the connector image + mock image, pulls Logto/Postgres
#    on first run; the connector build runs `npm ci` + `tsup`)
docker compose -f compose.test.yaml up -d --build

# 3. All three services must become healthy (first boot also seeds the Logto DB)
docker compose -f compose.test.yaml ps

# 4. Smoke check the endpoints
curl.exe -s -o NUL -w "logto endpoint  : %{http_code}`n" http://localhost:3001/api/status
curl.exe -s -o NUL -w "logto admin     : %{http_code}`n" http://localhost:3002/api/status
curl.exe -s -o NUL -w "mock vkid health: %{http_code}`n" http://localhost:8090/health
```

### WSL2 (bash)

```bash
cd /mnt/d/AiAndCode/ozvix-logto-connector-vkid

cp .env.test.example .env
docker compose -f compose.test.yaml up -d --build
docker compose -f compose.test.yaml ps

curl -s -o /dev/null -w "logto endpoint  : %{http_code}\n" http://localhost:3001/api/status
curl -s -o /dev/null -w "logto admin     : %{http_code}\n" http://localhost:3002/api/status
curl -s -o /dev/null -w "mock vkid health: %{http_code}\n" http://localhost:8090/health
```

`COMPOSE_PROFILES=mock` in `.env` is what makes the plain `docker compose up`
start the mock provider as well. Without an `.env` file, either create it first
or pass `--profile mock` explicitly:

```powershell
docker compose -f compose.test.yaml --profile mock up -d --build
```

### If host port 8090 is already taken

The mock's _container_ port is always `8090`; only the _host_ mapping is
configurable. If another service on the machine already listens on host `8090`,
set a free port in `.env`:

```ini
MOCK_VKID_HOST_PORT=18090
```

and use `http://localhost:18090/health` from the host. The in-container address
(`http://localhost:8090`) used by the connector is unaffected. Note that the
manual browser flow (section 8) needs the connector's `apiBaseUrl` host:port to
be reachable by the browser, i.e. it must match the published host port - so on
a machine where `8090` is taken, either free it or configure `apiBaseUrl`
accordingly **and** publish that same port.

---

## 4. Profiles: mock stack vs real-credentials stack

| Profile | Enabled by                                  | Services                                        | Use                                                                                              |
| ------- | ------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `mock`  | `.env` -> `COMPOSE_PROFILES=mock` (default) | postgres, logto (with connector), **mock-vkid** | Local integration tests, no real VK credentials needed.                                          |
| `real`  | `COMPOSE_PROFILES=real`                     | postgres, logto (with connector)                | Manual end-to-end test against the real VK ID authorization server. The mock is **not** started. |

The connector image is the same in both stacks - the only differences are
whether the mock runs and which `apiBaseUrl`/credentials are configured in the
Admin Console.

```powershell
# Switch to the real-credentials stack (mock disabled)
$env:COMPOSE_PROFILES = "real"
docker compose -f compose.test.yaml up -d --build
```

```bash
COMPOSE_PROFILES=real docker compose -f compose.test.yaml up -d --build
```

Real VK ID credentials (`.env`): `VKID_CLIENT_ID`, optional
`VKID_SERVICE_TOKEN`, `VKID_SCOPE`, `VKID_REDIRECT_URI`. See `.env.example`.
These values are **never** used by the mock stack.

---

## 5. Connector image wiring (implemented)

The derived image is built by the repo-root `Dockerfile`:

1. Stage 1 (`node:22-alpine`) runs `npm ci` and `npm run build` (tsup) on this
   connector and emits `lib/index.js` (ESM, `@logto/connector-kit`/`zod`
   external).
2. Stage 2 derives `FROM svhd/logto:1.46.0` and copies the built package into

   ```
   /etc/logto/packages/core/connectors/connector-ozvix-vkid
   ```

   Verify this from the running container:

   ```powershell
   docker compose -f compose.test.yaml exec logto sh -c 'ls -la /etc/logto/packages/core/connectors/connector-ozvix-vkid'
   ```

3. The build fails if `lib/index.js` is missing, if the package name is not
   `connector-*` / `@scope/connector-*`, or if `dependencies["@logto/connector-kit"]`
   does not satisfy the connector-kit version installed in the image.

**How Logto 1.46.0 loads it (verified against the real image):**

- `@logto/cli` scans `/etc/logto/packages/core/connectors` at runtime
  (`getConnectorPackagesFromDirectory`), keeps every direct child whose
  `package.json` name starts with `connector-` or is `@scope/connector-*`, then
  `loadConnector()` imports `<dir>/lib/index.js` and checks the connector-kit
  version range. It is a **runtime directory scan, not a compile-time registry**,
  so deriving from the official image is correct - no Logto rebuild, no bind
  mounts, no database patching.
- On any failure the loader logs
  `[load-connector] skip <name> due to error: ...`. Check with:

  ```powershell
  docker compose -f compose.test.yaml logs logto | Select-String "load-connector"
  ```

### Proof commands (verified on 2026-11-10)

```powershell
# 1. Connector directory exists inside the running image
docker compose -f compose.test.yaml exec logto sh -c 'ls -la /etc/logto/packages/core/connectors/connector-ozvix-vkid'

# 2. No loader errors
docker compose -f compose.test.yaml logs logto | Select-String "load-connector"   # (no output = no errors)

# 3. Logto itself is up
docker compose -f compose.test.yaml exec logto node -e "fetch('http://127.0.0.1:3001/api/status').then(r=>console.log('status', r.status))"

# 4. Run Logto's own discovery code path inside the container (same functions core calls)
#    -> DISCOVERY: 51 connector package(s) ... vk connector package = @ozvix/connector-vkid
#    -> FACTORY: vk-universal | target=vk | type=Social
docker compose -f compose.test.yaml cp docker/vkid-proof.mjs logto:/tmp/vkid-proof.mjs
docker compose -f compose.test.yaml exec logto node /tmp/vkid-proof.mjs
```

Observed in-container output of the proof script (no secrets):

```
DISCOVERY: 51 connector package(s) found in /etc/logto/packages/core/connectors
DISCOVERY: vk connector package = @ozvix/connector-vkid
FACTORY: vk-universal | target=vk | type=Social
AUTHORIZE: host=http://localhost:8090 path=/authorize
AUTHORIZE: params=client_id,code_challenge,code_challenge_method,redirect_uri,response_type,scope,state
SESSION: keys=vk_code_verifier,vk_redirect_uri,vk_state verifier_len=43
MOCK CALLBACK: status=302 code_len=38 device_id=present state_echo=true
USER INFO: {"id":"1001","name":"Ivan Petrov","avatar":"https://pp.userapi.com/mock-vkid/avatar-1001.png","email":null}
PROOF OK
```

That is a full live authorization-code + PKCE exchange executed by the
connector **inside the derived Logto image** against the containerised mock:
authorize URL -> 302 callback -> token exchange -> `user_info` -> mapped Logto
profile. `email` is `null` because `syncEmail` defaults to `false`.

> Honest limitation: the Admin Console's connector list needs an admin access
> token (OIDC/M2M), so the discovery proof above uses Logto's own loader
> functions inside the running container rather than an authenticated admin API
> call. It is the same code path `loadConnectorFactories()` uses at runtime; the
> full API check is the manual step in section 7.

---

## 6. Mock VK ID provider - endpoints and failure modes

The mock implements modern VK ID OAuth 2.1 and verifies PKCE S256 itself. Full
contract: [`mock-vkid/README.md`](../mock-vkid/README.md).

| Method | Path                | Purpose                                                                                                                     |
| ------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/authorize`        | Validates request + PKCE S256 challenge, issues a one-time code, 302 to `redirect_uri?code=&state=&device_id=&type=code_v2` |
| POST   | `/oauth2/auth`      | Token endpoint (form-urlencoded); single-use code, PKCE verification, `client_id`/`redirect_uri`/`device_id` validation     |
| POST   | `/oauth2/user_info` | Returns `{ user: { ... } }` for an access token                                                                             |
| GET    | `/health`           | Healthcheck used by compose                                                                                                 |
| GET    | `/debug/state`      | Recorded requests + counters (secrets redacted)                                                                             |
| POST   | `/debug/reset`      | Clears in-memory state                                                                                                      |

`MOCK_VKID_REDIRECT_URIS` supports exact entries and one prefix wildcard entry
(`http://localhost:3001/callback/*`), which the compose stack uses because Logto
derives the callback path from the connector's database id. Scheme, host and
path prefix stay pinned.

### Full happy-path example (PowerShell 7)

```powershell
# 1) PKCE verifier + S256 challenge
$verifier  = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48)).Replace('+','-').Replace('/','_').TrimEnd('=')
$sha       = [Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::ASCII.GetBytes($verifier))
$challenge = [Convert]::ToBase64String($sha).Replace('+','-').Replace('/','_').TrimEnd('=')
$state     = 'local-test-state-0123456789abcdef0123456789abcdef'   # real VK ID wants >= 32 chars

# 2) /authorize -> 302 callback URL (no -L: we want the Location)
$authorize = "http://localhost:8090/authorize?response_type=code&client_id=mock-vkid-client-id" +
             "&redirect_uri=$([uri]::EscapeDataString('http://localhost:3001/callback/<connector-id>'))" +
             "&state=$state&code_challenge=$challenge&code_challenge_method=S256&scope=vkid.personal_info"
$location  = curl.exe -s -o NUL -w "%{redirect_url}" $authorize
Write-Host "callback: $location"

# 3) parse callback parameters
$query = @{}
([uri]$location).Query.TrimStart('?').Split('&') | ForEach-Object {
  $kv = $_.Split('=', 2); $query[$kv[0]] = [uri]::UnescapeDataString($kv[1])
}

# 4) code -> tokens (device_id comes FROM the callback, never from the client)
$token = Invoke-RestMethod -Method POST -Uri http://localhost:8090/oauth2/auth `
  -ContentType 'application/x-www-form-urlencoded' `
  -Body @{
    grant_type    = 'authorization_code'
    code          = $query['code']
    code_verifier = $verifier
    client_id     = 'mock-vkid-client-id'
    redirect_uri  = 'http://localhost:3001/callback/<connector-id>'
    device_id     = $query['device_id']
  }
$token | Format-List

# 5) profile
Invoke-RestMethod -Method POST -Uri http://localhost:8090/oauth2/user_info `
  -ContentType 'application/x-www-form-urlencoded' `
  -Body @{ access_token = $token.access_token } | ConvertTo-Json -Depth 5
```

WSL2 bash equivalent of step 1-2 (uses `openssl`, present in most WSL distros):

```bash
VERIFIER=$(openssl rand -base64 48 | tr -d '\n=' | tr '+/' '-_')
CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -sha256 -binary | openssl base64 -A | tr '+/' '-_' | tr -d '=')
curl -s -o /dev/null -w "%{redirect_url}\n" \
  "http://localhost:8090/authorize?response_type=code&client_id=mock-vkid-client-id&redirect_uri=http%3A%2F%2Flocalhost%3A3001%2Fcallback%2Fvk-universal&state=local-test-state-0123456789abcdef&code_challenge=$CHALLENGE&code_challenge_method=S256&scope=vkid.personal_info"
```

### Triggering failure modes

Modes are accepted as **query/form parameters** (per request) or as
**env vars** (global, in `.env` + restart).

| Failure mode               | Trigger                                                                                                                                                              | Expected behavior                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| User denies / blocked      | append `&mock_error=access_denied` to `/authorize`                                                                                                                   | 302 to callback with `error=access_denied&error_description=...&state=...` |
| Broken PKCE                | append `&mock_bad_pkce=1` to `/authorize`                                                                                                                            | token endpoint returns `400 invalid_grant` even with the correct verifier  |
| Provider omits `device_id` | append `&mock_no_device_id=1` to `/authorize`                                                                                                                        | callback has no `device_id`; connector must fail early with a clear error  |
| Provider too slow          | append `&mock_slow=1` to `/authorize` (delays `MOCK_VKID_SLOW_MS`, default 30 s)                                                                                     | connector request should time out                                          |
| Forced status at authorize | append `&mock_authorize_status=500`                                                                                                                                  | raw HTTP 500 from `/authorize`                                             |
| Token endpoint 4xx/5xx     | `POST /oauth2/auth?mock_token_mode=http_500` (also `http_400`, `http_401`)                                                                                           | raw HTTP status + JSON error                                               |
| Unparseable token response | `POST /oauth2/auth?mock_token_mode=invalid_json`                                                                                                                     | HTTP 200 with truncated JSON                                               |
| Missing token fields       | `mock_token_mode=missing_refresh_token` / `missing_id_token` / `missing_user_id` / `missing_scope` / `missing_state` / `missing_expires_in` / `missing_access_token` | field omitted                                                              |
| Empty token payload        | `mock_token_mode=empty`                                                                                                                                              | `{}`                                                                       |
| `user_info` failures       | `POST /oauth2/user_info?mock_user_mode=missing_email` (also `missing_avatar`, `empty_strings`, `null_fields`, `empty_user`, `invalid_json`, `http_500`, `http_401`)  | degraded/failed profile response                                           |

Modes set on `/authorize` are stored with the one-time code, so the connector
can be exercised end-to-end even though it never forwards `mock_*` flags:

```powershell
# connector sees a user without an e-mail at user_info time
# append to the /authorize URL it builds: &mock_user_mode=missing_email
```

Inspect what the mock received (tokens/codes are redacted):

```powershell
Invoke-RestMethod http://localhost:8090/debug/state | ConvertTo-Json -Depth 6
Invoke-RestMethod -Method POST http://localhost:8090/debug/reset   # clear between tests
```

---

> **HTTPS is required.** The Admin Console cannot create the first administrator over plain
> `http://`: Web Crypto is unavailable in an insecure context. Use the HTTPS setup in
> [section 13](#13-https-for-the-admin-console-required) before following this section, and set
> `TRUST_PROXY_HEADER=1` so Logto honours the proxy's `X-Forwarded-Proto`.

## 7. Configuring the connector in the Admin Console (against the mock)

Open http://localhost:3002. On a **fresh test volume** the seed step does not
create an end-user account: the console shows Logto's Welcome page, where you
create the initial admin user yourself (any username/e-mail + password). If you
already created one on this volume, sign in with it.

1. **Connectors -> Social -> Add social connector -> VK ID** (factory id
   `vk-universal`; it appears because the derived image installed it).
2. Fill in:

   | Field                       | Value for the mock stack                                 |
   | --------------------------- | -------------------------------------------------------- |
   | Client ID                   | `mock-vkid-client-id`                                    |
   | Service token               | _(empty)_                                                |
   | Scope                       | `vkid.personal_info`                                     |
   | VK ID API origin (advanced) | **`http://localhost:8090`**                              |
   | Sync e-mail / Sync phone    | off (mock user has both, but keep linking deterministic) |

   `http://localhost:8090` passes the connector's guard as an explicit http
   origin; the mock is served on the Logto container's loopback by design
   (section 2).

3. Save, then copy the **Redirect URI** shown for the connector
   (`http://localhost:3001/callback/<connector-id>`). The mock already accepts
   it through the `http://localhost:3001/callback/*` wildcard; for the real VK
   ID app the exact same URI must be registered in the VK ID cabinet.
4. Use "Test connection" / a test sign-in: the mock auto-approves, redirects
   back, and Logto should create a user whose name is `Ivan Petrov` with user id
   `1001`.

For the **real** stack: same steps with the real `client_id`/scope, no
`apiBaseUrl` override (leave empty -> `https://id.vk.ru`), and the redirect URI
registered in the VK ID cabinet.

---

## 8. Running the tests

### Mock unit/smoke tests (no Docker needed)

```powershell
cmd /c "npm --prefix mock-vkid test"
```

```bash
npm --prefix mock-vkid test          # or: cd mock-vkid && node --test
```

48 tests cover the PKCE S256 primitive (RFC 7636 vector), the authorize
validation matrix (including wildcard redirect allowlisting), PKCE
verification, single-use + concurrent code redemption, token-endpoint
HTTP/JSON/field variants, `user_info` variants, and secret redaction.

### Connector unit tests (owned by the connector team)

```powershell
cmd /c "npm test"
```

### In-container OAuth flow (automated proof)

[`docker/vkid-proof.mjs`](../docker/vkid-proof.mjs) runs the connector inside the
derived image against the mock: it first repeats Logto's own connector
discovery, then performs a full authorize -> callback -> token exchange ->
`user_info` flow and prints the mapped Logto profile.

```powershell
docker compose -f compose.test.yaml cp docker/vkid-proof.mjs logto:/tmp/vkid-proof.mjs
docker compose -f compose.test.yaml exec logto node /tmp/vkid-proof.mjs
```

---

## 9. Reset procedure

| Goal                                           | Command                                                                                                                                                                                                              |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remove the whole test stack **and** its data   | `docker compose -f compose.test.yaml down -v`                                                                                                                                                                        |
| Fresh Logto database (keeps containers/images) | `docker compose -f compose.test.yaml down -v; docker compose -f compose.test.yaml up -d --build`                                                                                                                     |
| Reset only mock state                          | `Invoke-RestMethod -Method POST http://localhost:8090/debug/reset`                                                                                                                                                   |
| Recreate Logto DB without removing the volume  | `docker compose -f compose.test.yaml exec postgres psql -U logto -d logto -c "drop schema public cascade; create schema public;"` then `docker compose -f compose.test.yaml restart logto` (the entrypoint re-seeds) |
| Stop everything, keep data                     | `docker compose -f compose.test.yaml down`                                                                                                                                                                           |
| See why a healthcheck fails                    | `docker compose -f compose.test.yaml logs --tail 100 logto`                                                                                                                                                          |

`down -v` is safe here: the volume is named
`ozvix-logto-vkid-test_logto-pgdata` and belongs only to this project.

---

## 10. Real VK ID end-to-end (manual, not automated)

The mock stack verifies the connector's logic **and** its loading inside the
Logto image, but **not** the real provider. A real VK ID authorization requires
all of the following and is therefore a **manual step**:

1. A VK ID application created in the VK ID cabinet
   (<https://id.vk.ru/about/business/go/>), with a confirmed business profile.
2. A **trusted redirect URL registered verbatim** in the cabinet. Its host must
   equal the app's base domain.
3. Real credentials in `.env`: `VKID_CLIENT_ID` (+ `VKID_SERVICE_TOKEN` for a
   confidential app) and a registered `VKID_REDIRECT_URI`.
4. **Port constraint:** VK ID only allows `http://localhost:80` /
   `https://localhost:443` for local testing ("Другие порты временно не
   поддерживаются"). Logto listens on `:3001`, so real VK ID sign-in from a
   normal local Logto requires a tunnel or reverse proxy on port 443. Plan for
   this; it is not something this compose file can fix.
5. Start the real-credentials stack (`COMPOSE_PROFILES=real`), configure the VK
   ID connector in the Admin Console with the real `client_id` and redirect URI,
   and complete a sign-in in a browser.
6. Click through: consent screen -> redirect back to Logto -> user created in
   Logto with the VK ID profile (email only if `scope=email` was granted and
   enabled in the VK cabinet).

> Do **not** use production Logto or production VK credentials for this.
> Use a dedicated VK ID test app.

---

## 11. Verification checklist

### Verified automatically (re-run any time)

- [x] `docker compose -f compose.test.yaml up -d --build` builds the connector
      image and starts the stack
- [x] `docker compose -f compose.test.yaml ps` shows `postgres`, `logto`,
      `mock-vkid` **healthy** (all three)
- [x] `http://localhost:3001/api/status` -> **204** (Logto endpoint up)
- [x] `http://localhost:3001/` -> **302** (redirects to the sign-in experience)
- [x] `http://localhost:3002/api/status` -> **204** (admin console up)
- [x] `http://localhost:3002/` -> **302** (redirects to the console UI)
- [x] mock `/health` -> **200** (via the published host port; `8090` by default)
- [x] connector directory present in the running container
      (`/etc/logto/packages/core/connectors/connector-ozvix-vkid`)
- [x] no `[load-connector]` error lines in the Logto logs
- [x] Logto's own discovery path returns `51 connector package(s)` including
      `@ozvix/connector-vkid` and factory `vk-universal | target=vk | Social`
- [x] full authorize -> callback -> token -> user_info flow executed by the
      connector inside the derived image against the mock (`PROOF OK`)
- [x] `cmd /c "npm --prefix mock-vkid test"` -> **48/48 pass**
- [x] `docker compose -f compose.test.yaml down -v` removes containers, network
      and the `ozvix-logto-vkid-test_logto-pgdata` volume
- [x] `COMPOSE_PROFILES=real docker compose ... config --services` contains
      `postgres`, `logto` and **not** `mock-vkid`

> Measurement note (2026-11-10): on the machine where this was verified, host
> port `8090` was already occupied by an unrelated project (`secretio-web-1`
> publishing `0.0.0.0:8090->80/tcp`), so the run used
> `MOCK_VKID_HOST_PORT=18090` and the mock was checked at
> `http://localhost:18090/health` -> **200**. The in-container
> `http://localhost:8090/health` (the address the connector actually uses) was
> checked through `docker compose exec logto` and returned
> `{"status":"ok","service":"mock-vkid",...}`. The default mapping remains `8090`.

### Manual steps still required

- [ ] Sign in through the Admin Console UI and add/test the connector there
      (section 7) - the console requires an interactive admin login
- [ ] Real VK ID sign-in (registered redirect URI, real credentials, port 80/443
      constraint - section 10)
- [ ] Confirming Logto creates/links the user with the expected profile fields
      against the real provider

---

## 12. Troubleshooting

| Symptom                                                                                                 | Fix                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Bind for 0.0.0.0:8090 failed: port is already allocated`                                               | Another service on the machine owns host 8090. Set `MOCK_VKID_HOST_PORT=<free port>` in `.env` (in-container address stays `8090`), or stop the other service. The manual browser flow needs `apiBaseUrl` to point at the _published_ port. |
| `port is already allocated` (3001/3002)                                                                 | Another process owns the port. Change `LOGTO_PORT` / `LOGTO_ADMIN_PORT` in `.env` (and keep `LOGTO_ENDPOINT` consistent).                                                                                                                   |
| `logto` healthcheck keeps failing                                                                       | First boot runs DB migrations/seed; give it 60-90 s. Check `docker compose -f compose.test.yaml logs logto`.                                                                                                                                |
| Connector missing from the Admin Console                                                                | Check the container directory (section 5) and search the logs for `[load-connector]`. A connector-kit version mismatch is reported as `Connector requires @logto/connector-kit to be ...`.                                                  |
| `apiBaseUrl` rejected: "Must be an origin without path, query or hash" / "Must not contain credentials" | The value must be a bare scheme+host+port. An explicit `http://` origin is accepted, so against the mock use `http://localhost:8090` (the mock shares Logto's netns) or the LAN address.                                                    |
| Mock rejects `/authorize` with `redirect_uri is not registered`                                         | Add the exact URI (or a `http://localhost:3001/callback/*` wildcard) to `MOCK_VKID_REDIRECT_URIS` in `.env` and restart `mock-vkid`.                                                                                                        |
| Mock token endpoint: `PKCE verification failed`                                                         | The connector did not persist/re-send the `code_verifier`, or used `plain` instead of `S256`.                                                                                                                                               |
| `device_id does not match`                                                                              | The connector must forward the `device_id` returned in the callback, unchanged.                                                                                                                                                             |
| Compose says a service is not started                                                                   | Profiles: `.env` must contain `COMPOSE_PROFILES=mock` for the mock stack, or pass `--profile mock`.                                                                                                                                         |
| WSL2 command not found (`docker`)                                                                       | Enable Docker Desktop's WSL integration for your distro.                                                                                                                                                                                    |
| Old data after schema changes                                                                           | `docker compose -f compose.test.yaml down -v` (removes the test DB volume).                                                                                                                                                                 |
| npm blocked by execution policy                                                                         | Always use `cmd /c "npm ..."` on Windows PowerShell.                                                                                                                                                                                        |

---

## 13. HTTPS for the Admin Console (required)

The Admin Console and the sign-in experience require a **secure context**: over plain `http://` the
Console renders "Insecure contexts (non-HTTPS) are not supported" and the first administrator cannot
be created, because Web Crypto (`Crypto.subtle`) is unavailable. The mock stack can stay local, but
both Logto endpoints must be reached over HTTPS.

A minimal local setup (verified on Debian 13 with Docker):

1. Give the three names a DNS record pointing at the test host (or map them in the browser test with
   `--host-resolver-rules`):

   | Name                         | Purpose                                                    |
   | ---------------------------- | ---------------------------------------------------------- |
   | `vkidtest.example.com`       | Logto endpoint (`ENDPOINT`), the VK ID callback lives here |
   | `vkidtest-admin.example.com` | Admin Console (`ADMIN_ENDPOINT`)                           |
   | `vkidtest-mock.example.com`  | mock VK ID provider (test only)                            |

2. Run Caddy in front of the published ports (host network so it can reach `127.0.0.1:3001/3002/8090`):

   ```caddyfile
   {
       # test host only: certificates from Caddy's own CA
       local_certs
       skip_install_trust
   }

   vkidtest.example.com {
       tls internal
       reverse_proxy 127.0.0.1:3001
   }

   vkidtest-admin.example.com {
       tls internal
       reverse_proxy 127.0.0.1:3002
   }

   vkidtest-mock.example.com {
       tls internal
       reverse_proxy 127.0.0.1:8090
   }
   ```

   On a public host drop `local_certs`/`tls internal` and let Caddy obtain Let's Encrypt
   certificates; the three `reverse_proxy` lines stay the same.

3. Point Logto at the names and let it trust the proxy scheme:

   ```ini
   LOGTO_ENDPOINT=https://vkidtest.example.com
   LOGTO_ADMIN_ENDPOINT=https://vkidtest-admin.example.com
   ```

   and set `TRUST_PROXY_HEADER=1` in the Logto service environment (`compose.test.yaml` already does
   this; Logto 1.46.0 ignores the older `TRUST_PROXY`).

4. The connector's `apiBaseUrl` for the mock stack becomes `https://vkidtest-mock.example.com`
   (an explicit `https` origin; plain HTTP is accepted but sends tokens unencrypted).

Admin Console: `https://vkidtest-admin.example.com/console`. The callback URI Logto generates is
`https://vkidtest.example.com/callback/<connector-id>`, which the mock accepts through its
`/callback/*` wildcard.
