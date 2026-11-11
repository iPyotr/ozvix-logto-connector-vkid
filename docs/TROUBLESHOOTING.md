# Troubleshooting

Symptom → cause → fix, for the VK ID social connector on Logto OSS 1.46.0.

The connector does not print secrets, so almost every diagnosis starts the same way: find the
request in the Logto container log, then match the message or the error code against a section
below. Commands for both PowerShell and bash are given where they differ.

---

## Quick reference

| Symptom                                                                                                  | Most likely cause                                                                                                                                                                                      | Where to look                                                                                 |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | --- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ----------------------------- |
| "VK ID" is not in the social connector list                                                              | Loader skipped the directory: wrong package name, missing `lib/index.js`, or the connector-kit version gate                                                                                            | [Connector is not listed](#connector-is-not-listed-in-the-admin-console)                      |
| Sign-in page shows a raw error, log says the authorization session is missing/expired                    | Stale or replayed interaction session; callback hit a fresh Logto session                                                                                                                              | [Session missing or expired](#session-missing-or-expired)                                     |
| VK ID shows an error page right after clicking **VK ID**, before any consent form                        | `redirect_uri` does not match the registered trusted redirect URL, or uses a port other than 80/443                                                                                                    | [VK shows an error page](#vk-shows-an-error-page-after-the-consent-screen)                    |
| Callback URL has `code` but the log says `device_id` is missing                                          | The redirect URI registered in VK ID is not the exact Logto callback path, or a proxy drops the query string                                                                                           | [Missing device_id](#missing-device_id)                                                       |
| VK rejects the authorization with `invalid_scope`                                                        | Scope requested by the connector is not enabled in the VK application                                                                                                                                  | [Invalid scope](#invalid-scope)                                                               |
| User signed in but got a new, empty Logto account instead of their old one                               | No linkable identifier was forwarded (`syncEmail`/`syncPhone` off), so Logto created a new user                                                                                                        | [Account not linked](#account-not-linked-or-a-duplicate-account-appeared)                     |
| User has no e-mail or phone in Logto                                                                     | Three-condition scope/sync gating; both sync switches default to off                                                                                                                                   | [E-mail or phone not synced](#e-mail-or-phone-not-synced)                                     |
| `502 connector.social_provider_unreachable`, code `ETIMEDOUT`                                            | Logto cannot reach VK ID: egress, DNS, TLS interception, or too small a timeout                                                                                                                        | [502 social provider unreachable](#502-connectorsocial_provider_unreachable)                  |
| `401 connector.authorization_failed` after choosing VK ID                                                | VK returned an `error` callback (typically `access_denied` = blocked/deleted account), or consent was refused                                                                                          | [401 connector.authorization_failed](#401-connectorauthorization_failed-after-choosing-vk-id) |
| Token storage is on, but the stored token stops working after ~1 hour                                    | There is no refresh grant; VK access tokens live 1 hour and VK refresh tokens are single-use and need `device_id`                                                                                      | [Token storage without refresh](#token-storage-is-enabled-but-tokens-are-never-refreshed)     |
| VK rejects `https://localhost:3001` or any non-443 URL                                                   | VK ID only supports redirect URIs on ports 80 and 443                                                                                                                                                  | [Ports and HTTPS](#ports-and-https-are-restricted)                                            |
| VK returns `invalid_request` before the consent form and the `authorize` request carries a short `state` | VK requires `state` >= 32 characters; stock Logto generates 14. The derived image patches it to 46                                                                                                     | [`state` shorter than 32](#state-is-shorter-than-32-characters)                               |
| After the VK consent Logto asks to set a username                                                        | The Sign-in experience requires the `username` sign-up identifier; the connector cannot provide it (VK ID has no username and `SocialUserInfo` has no such field). Remove the identifier or use e-mail | [Username prompt](#username-prompt-after-social-sign-in)                                      |
| Admin Console shows "Insecure contexts (non-HTTPS) are not supported"                                    | The Console is served over plain HTTP; Web Crypto requires a secure context                                                                                                                            | [Admin Console requires HTTPS](#admin-console-requires-https)                                 |
| Admin Console falls back, log says "does not match any configured admin endpoint"                        | TRUST_PROXY_HEADER is not set behind the reverse proxy, so Logto sees http instead of https                                                                                                            | [Proxy scheme](#behind-a-reverse-proxy-the-console-falls-back-to-the-default-tenant)          |     | After removing/rolling back the connector, Logto errors on the saved connector | The connector record still exists in the database but its factory is gone | [Rolling back](#rolling-back) |

## Reading the Logto logs

The official Logto image writes to the container's stdout, so `docker compose logs` is the primary
source. Replace `<logto-service>` with the Logto service name from your compose file (common names:
`logto`, `logto-core`).

Find the service and container first:

```bash
docker compose ps
```

Follow the log live:

```bash
docker compose logs --since 30m --timestamps -f <logto-service>
```

PowerShell without a compose project, by container name:

```powershell
docker ps --filter "name=logto" --format "{{.Names}}"
docker logs --since 30m -f <container-name>
```

Filter for the interesting lines. bash:

```bash
docker compose logs --since 30m <logto-service> 2>&1 \
  | grep -Ei "load-connector|vk-universal|social|connector"
```

PowerShell:

```powershell
docker compose logs --since 30m <logto-service> 2>&1 |
  Select-String -Pattern "load-connector|vk-universal|social|connector"
```

What matters in the output:

- at **startup**, the loader lines: a successful load is quiet, a skipped directory is logged with
  `[load-connector]` and a reason (see
  [Connector is not listed](#connector-is-not-listed-in-the-admin-console));
- during a **login attempt**, the connector error: the message text comes from `src/index.ts`,
  `src/client.ts` or `src/http.ts` and is quoted in the sections below;
- the **error code** (for example `connector.authorization_failed`) that Logto returns to the
  browser.

If you configured file-based logging or an external log driver, use that instead — the messages are
the same.

## Connector is not listed in the Admin Console

**Symptom.** Admin Console → Connectors → Social connectors → Add social connector does not offer
"VK ID". Or it was offered earlier and disappeared after a restart.

**Cause.** Logto 1.46.0 scans `/etc/logto/packages/core/connectors/` at **runtime, on startup**. It
loads a direct child directory only if all of these hold:

1. the directory contains a `package.json`;
2. `name` starts with `connector-` or `@scope/connector-*` — `@ozvix/connector-vkid` qualifies;
3. `dependencies["@logto/connector-kit"]` satisfies the version installed in the image (5.2.0) —
   this package declares `^5.2.0`, the upstream package's exact `5.1.2` pin does **not** satisfy it;
4. the entry point exists: `lib/index.js`.

Any failure here is logged and the connector is silently skipped — nothing appears in the Admin
Console and no error is shown in the browser.

**Fix.**

1. Confirm the package directory is where Logto expects it, with its contents:

   ```bash
   docker compose exec <logto-service> ls -la /etc/logto/packages/core/connectors/
   docker compose exec <logto-service> cat /etc/logto/packages/core/connectors/connector-ozvix-vkid/package.json
   docker compose exec <logto-service> ls -la /etc/logto/packages/core/connectors/connector-ozvix-vkid/lib/
   ```

   The PowerShell equivalents are identical; only the surrounding shell differs.

2. Verify the three loader conditions against that output: `name` is `@ozvix/connector-vkid`,
   `dependencies["@logto/connector-kit"]` is `^5.2.0`, and `lib/index.js` exists.

3. If you mounted a directory, confirm the mount is present **before** startup and that the host
   directory is not empty. A bind mount to a non-existent host path creates an empty directory and
   the connector disappears.

4. Restart so the loader rescans. For a bind mount, a restart is enough; for a rebuilt image, the
   container must be recreated:

   ```bash
   # bind mount: code files changed, container config unchanged
   docker compose restart <logto-service>

   # image changed (derived Dockerfile rebuilt, image tag updated)
   docker compose up -d --no-deps <logto-service>
   ```

5. Read the startup log for `[load-connector]` (see [Reading the Logto logs](#reading-the-logto-logs)).
   A version-gate skip names the installed and declared connector-kit versions — that is the
   symptom of shipping the upstream package instead of this one.

6. Do not set `IGNORE_CONNECTOR_VERSION_CHECK` as a workaround. Logto documents that variable as
   highly discouraged in production, and with this package it is unnecessary (`^5.2.0` passes the
   gate); using it hides a real incompatibility.

Also note: Logto rejects **duplicate factory ids**. This connector keeps id `vk-universal` for
drop-in migration, so never install it next to the upstream `@workingbit/connector-vk`.

## Session missing or expired

**Symptom.** The sign-in fails at the callback and the log contains:

> VK ID authorization session is missing or expired; the PKCE code verifier, redirect URI or state
> was not found in the Logto connector session

**Cause.** During `getAuthorizationUri` the connector stores `vk_code_verifier`, `vk_redirect_uri`
and `vk_state` in the Logto interaction session. At the callback it must find them again. This error
means they were absent or malformed — the interaction session was expired, already consumed, or the
callback arrived against a different Logto session. Typical triggers:

- the user left the VK tab open and finished the consent screen much later, after the interaction
  expired;
- the same VK callback URL was reopened or reloaded (the code may still be shown in the address bar,
  but the session is gone);
- the browser lost or cleared Logto cookies between the click and the callback (private mode,
  cookie-blocking extension, or cookies scoped to the wrong domain);
- the callback URL was handed to a different Logto instance than the one that started the login
  (two deployments behind one hostname, or an old container serving a stale request).

**Fix.**

1. Retry the login from the beginning — a fresh click creates a fresh session. This resolves the
   large majority of cases.
2. If it repeats for every user, check the deployment: one Logto instance must serve both the
   authorize URL and the callback (`https://auth.example.com`), with no second instance competing for
   the same host.
3. Check the callback host and path exactly match the registered trusted redirect URL — a callback
   landing on a different host means a different Logto (and a different session store).
4. Make sure the browser accepts cookies for the Logto domain (`auth.example.com`), including when
   behind a proxy that rewrites `Set-Cookie` domains.
5. If the session is present but the _verifier is invalid_ (length or charset), the error is also
   this `invalid_request_parameters` code — that means a corrupted or forged session, not a normal
   expiry; treat it as a deployment bug and capture the exact connector version.

## VK shows an error page after the consent screen

**Symptom.** The user clicks **VK ID** and VK shows an error page (or leaves the user on VK), Logto
never receives the callback. Sometimes the Logto log shows a token response with a 4xx.

**Cause.** The `redirect_uri` sent to `https://id.vk.ru/authorize` does not match the application's
registered **Доверенный redirect URL**. VK ID requires an exact string match and requires the
redirect URI's domain to equal the application's base domain. Common mismatches:

- registering the Logto **endpoint root** (`https://auth.example.com`) instead of the connector's
  callback path (`https://auth.example.com/callback/<connector-id>`);
- registering the **admin** host (`https://auth-admin.example.com`) — it is a different host and does
  not serve the callback;
- `http` vs `https`, a missing or extra trailing slash, a different case in the host;
- a port other than 80/443 (see [Ports and HTTPS](#ports-and-https-are-restricted));
- the Logto endpoint was changed (`ENDPOINT`) without updating the VK application.

**Fix.**

1. Open the connector page in the Admin Console and copy the **Callback URI** it displays.
2. Open the VK ID cabinet → **Мои приложения** → your application → **Доверенный redirect URL** and
   make it byte-identical to the copied value.
3. Make sure **Базовый домен** is the same host without scheme, port or path (`auth.example.com`).
4. Save, wait a moment, retry in a private window. VK's registration is cached on VK's side; if the
   first retry still fails, wait a minute and retry again.
5. If the mismatch cannot be found, capture the `redirect_uri` value from the browser's network log
   for the `authorize` request and compare it character by character with the cabinet value.

VK's own error wording for this case is **UNVERIFIED** — VK documents that the user sees an error
page, but not the exact text or whether an `error` parameter is redirected back. Treat a VK-side
error page without any callback as this mismatch first.

## Missing device_id

**Symptom.** The callback reaches Logto, the log contains:

> The VK ID callback is missing the authorization code or device_id. Make sure the VK ID application
> redirect URI points to this Logto connector.

**Cause.** VK ID redirects with `code`, `state` and `device_id` (plus an optional `type`). If
`device_id` (or `code`) is missing, the request Logto received is not VK's documented redirect:
another layer rewrote, stripped or appended to the query string, or the redirect URI pointed at a
path that does not forward query parameters.

Typical causes:

- the trusted redirect URL registered in VK ID includes a query string or a path that your reverse
  proxy rewrites, dropping parameters;
- a proxy/WAF rule that strips unknown query parameters;
- a redirect chain through an internal URL that re-encodes the query;
- the user's browser hitting a stale bookmark of an old callback URL.

**Fix.**

1. In the browser's address bar at the failing moment, confirm the URL carries all three parameters:
   `code=…`, `state=…`, `device_id=…`.
2. If they are present in the browser but not in Logto, the reverse proxy is dropping the query
   string — fix the proxy rule so the callback path passes the query through untouched.
3. If they are absent in the browser, re-register the trusted redirect URL as the exact Logto
   callback path with no query string and no fragment (see
   [VK shows an error page](#vk-shows-an-error-page-after-the-consent-screen)).
4. `state` is optional in the connector's validation but if it is present and does not match the
   session the login fails with a state-mismatch message — that is the correct behaviour and
   indicates a session mix-up, not a VK bug.

## Invalid scope

**Symptom.** VK ID rejects the authorization, often before the consent form, and VK's documented
error code for this is `invalid_scope`. Logto logs the token exchange failing or shows the VK error
page.

**Cause.** The `scope` configured in the connector contains a scope that is not enabled in the VK ID
application, or is malformed. VK's rule: the requested scope list cannot exceed the scopes allowed in
the application's settings. The connector's default is `vkid.personal_info`, which every
application has. `email` must be switched on in the cabinet. `phone` is an **extended** permission
that requires a confirmed business profile.

**Fix.**

1. In the VK ID cabinet, enable the scope (**Доступы**; extended permissions under **Расширенные
   доступы**). For `phone`, confirm the business profile first.
2. Keep the connector's `scope` field consistent with what is enabled — space-separated tokens, e.g.
   `vkid.personal_info email`.
3. Remember that enabling `email`/`phone` in the cabinet does not by itself put them in the Logto
   profile: `syncEmail`/`syncPhone` must also be on (see
   [E-mail or phone not synced](#e-mail-or-phone-not-synced)).
4. If the connector reports an invalid configuration instead of a VK error, the `scope` string is
   malformed (only letters, digits, `_`, `.`, `:`, `-` are allowed; tokens separated by spaces).

## Account not linked or a duplicate account appeared

**Symptom.** A user who already had a Logto account signs in with VK ID and gets a **second**,
empty-ish Logto account. Or the VK identity is attached to an existing account that the user did not
expect.

**Cause.** Logto links a social identity to an existing user through identifiers carried by the
profile — e-mail and phone. This connector forwards neither by default (`syncEmail` and
`syncPhone` are `false`), precisely because unverified identifiers must not become account-linking
targets. So with default configuration:

- a VK user with an existing password/e-mail Logto account gets a **new** Logto user — by design;
- if you enable `syncEmail` and the VK address equals an existing Logto user's address, Logto may
  attach the VK identity to that existing user — which is exactly the account-takeover path the
  default protects against.

**Fix.** Decide the policy before launch, per user population:

1. **Social-only installation with no pre-existing accounts** (the OZVIX case): keep both sync
   switches off. Duplicates do not arise because there is nothing to duplicate; each VK user gets
   one account.
2. **Migration from an existing Logto user base**: users will get new accounts unless you either
   (a) enable `syncEmail` and accept the linking semantics (only if you trust VK e-mails for your
   population), or (b) link accounts administratively. Logto's Admin Console does not offer a
   documented, generally available "link this VK identity to user X" action in 1.46.0 —
   **UNVERIFIED**; check the Logto Management API for your version before promising this to users.
3. Remove an accidental duplicate: verify with the user which account holds their data, then delete
   or disable the redundant user in Admin Console → Users. Deleting a user is destructive — confirm
   the choice with the user first.
4. Never enable `syncPhone` "just to fix linking": Logto prefers a phone match over an e-mail match,
   so it widens the takeover surface (see the README section on
   [account linking](../README.md#account-linking-why-e-mail-and-phone-sync-are-off-by-default)).

## E-mail or phone not synced

**Symptom.** The user signs in, the display name and avatar are correct, but the user record has no
e-mail and/or no phone number.

**Cause.** This is the default and intended behaviour. A value reaches Logto only if **all three**
conditions hold:

1. the scope is enabled in the VK ID application dashboard;
2. the scope is included in the connector's **Scope** field, e.g. `vkid.personal_info email phone`;
3. the matching switch (**Sync e-mail** / **Sync phone number**) is on.

Additionally, `phone` requires a **confirmed business profile** in VK ID (extended permission), and
the connector drops values it cannot validate: an e-mail that is not a plausible address, or a
phone that is not an 11-digit `7…` number / `+`-prefixed 8–15-digit number, is silently discarded.

**Fix.**

1. Check the three conditions in order — the most common miss is condition 3, because the switches
   default to off.
2. Save the connector config, then have the user sign in **again**: the profile is read on each
   login, an existing session is not re-read.
3. If the scope is enabled and requested but the field is still empty, inspect the raw `user_info`
   response in the log (the connector does not log it, so use a controlled `curl` with a token you
   obtained manually — never paste that token into a ticket). A missing field means VK did not return
   it, which points back to the cabinet checks.
4. For an existing user, adding the e-mail later does **not** retroactively re-link accounts
   (whether Logto re-runs linking on a subsequent login for an already-linked identity is
   **UNVERIFIED**); design the policy before the user population grows.

## 502 connector.social_provider_unreachable

**Symptom.** The browser receives `502` with error code `connector.social_provider_unreachable` and
the log shows an `ETIMEDOUT` (or a connection/TLS failure) for `https://id.vk.ru/oauth2/auth` or
`https://id.vk.ru/oauth2/user_info`.

**Cause.** Logto could not complete the request to VK ID. The connector maps its own timeout to this
error deliberately, so this is the correct signal for a transport-level problem:

- the Logto container has no egress to `id.vk.ru` (firewall, security group, corporate proxy, no
  DNS);
- the request exceeded `timeout` (default 8000 ms) — VK ID slow, or a proxy adding latency;
- TLS interception with an untrusted certificate;
- an outbound proxy is required but `HTTPS_PROXY` is not set for the container.

**Fix.**

1. Test connectivity **from inside the Logto container**, not from your laptop:

   ```bash
   docker compose exec <logto-service> node -e "fetch('https://id.vk.ru/').then(r => console.log('HTTP', r.status)).catch(error => console.error('FAIL', error.name, error.message))"
   ```

   The same command works in PowerShell. `HTTP 200` (or any HTTP status) means the network path
   works; `FAIL` with `ENOTFOUND`, `ETIMEDOUT`, `ECONNREFUSED` or a certificate error localises the
   problem to egress/DNS/TLS.

   If `node` is unavailable in your image variant, run an equivalent request from a throwaway
   container attached to the same Docker network.

2. If DNS fails, fix the container's resolver (Docker daemon DNS or compose `dns:`). If TLS fails,
   remove the interception or install the corporate CA in the container. If egress is blocked, allow
   `id.vk.ru:443`.
3. VK latency is variable; for a slow link raise the connector's `timeout` (allowed 1000–60 000 ms,
   e.g. `15000`) and retry.
4. Re-check after any change with the same command, then retry the login.

Note: the connector reduces the logged URL to origin + path before Logto prints it, so a query
string containing an authorization code never reaches the log — do not expect to see request
parameters here.

## 401 connector.authorization_failed after choosing VK ID

**Symptom.** The browser receives `401` with error code `connector.authorization_failed`, and the
log shows an authorization failure carrying VK's OAuth error, typically `access_denied`.

**Cause.** VK returned an error instead of a code. Two very different situations produce it:

1. **`access_denied` — the VK account is blocked or deleted.** VK's documentation is explicit that
   `access_denied` means "the user has no access to VK ID: blocked or deleted", **not** "the user
   clicked Cancel". If the account is fine, this is unlikely to be the cause.
2. **Consent was refused or the flow was interrupted.** VK documents that a failed authorization
   shows the user an error page; whether an `error` parameter is redirected back to the callback is
   **UNVERIFIED** in VK's documentation. The connector handles both shapes: an `error` callback
   becomes `AuthorizationFailed`, and a callback without `code` becomes a generic authorization
   failure.

**Fix.**

1. Read the log message: it contains the OAuth `error` and `error_description` when VK supplied
   them. `access_denied` → verify the user's VK account status; VK's own help resources are the
   authority here.
2. If the user cancelled deliberately, nothing is broken; ask them to retry and complete the consent
   form.
3. If the error is something else (`invalid_request`, `server_error`, `temporarily_unavailable`,
   `login_required`, `interaction_required`), re-check the redirect URI and the scope first — those
   are the configuration errors that surface as provider errors.
4. `temporarily_unavailable`/`server_error` retried a few minutes later usually disappears; it is
   VK-side.
5. Never treat this code as "credentials are wrong": the connector did not reach a token exchange,
   so there is no client id/secret problem involved.

## Token storage is enabled but tokens are never refreshed

**Symptom.** Token storage (Secret Vault) is enabled in Logto, the token exchange succeeds, but
after about an hour the stored access token is useless and nothing refreshes it.

**Cause.** By design. VK ID access tokens live **1 hour**; refresh tokens live **180 days** but are
**single-use with rotation** (reusing an old one invalidates every token of that session), and VK's
refresh grant additionally requires the `device_id`, which this connector does not persist.
`isTokenStorageSupported` is `true` and the connector forwards `access_token`, `refresh_token`,
`id_token`, `expires_in`, `scope` and `token_type` to Logto, but **no refresh grant is
implemented** — a half-working refresh would be worse than none.

**Fix.** Treat token storage as a store-without-refresh capability: it is useful for audit and for
requests within the first hour, not for long-lived delegated access.

1. If you do not need the tokens at all, disable token storage for this connector — fewer secrets
   stored is better.
2. If you need delegated VK access, obtain it out of band; do not build a refresh flow against the
   stored refresh token, because a single failed retry can invalidate the whole VK session.
3. Do not expect `expires_in`-based renewal: nothing renews it.

## Ports and HTTPS are restricted

**Symptom.** VK ID rejects the redirect URI (error page, or no callback at all) whenever the Logto
instance is not on port 443 or 80 — typically a local instance on `:3001`.

**Cause.** VK ID supports redirect URIs only on ports **80** and **443**. Its documentation says so
explicitly for localhost testing ("other ports are temporarily not supported") and frames plain
HTTP at `http://localhost:80` as a local-testing exception. In practice a Logto dev instance on
`http://localhost:3001` cannot be a VK ID redirect target.

**Fix.**

1. **Production:** serve Logto on a public HTTPS host on 443 (`https://auth.example.com`, Caddy
   terminating TLS) and register that host's callback URL.
2. **Local end-to-end test:** publish Logto on `https://localhost:443` through a local reverse proxy
   with a trusted certificate, and register `https://localhost` as the base domain. Whether VK
   accepts a callback _path_ on `https://localhost` is **UNVERIFIED** — if it does not, test through
   a staging host on 443 instead.
3. **`http://localhost:80`** is documented by VK for testing, but it is plain HTTP; use it only on a
   throwaway environment.
4. A tunnel only works if the registered host is the tunnel's public `https://` host on 443 and that
   hostname is stable; a rotating tunnel hostname means re-registering the redirect URI every time
   and is unsuitable beyond debugging.
5. Verify that the reverse proxy forwards the callback path to Logto, not to a static site: a plain
   `GET` of the callback URL should produce a Logto response (an error — the endpoint is not meant
   to be opened directly), not a proxy 404.

## `state` is shorter than 32 characters

**Symptom.** VK OAuth 2.1 rejects the authorization before the consent form, and the `state` value in
the `authorize` request is shorter than 32 characters.

**Cause.** VK requires `state` of at least **32 characters**, and the official VK SDKs enforce the same
minimum (`VkAuthorizeUtil.kMinStateLength = 32`). Logto Experience 1.46.0 generates `se_` plus
base64url of 8 random bytes — **14 characters** — so a stock `svhd/logto:1.46.0` image does not satisfy
the requirement. The connector cannot fix this on its own: VK echoes `state`, and the Experience page
compares it with the value it stored in the browser session.

**Fix.** Use the derived image from this repository. Its build patches the pinned Experience bundle so
the social `state` becomes 32 random bytes (46 characters including the `se_` prefix), and it fails
loudly if the pattern cannot be applied:

```bash
docker compose logs logto | grep patch-experience-state   # only during the image build
docker run --rm --entrypoint sh ozvix/logto-vkid:1.46.0-vkid.1 -c \
  'grep -c "jm(32)" /etc/logto/packages/experience/dist/assets/index-*.js'
```

If you run the stock Logto image, verify the actual length in the browser's network log for the
`authorize` request. A value below 32 characters may be rejected by VK, and there is no
connector-side workaround — patch the Experience bundle (as this repository does) or upgrade Logto
when it generates a compliant state.

## Rolling back

Two independent things can be rolled back: the **connector** (the code loaded into Logto) and the
**configuration** (stored in Logto's database). Rolling back the code requires no database
migration. Rolling back the image is a normal compose operation.

**1. Record what is running now** — before you change anything:

```bash
docker compose ps
docker inspect "$(docker compose ps -q <logto-service>)" --format '{{.Config.Image}}'
docker image ls
```

PowerShell:

```powershell
docker compose ps
docker inspect (docker compose ps -q <logto-service>) --format '{{.Config.Image}}'
docker image ls
```

Keep the previous derived image tagged locally (for example `logto-vkid:previous`) so a rollback is
instant:

```bash
docker tag <current-derived-image> logto-vkid:previous
```

**2. Roll back the connector only.**

_Bind-mount install:_ point the volume at the previous package directory (or remove the connector
directory entirely), then restart so the loader rescans:

```bash
docker compose restart <logto-service>
```

_Derived-image install:_ set the compose `image:` back to the previous tag and recreate only that
service:

```bash
docker compose up -d --no-deps <logto-service>
```

**3. Roll back to plain upstream Logto** (connector removed entirely): set the compose `image:` back
to `svhd/logto:1.46.0`, drop the extra volume or `COPY` layer, and recreate:

```bash
docker compose up -d --no-deps <logto-service>
```

**4. Deal with the saved connector record.** If a connector instance was already configured in the
Admin Console, removing its code leaves a record whose factory no longer loads; Logto may log errors
about the missing connector. Before removing the code, delete or disable the instance in
Admin Console → Connectors → VK ID. (Whether a stale record causes user-visible errors in 1.46.0 is
**UNVERIFIED**; deleting the instance first avoids the question.)

**5. Verify the rollback.**

1. The Logto container starts cleanly (`docker compose ps` shows it healthy, no `[load-connector]`
   error lines, or the expected line for the previous package).
2. The Admin Console opens and the sign-in page renders.
3. The social connector list contains exactly what you expect.
4. A social login with a provider that still works succeeds; the VK button is gone (or present, if
   you rolled back to the previous working VK package).

Existing Logto users and their social identities are not touched by a connector rollback; stored
tokens are not revoked at VK ID (there is no revocation call in this connector) and expire on their
own within the access-token lifetime.

**6. Configuration rollback.** Connector configuration lives in Logto's PostgreSQL database. If you
need to go back to an earlier configuration, restore it from your regular PostgreSQL backup — there
is no connector-specific migration or table to repair.

## What to include when asking for help

Share (after removing anything sensitive):

- Logto version (1.46.0 or other) and whether the image is the official one or derived;
- the exact connector package version (`@ozvix/connector-vkid` 1.0.0 or other);
- whether the connector is listed in the Admin Console;
- the relevant log lines — the connector error message and the Logto error code;
- the browser URL **after** the VK consent step, with the values of `code`, `state` and `device_id`
  replaced by `<redacted>`;
- the `error` / `error_description` from a VK error callback, if present;
- what you already checked (redirect URI, scope, ports, sync switches).

Never include: the service token, the _Защищённый ключ_, access or refresh tokens, an authorization
code, the PKCE verifier, or a VK password. Also avoid publishing your numeric application id in a
public issue — it is not a secret, but it identifies your application.

## Scope and verification status of this document

The behaviour described here comes from the connector source (`src/`), the Logto 1.46.0 behaviour
cited in the project's research documents, and VK's published protocol documentation
([VK-ID-PROTOCOL.md](research/VK-ID-PROTOCOL.md)). For the connector's unit suite, run `npm test`;
the local Logto + mock VK ID container environment is documented in
[LOCAL-TESTING.md](LOCAL-TESTING.md).

A **real end-to-end login against VK ID is a manual test** and has not been executed by the project;
the checklist is in [VK-ID-SETUP.md](VK-ID-SETUP.md#manual-verification-checklist). Where VK's
behaviour is undocumented or untested, this document says **UNVERIFIED** rather than guessing —
most importantly: VK's cabinet UI wording, the `state` length enforcement, the redirect-flow error
contract, trailing-slash tolerance, and token-endpoint error codes.

## Admin Console requires HTTPS

The Admin Console and the sign-in experience use Web Crypto (Crypto.subtle), which browsers only
expose in a secure context. On `http://` the Console renders "Insecure contexts (non-HTTPS) are not
supported" and the first administrator cannot be created. Serve the Console (ADMIN_ENDPOINT) and
the endpoint (ENDPOINT) over HTTPS — a local reverse proxy with its own CA is enough for a test
host.

## Behind a reverse proxy the Console falls back to the default tenant

Logto 1.46.0 honours `X-Forwarded-Proto` only when `TRUST_PROXY_HEADER=1` is set; the older
`TRUST_PROXY` variable is ignored. Without it Logto builds the request origin from the TCP
connection, sees `http` while `ADMIN_ENDPOINT` is `https`, and logs:

`This request does not match any configured admin endpoint and will be served by the default tenant, which does not host the Console.`

Set `TRUST_PROXY_HEADER=1` in the Logto container environment (the reverse proxy must send
`X-Forwarded-Proto`, which Caddy, nginx and Traefik do by default) and make sure
`ADMIN_ENDPOINT` matches the public Console URL exactly.

## Username prompt after social sign-in

The connector maps the VK display name to `SocialUserInfo.name`; Logto stores it as the user's name
without asking. The extra "Set username" step comes from the **Sign-in experience**: when `signUp.
identifiers` contains `username` (or `email`/`phone`), Logto requires that identifier for every new
account, and a VK profile does not carry a `username` field.

Fix it in **Sign-in experience → Sign-up and sign-in → Sign-up identifiers**: remove `username` for
social-only registration, or keep `email` together with the connector's `Sync e-mail` option and the
`email` scope in the VK ID cabinet. The connector itself cannot supply a username, because Logto's
social connector contract has no username field.

## `invalid_grant` right after opening the sign-in link

**Symptom.** The OIDC `/oidc/auth` request redirects straight back to the application callback with
`error=invalid_grant&error_description=grant request is invalid`, and the Logto log shows no
`/sign-in` and no `/callback/<connector-id>` request.

**Cause.** The browser still holds a Logto session cookie for an account that no longer exists (for
example, test users were deleted while the browser stayed open). Logto tries to resume that session,
fails, and answers the authorization request with `invalid_grant`. It is not a VK error and not a
connector error — no request reached the provider.

**Fix.** Open the link in a private window, or clear cookies for the Logto endpoint host, and start
again. Adding `prompt=login` to the authorization request also forces a fresh sign-in.
