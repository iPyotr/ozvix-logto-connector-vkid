# VK ID setup guide

How to create the VK ID application that backs this connector, register the redirect URI VK ID
requires, choose scopes, and — at the end — how to verify the whole thing by hand. It assumes you
have never used the VK ID cabinet or Logto before.

Audience: the administrator of a Logto OSS installation that uses this connector. The running
example is the example deployment: Logto at `https://auth.example.com`, Admin Console at
`https://auth-admin.example.com`, behind a Caddy reverse proxy.

> Placeholders in this guide: `<VK_ID_CLIENT_ID>` is the VK ID application id (a number). Never put
> a real client id, service token or VK password into a document, a ticket or a chat.

---

## What you need before you start

| Item                                                   | Why                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A VK account with a **VK Бизнес ID** account           | Log in to the VK ID cabinet through VK Бизнес ID; the cabinet is not reachable with a plain personal VK account.                                                                                                                                                                                                                    |
| A **confirmed business profile**                       | Until the business profile is confirmed, app keys and settings are restricted in the cabinet. VK's rules: new customers get 60 days from their first app; apps of customers registered before 2025-12-15 are blocked after 2026-03-01 if the profile is not confirmed. These dates come from VK's own documentation and may change. |
| Logto reachable on a **public HTTPS host on port 443** | VK ID only accepts redirect URIs on ports 80 and 443. `https://auth.example.com` qualifies; `http://localhost:3001` does not (see [The redirect URI and the port limitation](#the-redirect-uri-and-the-port-limitation)).                                                                                                           |
| The Logto **Callback URI** for this connector          | Copy it from the Admin Console — do not type it from memory. It is derived from your endpoint and the connector id `vk-universal`; on the example deployment it is `https://auth.example.com/callback/<connector-id>`.                                                                                                              |
| About 15 minutes                                       | No VK support ticket is needed for a normal public web application.                                                                                                                                                                                                                                                                 |

External VK documentation used in this guide:

- Cabinet: <https://id.vk.ru/about/business/go/>
- Application creation, app types, redirect URI rules: <https://id.vk.ru/about/business/go/docs/ru/vkid/latest/vk-id/connection/create-application>
- Authorization API reference: <https://id.vk.ru/about/business/go/docs/ru/vkid/latest/vk-id/connection/api-description>
- Scopes: <https://id.vk.ru/about/business/go/docs/ru/vkid/latest/vk-id/connection/work-with-user-info/scopes>

## Part 1: Create the VK ID application

### Step 1: sign in to the VK ID cabinet

1. Open <https://id.vk.ru/about/business/go/>.
2. Sign in through **VK Бизнес ID**. Logging in with a personal VK account alone does not give
   access to the cabinet.
3. If you have no business profile yet, create and confirm one first. Without it the application
   settings and keys stay restricted.

### Step 2: create the application

1. In the cabinet, open **Мои приложения** (the application list).
2. Create a new application. The cabinet's exact button wording varies between releases — look for
   the create/"new application" control inside **Мои приложения**; it is not a hidden advanced
   setting.
3. Give it a recognisable name, for example `OZVIX Logto`, and choose the platform/site type that
   corresponds to a **web** application (a server-side website), not a mobile or standalone app. The
   cabinet's exact type names are **UNVERIFIED** — pick the web/server-side option.

### Step 3: choose the application type

VK ID has two relevant types:

| Type                                             | What it means for this connector                                                                                                                                                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Public** web application (recommended default) | No extra credential in the token exchange. Requests are limited to 15 000/day **per IP address** — every server behind your egress IP shares that budget.                                                                         |
| **Конфиденциальное** (confidential)              | The token exchange must carry a **service token** (`Сервисный ключ доступа`), and VK ID only accepts the exchange from **pre-registered IP addresses**. Limit: 120 000 requests/day per application. Requires a static egress IP. |

For a self-hosted Logto behind one egress IP, the public type is usually enough. Choose
_Конфиденциальное_ only if you have a static IP and need the higher limit — see
[Confidential applications](#confidential-applications).

Do not confuse the two VK key types in the cabinet:

- **`ID приложения`** — the application id. This is the connector's `clientId`.
- **`Защищённый ключ`** — the "protected key" for client-side SDKs, used as `client_secret` **inside
  VK's JavaScript SDK only**. It must never be put into this connector or any server-side form.
- **`Сервисный ключ доступа`** — the service token, used by confidential server-side applications.
  This one maps to the connector's `serviceToken`.

### Step 4: register the base domain and the trusted redirect URL

This is the step that makes or breaks the integration.

1. Set **Базовый домен** to the host that serves your Logto endpoint: `auth.example.com`.
   - No scheme (`https://`), no port, no path.
   - For local testing VK documents `localhost` (see the port limitation section).
   - VK documents limits around 102 base domains and 512-character values; the practical rule for
     this connector is one host that exactly equals the redirect URI host. Subdomains can be
     wildcarded by prefixing a dot (`.example.com`); fragments are not allowed.
2. Set **Доверенный redirect URL** to the exact Callback URI from the Logto Admin Console:
   `https://auth.example.com/callback/<connector-id>`.
   - Insert the Logto callback path, not the front page and not the admin host. The admin host
     (`auth-admin.example.com`) does not serve the callback endpoint.
   - No fragment (`#...`).
   - A trailing slash is permitted by VK's registration rules, but whether VK tolerates a
     trailing-slash difference between the registered URL and the value sent in the request is
     **UNVERIFIED** — register exactly the string Logto will send.
3. Save.

VK ID matches the redirect URI by **exact string**, and the redirect URI's domain must equal the
base domain. A mismatch is not diagnosable from the VK UI; the user simply sees an error page after
the consent screen, or the code exchange fails. If that happens, re-read
[TROUBLESHOOTING.md](TROUBLESHOOTING.md#vk-shows-an-error-page-after-the-consent-screen).

### Step 5: enable the scopes you need

In the application settings open the access/permission section (**Доступы**; extended permissions
are under **Расширенные доступы**) and enable what you intend to request:

| Scope                | To enable it you need                                                           | What it returns                                         |
| -------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `vkid.personal_info` | Nothing extra — it is the basic scope of every application.                     | `first_name`, `last_name`, `avatar`, `sex`, `birthday`. |
| `email`              | A dashboard toggle. It is **off by default**.                                   | `email`.                                                |
| `phone`              | An **extended** permission, granted only with a **confirmed business profile**. | `phone`.                                                |

Two conditions must hold for a value to come back: the scope must be enabled in the cabinet **and**
requested in the `scope` parameter of the authorization request (that parameter is configured in the
connector). Requesting a scope that is not enabled in the cabinet fails the authorization with
`invalid_scope`.

The default connector configuration requests only `vkid.personal_info`, which is enough for
sign-in: VK supplies the user id, the display name and the avatar. E-mail and phone are optional and
carry an account-linking risk in Logto — read
[Account linking](../README.md#account-linking-why-e-mail-and-phone-sync-are-off-by-default) before
enabling them.

### Step 6: copy the application id

Copy **`ID приложения`** (a number; record it as `<VK_ID_CLIENT_ID>`) into the connector's
`Client ID` field. It is not a secret, but it identifies your application — keep it in your password
manager or internal runbook, and do not publish it in tickets or public issues.

## Part 2: Configure the connector in Logto

1. Open the Admin Console: `https://auth-admin.example.com`.
2. Go to **Connectors** → **Social connectors**.
3. Open the **VK ID** connector (if it is not in the list at all, the connector was not loaded —
   see [TROUBLESHOOTING.md](TROUBLESHOOTING.md#connector-is-not-listed-in-the-admin-console)).
4. Fill in:

| Field                           | What to enter                                                                                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Client ID**                   | `<VK_ID_CLIENT_ID>` — the `ID приложения` from step 6.                                                                                              |
| **Service token**               | Empty, unless the application is _Конфиденциальное_; then paste `Сервисный ключ доступа` as `<VK_ID_SERVICE_TOKEN>`.                                |
| **Scope**                       | Leave empty for the default `vkid.personal_info`. Add `email` / `phone` only if enabled in the cabinet **and** you want them forwarded (see below). |
| **Sync e-mail**                 | Off unless you accept that Logto may link an existing e-mail account to the VK identity.                                                            |
| **Sync phone number**           | Off for the same reason; Logto prefers a phone match over an e-mail match.                                                                          |
| **VK ID API origin (advanced)** | Leave empty → `https://id.vk.ru`.                                                                                                                   |
| **Request timeout (ms)**        | Leave empty → `8000`.                                                                                                                               |

5. Save. The connector page shows the **Callback URI** this instance expects — that is the value
   you must have registered in VK ID in step 4. If they differ, VK ID rejects the request.

There is deliberately **no `clientSecret` field**: VK ID's token exchange has no `client_secret`
parameter. There is also no redirect-URI field: Logto always passes the callback URI it generated
for the connector, and the connector persists that exact string for the token exchange.

If you want e-mail and/or phone in the Logto profile, all three of the following must be true, in
this order:

1. the scope is enabled in the VK ID cabinet (step 5);
2. the connector's **Scope** field contains the scope, e.g. `vkid.personal_info email phone`;
3. the matching sync switch (**Sync e-mail** / **Sync phone number**) is on.

Missing any one of them means the field is silently absent from the profile — that is by design.

## Part 3: Enable the connector in the sign-in experience

1. Admin Console → **Sign-in experience** → **Social sign-in**.
2. Add the VK ID connector and save.
3. Make sure the sign-in page shows a working VK ID button before you restrict the experience
   further.

On a social-only installation (registration and sign-in with e-mail/password disabled), social
connectors are the only way in. Keep at least one other working provider (for example Yandex ID) and
at least one administrator account with a working sign-in method, or you can lock yourself out.

## The redirect URI and the port limitation

VK ID's documented rule: for local testing deploy on `http://localhost:80`, register the base
domain `localhost` (no port) and the trusted redirect URL `http://localhost`; `443` with HTTPS
(`https://localhost`) is also documented. **Other ports are not supported** — VK states this
explicitly for the testing case. Whether a non-standard port is accepted for a _public_ host is
**UNVERIFIED**; VK's documentation gives no example of one, so assume 80 or 443 only.

Consequences for Logto:

- A default Logto development instance (`http://localhost:3001` endpoint, `:3002` admin) **cannot**
  be a VK ID redirect target. Everything about a real VK login therefore has to run on a host on
  port 443 (or 80).
- The safe options are:
  1. **Public HTTPS host on 443** — the production path: `https://auth.example.com`, Caddy terminating
     TLS, Logto behind it.
  2. **Local HTTPS on 443** — for a local end-to-end test, serve Logto through a local reverse proxy
     on `https://localhost:443` with a certificate your browser trusts, and register
     `https://localhost` as base domain and `https://localhost/callback/<connector-id>` as the
     trusted redirect URL. Whether VK ID accepts a callback path on `https://localhost` (as opposed
     to its bare root) is **UNVERIFIED** — expect to fall back to option 1 if it does not.
  3. **Port 80** — `http://localhost` is documented by VK for tests, but plain HTTP means no TLS;
     use it only on a throwaway environment.
- Tunnels that map a public `https://` host on 443 to your dev server work only if the _registered_
  host is the tunnel host (the base domain must equal the redirect URI host). A tunnel hostname
  changes on every start unless you have a stable one, so treat tunnels as a debugging tool, not as
  a deployment option.

Check that the callback path is actually served by your reverse proxy (a proxy 404 means the path is
not routed; a Logto error response — the endpoint is not meant to be opened directly — means the
path is routed):

```bash
# bash / WSL
curl -sS -o /dev/null -w '%{http_code}\n' https://auth.example.com/callback/<connector-id>
```

```powershell
# Windows PowerShell — use curl.exe, "curl" alone is an alias for Invoke-WebRequest
curl.exe -sS -o NUL -w "%{http_code}`n" https://auth.example.com/callback/<connector-id>
```

Do not assert a specific status code: the correct answer is "a response produced by Logto", not a
404 page from Caddy.

## Scopes: what VK ID returns and under which conditions

| Scope                | Default           | Gating                                                                                                 | Fields in the Logto profile                                                                                                                                                                   |
| -------------------- | ----------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vkid.personal_info` | always on (basic) | none                                                                                                   | `id` (stable VK user id), `name` (`first_name` + `last_name`, plus `patronymic` if VK returns it — not part of VK's documented example, so **UNVERIFIED**), `avatar` (absolute http(s) only). |
| `email`              | off               | dashboard toggle **and** requested in `scope` **and** `syncEmail` on                                   | `email`, lower-cased and validated. The connector does not claim the e-mail is verified, and Logto's account linking acts on the address itself.                                              |
| `phone`              | off               | verified business profile **and** dashboard toggle **and** requested in `scope` **and** `syncPhone` on | `phone`, normalised to E.164 (`79991234567` → `+79991234567`); an unparsable value is dropped.                                                                                                |

Notes:

- The connector never forwards VK's `sex`, `birthday` or `verified` fields to Logto.
- VK's `verified` flag (the grey check mark) describes the account's personal data, not ownership of
  an e-mail address; it is not a substitute for verified-identifier account linking.
- There is no `offline_access` scope in VK ID: refresh tokens are issued regardless. This connector
  does not use them (see the limitations in the [README](../README.md#limitations-and-known-issues)).
- Extended scopes such as `friends`, `video` or `photos` exist but are granted case by case by VK
  support, not self-service. They are irrelevant here: Logto's social profile needs name, avatar,
  and optionally e-mail and phone.

## Manual verification checklist

**Status: MANUAL. This checklist has not been executed by the project.** It needs a registered VK ID
application, a working port-443 deployment and a real VK account. The repository's unit tests
(`npm test`) and the mock VK ID service (see [LOCAL-TESTING.md](LOCAL-TESTING.md)) exercise the
connector without VK ID; this checklist is the part that only a real VK account can prove. Run it
once in a staging environment before you rely on VK ID in production.

Prerequisites: the connector loaded and configured, the trusted redirect URL registered, the button
visible on the sign-in page, a browser you can clear cookies in.

1. **Start a login.** Open `https://auth.example.com` in a private window and click **VK ID**.
   _Expected:_ the browser leaves Logto and lands on a VK page asking for consent to the
   application's permissions.
2. **Inspect the authorization request** (optional but useful). In the browser's network log, check
   the `https://id.vk.ru/authorize` request:
   - `response_type=code`, `code_challenge_method=S256`, a `code_challenge`, your numeric
     `client_id`, the exact registered `redirect_uri`, a `state`, and `scope=vkid.personal_info`
     (plus scopes you added);
   - **no** `client_secret` and no `device_id`.
     If VK ID shows an error instead of a consent page, the redirect URI or the scope is wrong.
3. **Give consent.** Continue in the VK form.
   _Expected:_ the browser returns to
   `https://auth.example.com/callback/<connector-id>?code=…&state=…&device_id=…` and Logto completes
   the sign-in.
4. **Check the new Logto user.** Admin Console → **User management** (or **Manage** → **Users**).
   _Expected:_ a user with the VK display name and avatar, and a social identity under target
   **vk** whose id is the VK user id (a string of digits).
5. **Check repeated sign-in.** Sign out, clear cookies, sign in with the same VK account again.
   _Expected:_ the same Logto user is used; no duplicate user is created.
6. **Check the optional identifiers.** If — and only if — you enabled `email`/`phone` in all three
   places, the user's e-mail/phone is filled in. Otherwise both are empty, which is correct
   behaviour, not a bug.
7. **Check a second account.** Sign in with a different VK account.
   _Expected:_ a separate Logto user, with the second VK identity.
8. **Check the logs.** In the Logto container log, find the request lines for the login.
   _Expected:_ no access token, refresh token, `id_token`, authorization code or PKCE verifier
   appears anywhere.
9. **Check the failure path.** Revoke the application's access in a VK account (or use an account
   that VK blocks) and try again.
   _Expected:_ a clean Logto error, not a stack trace, and VK's `access_denied` semantics preserved
   ("user is blocked or deleted") — see
   [TROUBLESHOOTING.md](TROUBLESHOOTING.md#401-connectorauthorization_failed-after-choosing-vk-id).
10. **Clean up.** Remove test users and, if the environment is shared, unregister the test redirect
    URL.

Record the result somewhere durable (date, environment, VK application id, scopes, outcome). This
checklist intentionally does not claim any result.

## Confidential applications

Only if the VK application is marked _Конфиденциальное_:

1. Copy **`Сервисный ключ доступа`** from the cabinet into the connector's **Service token** field.
2. Register the **static, public egress IP address** of the host that runs Logto in the application
   settings. The exchange is sent **from the Logto container**, i.e. from the server, not from the
   user's browser — if your container egresses through NAT/proxy, register the egress IP, not your
   LAN address.
3. Restart nothing if the config is only changed in the Admin Console — the config is read from the
   database per request. Do restart if you changed the environment/routing.
4. Rate limit becomes 120 000 requests/day per application instead of 15 000/day per IP.

If the connector is used with a confidential application and the request arrives from an
unregistered IP, VK ID rejects the token exchange; Logto reports a failure at the callback step.

## Revoking and rotating credentials

"Rotate" means: make the old credentials unusable and put the new ones in place without a sign-in
outage. Suggested order — new app first, old app removed last.

1. **Create a new VK ID application** (or a new service token for the existing one), following
   Part 1 with the same base domain and the same trusted redirect URL.
2. **Update the connector** in the Admin Console with the new `Client ID` / `Service token`. Save.
3. **Test** with the [manual checklist](#manual-verification-checklist).
4. **Remove the old application** in the VK cabinet (or its trusted redirect URL / service token).
   From that moment the old client id cannot complete a login. VK's cabinet wording for
   deleting/rotating an application is **UNVERIFIED**; look in the application's settings.
5. **Remove the connector** in Logto only when you want to stop VK sign-in entirely: Admin Console →
   Connectors → VK ID → delete. This removes the configuration. Whether it also deletes already
   stored social identities and tokens is **UNVERIFIED** — assume it does not, and clean up users
   and their identities deliberately. Stored access tokens also remain valid at VK ID until they
   expire (1 hour): deleting the connector does not call VK's logout/revocation endpoint.

Emergency stop (VK path is abused or misconfigured):

- Disable the connector in **Sign-in experience → Social sign-in** (fast, no data loss), or
- delete the connector instance (config is gone; re-adding requires the values again), or
- in the VK cabinet, change the trusted redirect URL so every authorization is rejected at VK
  (this is VK-side and independent of Logto).

Also keep in mind that Logto's own session for a signed-in user is not affected by any of the above;
to end sessions, use your Logto version's session revocation capability (check the Management API
and the Admin Console for your release) or your normal user administration.

## What is verified and what is not

Verified from primary VK sources (see [VK-ID-PROTOCOL.md](research/VK-ID-PROTOCOL.md) for quotes):
endpoints and request/response shapes, the exact-match redirect URI rule, the port 80/443
constraint, scope gating, code lifetime (10 minutes), access-token lifetime (1 hour), refresh-token
lifetime (180 days, single-use rotation), and the absence of `client_secret` from the server-side
token exchange.

Not verified by this project (do not treat as guaranteed):

- the exact **cabinet UI wording** for creating an application and enabling scopes — VK's cabinet
  changes; the field names quoted here (Базовый домен, Доверенный redirect URL, Доступы,
  Расширенные доступы, `ID приложения`, `Сервисный ключ доступа`, `Защищённый ключ`, Мои приложения)
  come from VK's documentation;
- whether VK enforces the documented **32-character minimum for `state`** (Logto generates the
  value; VK also echoes it and Logto verifies it, so this cannot be fixed inside the connector);
- whether VK accepts a **callback path** on `https://localhost` and how it treats a
  **trailing-slash** difference in the redirect URI;
- the exact form of the **error contract** when the user refuses consent in the redirect flow;
- whether any specific **HTTP status/error code** is returned by the token endpoint for a given
  failure — VK standardises only `404 NOT FOUND` for a malformed token request;
- the behaviour of **other Logto versions** than 1.46.0.

## Further reading

- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) — symptom → cause → fix.
- [INSTALL-LOGTO-DOCKER.md](INSTALL-LOGTO-DOCKER.md) — installing the connector into the Logto
  container.
- [../README.md](../README.md) — configuration reference, account linking, limitations.
- [../README.ru.md](../README.ru.md) — то же на русском.
