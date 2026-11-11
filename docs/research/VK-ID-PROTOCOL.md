# VK ID OAuth 2.1 — Verified Protocol Reference

**Purpose:** primary-source ground truth for building `ozvix-logto-connector-vkid` (Logto OSS social connector, server-side authorization code + PKCE).
**Research date:** 2026-11-10. **Docs version read:** `latest/vk-id` (VK ID authorization server 2.1).
**Rule applied:** every claim is either CONFIRMED (direct quote + URL), INFERRED (reasoned from confirmed evidence, marked as such), or UNCONFIRMED (could not establish). Nothing below was obtained by calling VK ID APIs — no authorization attempts, no secrets.

## Confidence legend

| Tag             | Meaning                                                                              |
| --------------- | ------------------------------------------------------------------------------------ |
| **CONFIRMED**   | Verbatim quote from an official VK source (docs page or VKCOM SDK source), URL given |
| **INFERRED**    | Follows logically from CONFIRMED facts, but the exact behaviour is not stated        |
| **UNCONFIRMED** | Not established; do not build a hard requirement on it                               |

## Source inventory

| #   | Source                                                                                                    | URL                                                                                                                                         |
| --- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | API reference (authorize, token, errors, limits)                                                          | https://id.vk.ru/about/business/go/docs/ru/vkid/latest/vk-id/connection/api-description                                                     |
| S2  | Web auth flow (4 schemes, PKCE generation side)                                                           | https://id.vk.ru/about/business/go/docs/ru/vkid/latest/vk-id/connection/start-integration/how-auth-works/auth-flow-web                      |
| S3  | **No-SDK web integration — full end-to-end with payload + `user_info` JSON**                              | https://id.vk.ru/about/business/go/docs/ru/vkid/latest/vk-id/connection/start-integration/auth-without-sdk/auth-without-sdk-web             |
| S4  | No-SDK iOS — token request variants, **state marked optional at token time**, Bearer auth for `user_info` | https://id.vk.ru/about/business/go/docs/ru/vkid/latest/vk-id/connection/start-integration/auth-without-sdk/auth-without-sdk-ios             |
| S5  | No-SDK Android — `user_info` with `device_id`, `type=code_v2`                                             | https://id.vk.ru/about/business/go/docs/ru/vkid/latest/vk-id/connection/start-integration/auth-without-sdk/auth-without-sdk-android         |
| S6  | App creation, confidential vs public, redirect URI rules, localhost rules, keys                           | https://id.vk.ru/about/business/go/docs/ru/vkid/latest/vk-id/connection/create-application                                                  |
| S7  | Access token (lifetime, verification checkmark)                                                           | https://id.vk.ru/about/business/go/docs/ru/vkid/latest/vk-id/connection/tokens/access-token                                                 |
| S8  | Refresh token (lifetime, single-use rotation)                                                             | https://id.vk.ru/about/business/go/docs/ru/vkid/latest/vk-id/connection/tokens/refresh-token                                                |
| S9  | ID token (JWT, claims, public key for validation)                                                         | https://id.vk.ru/about/business/go/docs/ru/vkid/latest/vk-id/connection/tokens/id-token                                                     |
| S10 | Scopes / data access                                                                                      | https://id.vk.ru/about/business/go/docs/ru/vkid/latest/vk-id/connection/work-with-user-info/scopes                                          |
| S11 | `user_info` / `public_info` overview                                                                      | https://id.vk.ru/about/business/go/docs/ru/vkid/latest/vk-id/connection/work-with-user-info/user-info                                       |
| S12 | Service token semantics                                                                                   | https://id.vk.ru/about/business/go/docs/ru/vkid/latest/vk-id/connection/tokens/service-token                                                |
| S13 | Migration off `dev.vk.com` Standalone apps                                                                | https://id.vk.ru/about/business/go/docs/ru/vkid/latest/vk-id/connection/migration-from-dev-vk-com                                           |
| S14 | FAQ: legacy VK OAuth is deprecated                                                                        | https://id.vk.ru/about/faq/business/vkid/OAuth/30024                                                                                        |
| S15 | FAQ: how to get/handle data                                                                               | https://id.vk.ru/about/faq/business/vkid/authorization/30011                                                                                |
| S16 | SDK source: `src/auth/auth.ts`                                                                            | https://github.com/VKCOM/vkid-web-sdk/blob/master/src/auth/auth.ts                                                                          |
| S17 | SDK source: `src/auth/types.ts` (request/response types)                                                  | https://github.com/VKCOM/vkid-web-sdk/blob/master/src/auth/types.ts                                                                         |
| S18 | SDK source: `src/constants.ts` + `src/utils/url/url.ts` (host + query building)                           | https://github.com/VKCOM/vkid-web-sdk/blob/master/src/constants.ts · https://github.com/VKCOM/vkid-web-sdk/blob/master/src/utils/url/url.ts |
| S19 | SDK README (OAuth 2.1 statement, `scope: 'phone email'` usage)                                            | https://github.com/VKCOM/vkid-web-sdk/blob/master/README.md                                                                                 |
| S20 | `robots.txt` (confirms `/authorize*` path and `payload` clean-param)                                      | https://id.vk.ru/robots.txt                                                                                                                 |

Provenance note: `raw.githubusercontent.com` is blocked from this environment (non-public IP), so SDK files were read through the GitHub REST contents API (`api.github.com/repos/VKCOM/vkid-web-sdk/contents/...`), which returns the identical bytes. Quotes below are from that content.

---

## 1. Hosts and endpoints

### 1.1 Canonical API host is `id.vk.ru`

**CONFIRMED.** Every API example across S1–S5 uses `id.vk.ru`:

> `GET https://id.vk.ru/authorize?response_type=code ...` > `POST https://id.vk.ru/oauth2/auth` > `curl "https://id.vk.ru/oauth2/user_info?client_id=7915193" ...`
> — S1, S3, S5

**CONFIRMED (from SDK source).** The SDK hardcodes the domain as `vk.ru` and derives every host from it:

```ts
export const DOMAIN = 'vk.ru';
export const LOGIN_DOMAIN = `login.${DOMAIN}`;
export const OAUTH_DOMAIN = `oauth.${DOMAIN}`;
export const VKID_DOMAIN = `id.${DOMAIN}`;
```

— S18 (`src/constants.ts`). `getVKIDUrl()` returns `` `https://${config.__vkidDomain}/${module}?${queryParamsString}` `` → `https://id.vk.ru/authorize`, `https://id.vk.ru/oauth2/auth`, etc.

### 1.2 `id.vk.com` is _not_ an API host

**CONFIRMED (observed 2026-11-10).** Requesting `https://id.vk.com/about/business/go/docs/ru/vkid/latest/vk-id/connection/api-description` returns an HTTP **cross-origin redirect to `https://id.vk.ru/...`** (the fetch had to be retried against `id.vk.ru`). `id.vk.com` appears only as a _cabinet/documentation_ link in some pages (e.g. S11 links to `https://id.vk.com/about/business/go/`), i.e. a legacy alias. **Conclusion: hardcode `https://id.vk.ru`.** `id.vk.me` is not referenced anywhere in current docs or the SDK — **UNCONFIRMED / treat as nonexistent**.

### 1.3 Complete endpoint table

| Purpose                                | Method + URL                                                                            | Status                                                             |
| -------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Authorize (consent page, returns code) | `GET https://id.vk.ru/authorize`                                                        | CONFIRMED S1                                                       |
| Token exchange / refresh               | `POST https://id.vk.ru/oauth2/auth`                                                     | CONFIRMED S1 — "Формат запроса (только POST)"                      |
| User data (unmasked)                   | `POST https://id.vk.ru/oauth2/user_info`                                                | CONFIRMED S3/S5/S4 (all examples use POST via `curl -d`/JSON body) |
| User data (masked, from `id_token`)    | `POST https://id.vk.ru/oauth2/public_info`                                              | CONFIRMED S3                                                       |
| Logout / revoke                        | `POST https://id.vk.ru/oauth2/logout`                                                   | CONFIRMED S3                                                       |
| Revoke permissions                     | documented in S1 ("Отзыв разрешений доступов") but section unreachable (page truncated) | UNCONFIRMED                                                        |

`/authorize` is a browser-facing redirect endpoint; docs only ever show `GET`. Whether `POST` is accepted — **UNCONFIRMED (assume GET only)**.

---

## 2. Authorize request (Q1)

### 2.1 Exact shape

**CONFIRMED**, S1:

```
GET https://id.vk.ru/authorize?response_type=code
& client_id=<идентификатор приложения>
& redirect_uri=<адрес перенаправления>
& state=<произвольная строка состояния>
& code_challenge=<преобразованный code_verifier>
& code_challenge_method=<метод преобразования>
& [scope=<список доступов>]
& [prompt=<процесс прохождения авторизации>]
& [provider=<провайдер аутентификации>]
& [lang_id=<язык интерфейса>]
& [scheme=<тема формы запроса разрешений>]
```

### 2.2 Required vs optional parameters

**CONFIRMED** — S1 lists exactly six under "Обязательные параметры запроса": `response_type`, `client_id`, `code_challenge`, `code_challenge_method`, `redirect_uri`, `state`.

| Param                   | Required | Notes / quote                                                                                                          |
| ----------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `response_type`         | **yes**  | "При запросе кода подтверждения следует указать значение code" (S1)                                                    |
| `client_id`             | **yes**  | VK ID app id (numeric in all examples, e.g. `7915193`)                                                                 |
| `code_challenge`        | **yes**  | "BASE64URL-ENCODE(SHA256(ASCII(codeVerifier)))" (S1)                                                                   |
| `code_challenge_method` | **yes**  | "Принимает значение S256" (S1). SDK sends lowercase `'s256'` (S16) — both evidently accepted; use `S256` per docs      |
| `redirect_uri`          | **yes**  | must be the registered trusted redirect URL (see §8)                                                                   |
| `state`                 | **yes**  | "длиной не менее 32 символа" (S1) — see risk note below                                                                |
| `scope`                 | no       | space-separated; default `vkid.personal_info` (S1, S10)                                                                |
| `prompt`                | no       | `''`, `none`, `login`, `consent`; multiple allowed except `none` (S1)                                                  |
| `provider`              | no       | `vkid` (default), `ok_ru`, `mail_ru` (S1)                                                                              |
| `lang_id`               | no       | `RUS=0, UKR=1, ENG=3, SPA=4, GERMAN=6, POL=15, FRA=16, UZB=65, TURKEY=82, KAZ=97, BEL=114` (S1 + S17 `Languages` enum) |
| `scheme`                | no       | web: `light` \| `dark` (S1); Android page documents `bright_light` \| `space_gray` (S5) — platform-specific            |

### 2.3 PKCE is mandatory

**CONFIRMED.** `code_challenge` and `code_challenge_method` are in the required list (S1); "При интеграции авторизации используйте PKCE" (S1); "Параметр обязателен для обмена кода на токен" for `code_verifier` (S1). Also: "Запрещено использовать code_verifier и code_challenge в одном запросе" (S1).

### 2.4 `state` is mandatory at authorize time, and VK enforces exact round-trip

**CONFIRMED**, S1: "Строка должна возвращаться сервису без изменений. Затем сервису нужно сравнить полученный state с сохраненным: значения должны полностью совпадать, иначе ответ можно считать подменённым."

> **Confirmed and fixed in this image.** VK's API reference requires `state` of **≥ 32 characters**
> (S1), and the official VK SDK enforces the same minimum client-side (`VkAuthorizeUtil.kMinStateLength
= 32` in the `vk_id` Dart package, and the web SDK never sends a shorter value). Logto Experience
> 1.46.0 generates `se_` + base64url(8 bytes) = **14** characters, which is below the requirement.
> The connector cannot lengthen it itself (VK echoes it and the Experience compares it with the value
> it stored), so the derived image patches the pinned Experience bundle to 32 random bytes — a
> 46-character `state` — and the Docker build fails if the pinned pattern changes. See
> `docker/patch-experience-state.mjs` and `CHANGELOG.md`.

### 2.5 Extra parameters the official SDK adds (undocumented)

**CONFIRMED from source**, S16/S18. The SDK sends, in addition to the six required params:

```ts
const queryParams: AuthQueryParams = {
  lang_id,
  scheme,
  code_challenge,
  code_challenge_method: 's256',
  client_id: app,
  response_type: 'code',
  scope,
  state,
  provider,
  prompt,
  stats_info,
};
if (config.mode !== ConfigAuthMode.Redirect)
  queryParams.origin = location.protocol + '//' + location.hostname;
// then getVKIDUrl() appends: v=<sdk version>, sdk_type='vkid', app_id=<app>, redirect_uri, debug?, localhost?
```

`AuthQueryParams` (S17) also declares `uuid`, `screen`, `oauth_version`. So the endpoint tolerates unknown extra params. **These are not needed for a server-side connector** — do not send them.

**Note (important):** `device_id` is **not** an authorize parameter. It is _produced_ by the authorize step (see §3).

---

## 3. Callback (Q2) — **the critical section**

### 3.1 Success response: only three query params, and `redirect_uri` is NOT one of them

**CONFIRMED**, S1 (verbatim):

> "Если запрос выполнен успешно, код подтверждения code, строка состояния state и идентификатор устройства device_id возвращаются в URL перенаправления в виде query-параметров. Время жизни кода подтверждения — 10 минут."

> `GET https://<redirect_uri>?code=<код подтверждения>&device_id=<идентификатор устройства>&state=<произвольная строка состояния>`

Response parameter table (S1):

| Param       | Meaning                                                                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `code`      | authorization code, **lifetime 10 minutes**                                                                                                        |
| `state`     | must equal the authorize `state`                                                                                                                   |
| `device_id` | "Клиент должен сохранить этот идентификатор и передавать его в последующих запросах на авторизационный сервер, например для обмена кода на токены" |

**CONFIRMED in 3 more independent docs:**

- S3 (web, no SDK): "После успешного входа в VK ID произойдет редирект на адрес, указанный в redirect_uri. Данные авторизации пользователя вы найдете в url в параметре payload" with payload `{"code","state","type":"code_v2","device_id"}`.
- S2 (flow diagram, all four schemes): "VK ID выполняет редирект по указанному адресу с параметрами code, state и device_id."
- S4 (iOS): "После авторизации в браузере или в приложении провайдера вы получите URL со следующими параметрами: device*id, state, code, type" — example: `vk7915193://vk.ru/blank.html?device_id=...&state=abracadabra&code=vk2.a.FmLgF*...&type=code_v2`.
- S5 (Android): "ваш сервис получит URI с query-параметрами code, state, device_id".
- S15 (FAQ): "код подтверждения code, строка состояния state и идентификатор устройства device_id возвращаются в URL перенаправления."

### 3.2 ⚠️ VERDICT: `redirect_uri` is never echoed in the callback

**CONFIRMED (negative evidence, 6 sources).** No VK ID document anywhere lists `redirect_uri` (or `redirectUri`) among callback parameters — the callback contract is consistently `code`, `state`, `device_id` (+ optional `type=code_v2`). Only on the _request_ side does `redirect_uri` appear (authorize **and** token exchange).

Consequence for the upstream connector under audit: its callback guard is

```ts
export const authResponseGuard = z.object({
  code: z.string(),
  device_id: z.string(),
  redirectUri: z.string(),
});
```

(the upstream package`s recovered `src/types.ts`, see NOTICE) — it requires a **camelCase `redirectUri`** that VK ID never sends, and does not even accept the documented `state`. Every real callback would fail validation. **This is a definite, blocking bug**; the connector must reconstruct `redirect_uri` from its own configuration, never from the callback.

### 3.3 `type` parameter

**CONFIRMED**, S4/S5: the callback may include `type=code_v2` ("Тип кода авторизации. В нашем случае code*v2"). Authorization codes are opaque strings shaped like `vk2.a.FmLgF*...`(S4). Treat`type` as optional/ignorable.

### 3.4 Two delivery shapes to tolerate

| Shape                                                                   | When                                                       | Evidence                                                                                                                             |
| ----------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Plain query params: `?code=&state=&device_id=`                          | direct redirect (what a connector uses)                    | CONFIRMED S1, S2, S4, S5                                                                                                             |
| Single `payload` param containing JSON `{code, state, type, device_id}` | SDK "redirect with payload" mode (`responseMode=Redirect`) | CONFIRMED S3 + SDK `getRedirectWithPayloadUrl()` (S16) appends `payload`-style keys; `robots.txt` lists `Clean-param: payload` (S20) |

A robust connector reads `code`/`state`/`device_id` from the top level and should not crash if only `payload` is present (SDK mode is not used by a server-side connector, so this is defensive only).

### 3.5 Error behaviour (Q8)

**CONFIRMED**, S1 — error payload shape is:

```json
{ "error": "<code>", "error_description": "<описание ошибки>" }
```

> "Если запрос выполнен с ошибкой ... **пользователь увидит страницу с ошибкой**." (S1)

Error codes enumerated by S1: `invalid_request`, `unsupported_response_type`, `invalid_scope`, `server_error`, `temporarily_unavailable`, `invalid_token`, `access_denied`, `login_required`, `interaction_required`.

Semantics worth noting (S1):

- `access_denied` = "у пользователя нет доступа к VK ID: пользователь заблокирован или удален" — **it is NOT "user clicked Cancel"**.
- `login_required` / `interaction_required` only occur with `prompt=none`.

**UNCONFIRMED:** whether the error document is ever _redirected_ to `redirect_uri` as `?error=...&state=...` in the no-SDK redirect flow (the docs say the user sees a VK error page, and the SDK receives errors via `postMessage`, not via redirect). Also UNCONFIRMED: a dedicated "user denied consent / cancelled" code. The SDK's `AuthError` type (`error_uri?: string`, `state?: string`) hints a full OAuth-style error object exists (S17), but the redirect-flow error contract is not documented.

**Connector consequence:** treat "callback without `code`" as a generic auth failure; do **not** rely on `error`/`error_description` being present, and do not assume `state` accompanies errors.

---

## 4. Token endpoint (Q3, Q10)

### 4.1 Exact request

**CONFIRMED**, S1:

```
POST https://id.vk.ru/oauth2/auth
Content-Type: application/x-www-form-urlencoded

grant_type = authorization_code
& code_verifier=<параметр для защиты передаваемых данных>
& redirect_uri=<адрес перенаправления>
& code=<код подтверждения authorization_code>
& client_id=<идентификатор приложения>
& device_id=<идентификатор устройства>
& state=<произвольная строка состояния>
```

> "Формат запроса (только POST)" (S1). "Убедитесь, что ваш сервис корректно передаёт параметры grant_type и response_type. Если передать параметры некорректно, в ответ вернется ошибка **404 NOT FOUND**." (S1)

Required parameters per S1's table: `grant_type`, `code_verifier`, `redirect_uri`, `code`, `client_id`, `device_id`, `state`, plus `service_token` **only for confidential apps**.

Transport flexibility (CONFIRMED, S4): the iOS no-SDK page puts **everything except `code` in the query string** and `code` in the JSON body:

```bash
curl --location 'https://id.vk.ru/oauth2/auth?grant_type=authorization_code&redirect_uri=...&client_id=7915193&device_id=...&state=...&code_verifier=...' \
  --data '{ "code": "vk2.a.02-Bsy..." }'
```

and the Android page puts everything in a form body (`curl ... -d "client_id=...&grant_type=authorization_code&code_verifier=...&device_id=1111&code=...&redirect_uri=..."`) (S5). So VK accepts params in query **and/or** body. **Recommended for the connector: one `application/x-www-form-urlencoded` POST body containing all params** (S1's canonical form) — simplest and matches the documented Web behaviour.

### 4.2 Is `client_secret` required or even supported? — **No. This is a key finding.**

**CONFIRMED by absence + by definition:**

1. The token-endpoint parameter tables in S1 contain **no `client_secret`** row at all. For confidential apps the secret-bearing parameter is named **`service_token`**:
   > "(Для конфиденциальных приложений) **service_token** | Сервисный ключ доступа из настроек приложения. Обязателен для конфиденциальных приложений. Передается как POST-параметр" — S1
2. `client_secret` is defined elsewhere as an **SDK/client-library** setting, not an OAuth request parameter:
   > "**Защищённый ключ** — используется для настройки библиотек на клиентах в качестве параметра **client_secret**" — S6
3. There are therefore **three distinct app credentials** (S6): `ID приложения` (= `client_id`), `Защищённый ключ` (= `client_secret`, client-side libraries only), `Сервисный ключ доступа` (= `service_token`, backend/confidential exchange and VK API back-2-back calls).
4. Service token usage is restricted to confidential/back-end contexts:
   > "Сервисный токен можно использовать только для конфиденциального приложения, то есть при использовании запросов с бэкенда приложения. Не передавайте и не храните сервисный токен при использовании публичных приложений" — S12
5. Confidential apps additionally authenticate by **IP allow-list**, not by a shared secret in the request:
   > "при авторизации пользователя VK ID будет проверять, с какого IP-адреса пришёл запрос на обмен кода авторизации на токены ... если запрос пришел с другого IP-адреса, запрос на обмен кода авторизации на токены будет отклонен" — S6

**Verdict:** `client_secret` is **never** part of VK ID's server-side token exchange. A confidential app sends `service_token` **and** must call from an allow-listed IP. Whether VK ID _silently ignores_ a stray `client_secret` parameter is **UNCONFIRMED** (untested, and we must not test auth against VK).

**Consequence:** the upstream connector's `vkConfigGuard` requires `clientSecret: z.string()` yet `getAccessToken()` never sends it (recovered upstream `src/index.ts`, code exchange section) — a **required-but-unused config field**. It also cannot express the confidential-app case (`service_token`). Config should be: `clientId` (required), `serviceToken` (optional; required only if the VK app is confidential), `scope` (optional), `redirectUri` if not derivable.

### 4.3 Must `state` be re-sent, and must it equal the authorize state?

This is **contradictory in VK's own docs** — report both:

| Source                              | Statement                                                                                                                                                         |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| S1 "Обязательные параметры запроса" | `state` listed as **required**; "Строка состояния ... Генерируется сервисом и передается в начале авторизации. Строка должна возвращаться сервису без изменений." |
| S4 (iOS no-SDK) parameter table     | "`state`                                                                                                                                                          | Произвольная строка. **Опциональный параметр**" |
| S16 (official SDK)                  | always sends `state` = the SDK's **stored authorize state**, and then verifies `res.state` against it (`checkState`)                                              |

**CONFIRMED:** the official SDK re-sends the _original_ authorize `state` and verifies the `state` echoed in the token response.
**CONFIRMED:** token response contains `state` and S1 says it "Должна совпадать с той, которая передана в начале авторизации."

**Recommendation (INFERRED):** persist the authorize `state`, re-send it at token time, and treat a mismatch in the response as fatal. This satisfies the strict reading of S1 and matches the SDK. Note the upstream connector instead generates a **fresh random** state at token time and discards the response `state` (recovered upstream `src/index.ts`, token request section) — undocumented behaviour that discards a documented integrity check.

### 4.4 Success response schema

**CONFIRMED**, S1 + S7:

```json
{
  "access_token": "****",
  "refresh_token": "****",
  "token_type": "Bearer",
  "expires_in": 3600,
  "user_id": 1234567890,
  "id_token": "****",
  "state": "...",
  "scope": "vkid.personal_info email phone"
}
```

| Field           | Type         | Presence                                                                                           |
| --------------- | ------------ | -------------------------------------------------------------------------------------------------- |
| `access_token`  | string       | always (S1, S7)                                                                                    |
| `refresh_token` | string       | **always on code exchange** — no `offline_access` scope exists or is needed (S1, S7, S10)          |
| `id_token`      | string (JWT) | **always on code exchange** (S1, S9); **absent in refresh responses** (S4 step 4 example omits it) |
| `token_type`    | string       | "Всегда принимает значение bearer" (S7)                                                            |
| `expires_in`    | number       | seconds; **3600** in examples (S7, S4)                                                             |
| `user_id`       | **number**   | numeric in token response (S7: `1234567890` unquoted) — note this differs from `user_info` (§5)    |
| `state`         | string       | echoed; may be `""` on refresh (S4)                                                                |
| `scope`         | string       | space-separated granted scopes, e.g. `"vkid.personal_info email phone"` (S4)                       |

**Lifetimes (CONFIRMED):** access token **1 hour** — "Срок жизни Acсess token ограничен и составляет 1 час" (S7), `expires_in: 3600` (S7/S4). Refresh token **180 days** — "Срок жизни Refresh token — 180 дней" (S8).

**Refresh-token rotation (CONFIRMED, S8):** "При обновлении токенов старые токены перестают действовать — обменять токены можно только один раз. Если вы попробуете использовать старый Refresh token снова, то VK ID сделает недействительными все токены из этой сессии." → store the new refresh token atomically; a retry after a lost response logs the user out.

Refresh request (CONFIRMED S3): `POST https://id.vk.ru/oauth2/auth` with `grant_type=refresh_token`, `refresh_token`, `client_id`, `device_id`, `state` (state optional in practice), plus `service_token` for confidential apps (S6).

---

## 5. `user_info` endpoint (Q4)

### 5.1 Request

**CONFIRMED**, S3 (web, canonical for a server-side connector):

```bash
curl "https://id.vk.ru/oauth2/user_info" -d "access_token=****"
```

"Параметры запроса: `access_token` — access_token, полученный на четвертом шаге; `client_id` — Идентификатор приложения" (S3).

**CONFIRMED**, S4 (iOS) — an alternative, header-based form is documented:

```bash
curl --location 'https://id.vk.ru/oauth2/user_info' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer ****' \
  --data '{ "client_id":"7915193" }'
```

**CONFIRMED**, S5 (Android) — `device_id` is also accepted: `https://id.vk.ru/oauth2/user_info?client_id=7915193` with body `device_id=1111&access_token=XXX` (docs contain a typo `acces_stoken`).

**CONFIRMED**, S16 — the official SDK does exactly:

```ts
fetch(
  `https://${config.__vkidDomain}/oauth2/user_info?${querystring.stringify({ client_id: config.app })}`,
  { method: 'POST', body: new URLSearchParams({ access_token: accessToken }) },
);
```

**Summary table:**

| Aspect          | Fact                                                                                                           | Confidence                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| URL             | `https://id.vk.ru/oauth2/user_info`                                                                            | CONFIRMED                                                  |
| Method          | `POST` in every documented example (never GET)                                                                 | CONFIRMED (GET untested → UNCONFIRMED)                     |
| Token transport | **both** are documented: form body `access_token` (S3, S16) **or** `Authorization: Bearer` header (S4)         | CONFIRMED (both)                                           |
| `client_id`     | always present in docs/SDK (query or body); VK's parameter table lists it, but the web `curl` example omits it | Required: **UNCONFIRMED**; send it (harmless, matches SDK) |
| `device_id`     | accepted (S5); SDK does not send it on web                                                                     | optional                                                   |
| Content-Type    | `application/x-www-form-urlencoded` (S3 form body) or `application/json` (S4 JSON body)                        | both documented                                            |

**Recommendation (INFERRED):** send `POST https://id.vk.ru/oauth2/user_info` with `Content-Type: application/x-www-form-urlencoded`, body `access_token=...`, query `client_id=...` — this is the exact shape of the official SDK and of the Web docs, i.e. the best-corroborated path. Do **not** send `Bearer` from a browser context (S1 warns preflight would break it), though it is documented for server/mobile.

### 5.2 Response envelope and every field

**CONFIRMED**, identical in S3, S4, S5:

```json
{
  "user": {
    "user_id": "1234567890",
    "first_name": "Ivan",
    "last_name": "Ivanov",
    "phone": "79991234567",
    "avatar": "https://pp.userapi.com/60tZWMo4SmwcploUVl9XEt8ufnTTvDUmQ6Bj1g/mmv1pcj63C4.png",
    "email": "ivan_i123@vk.ru",
    "sex": 2,
    "verified": false,
    "birthday": "01.01.2000"
  }
}
```

Envelope is `{ "user": { ... } }` — **CONFIRMED**. Field-by-field:

| Field        | Type                        | Notes                                                                                                                                                                                                                                               | Confidence                                                                                                                  |
| ------------ | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `user_id`    | **string**                  | quoted in every `user_info` example (`"1234567890"`), unlike the token endpoint where it is a number. Use as the stable subject id                                                                                                                  | CONFIRMED (type)                                                                                                            |
| `first_name` | string                      | "Ivan"                                                                                                                                                                                                                                              | CONFIRMED                                                                                                                   |
| `last_name`  | string                      | "Ivanov"                                                                                                                                                                                                                                            | CONFIRMED                                                                                                                   |
| `avatar`     | string (absolute HTTPS URL) | `https://pp.userapi.com/...png`; may be absent if no photo                                                                                                                                                                                          | CONFIRMED (URL, not a dict of sizes)                                                                                        |
| `phone`      | string                      | `"79991234567"` — **11 digits, leading `7`, no `+`, no separators** (masked variant in `public_info` shows `"+42872 *** ** 29"`)                                                                                                                    | CONFIRMED (format)                                                                                                          |
| `email`      | string                      | plain address in `user_info` (`ivan_i123@vk.ru`); masked in `public_info` (`iv***@vk.vom`)                                                                                                                                                          | CONFIRMED                                                                                                                   |
| `sex`        | number                      | `2` in example. VK API convention is `1`=female, `2`=male, `0`=unknown                                                                                                                                                                              | value observed CONFIRMED; numeric semantics **INFERRED** (the VK API docs page was unavailable: "Часть функций недоступна") |
| `verified`   | boolean                     | `false` in example. Related official statement: the grey check-mark means the user "указал в аккаунте подлинные личные данные и подтвердил их", and `users.get()` returns `is_verified` accordingly (S7)                                            | field CONFIRMED; exact mapping to `is_verified` **INFERRED**                                                                |
| `birthday`   | string                      | `"01.01.2000"` — **`DD.MM.YYYY`**                                                                                                                                                                                                                   | CONFIRMED (format observed)                                                                                                 |
| others       | —                           | full/masked responses list exactly these 9 keys; the SDK's `UserData` type also declares only `avatar, email, first_name, last_name, phone, user_id` (S17), and `UserInfoResult = { user: Partial<UserData> }` → **every user field can be absent** | CONFIRMED (Partial)                                                                                                         |

Note `sex`/`verified`/`birthday` are **not** in the SDK's `UserData` type (S17) although VK returns them — they are additive.

### 5.3 Which fields you actually get

**CONFIRMED**, S10 + S6 + S11 — two conditions must **both** hold (intersection):

> "По запросу информации о пользователе API VK ID возвращает все данные, права на которые даёт указанный в запросе токен и которые запрошены при настройке приложения (берётся их совпадение)." — S10

1. The scope must be **enabled in the app dashboard** (S6: `Доступы → Расширенные доступы`; `phone` requires a **verified business profile**).
2. The scope must be **requested in the `scope` parameter**.

So: `phone` demands `scope=phone` (and a verified business profile, and it is the "расширенный" access); `email` demands `scope=email`; name/avatar/sex/birthday come from the default `vkid.personal_info`.

**CONFIRMED**, S4: "Начиная с версии VK ID SDK 2.2.0, необходимо явно указывать доступы phone, email, чтобы получать эти данные."

---

## 6. Scopes (Q5)

**CONFIRMED**, S10 — the complete enumerated scope table:

| Scope                | Grants                                                                                                                         | Tier                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| `vkid.personal_info` | "Фамилия, имя, пол, фото профиля, дата рождения. Базовое право доступа, которое по умолчанию используется для всех приложений" | basic (always on)                        |
| `email`              | "Доступ к почте пользователя"                                                                                                  | basic (dashboard toggle, off by default) |
| `phone`              | "Доступ к номеру телефона"                                                                                                     | extended (verified business profile)     |

**CONFIRMED:** "Если он не указан, то берётся минимальное значение прав доступа по умолчанию для приложений — **vkid.personal_info**" (S10, S1). Values are **space-separated**: "Значения в списке разделяются пробелами, например: email phone" (S1). SDK README uses `scope: 'phone email'` (S19).

**CONFIRMED:** "запрошенный список прав для приложения не может быть больше, чем разрешённый список в настройках приложения" (S10) → requesting an un-enabled scope yields `invalid_scope` at authorize (S1).

**Extended scopes exist but are granted by support, not self-service** (S6): `friends`, `video`, `photos`, "список друзей, видеозаписи, фотографии и другие. Они выдаются в исключительных случаях — для их получения напишите на почту devsupport@corp.vk.com". The VK ID scope table itself (S10) only enumerates the three above.

**CONFIRMED negative:** there is **no `offline_access`** scope in VK ID docs — refresh tokens are issued unconditionally (§4.4).

---

## 7. `id_token` (Q6)

**CONFIRMED**, S9:

> "ID token является JWT-токеном." … "Токены создаются сервером VK ID, подписываются секретным ключом и передаются клиенту."

Decoded payload example (S9):

```
payload: { 'iis': 'VK', 'sub': 000000000, 'app': 51812311, 'exp': 1618310760, 'iat': 1709018605, 'jti': 21 }
```

| Claim         | Meaning (S9)                           |
| ------------- | -------------------------------------- |
| `iis`         | "Хост, который выдал этот токен, — VK" |
| `sub`         | "user_id, идентификатор пользователя"  |
| `app`         | "client_id, идентификатор приложения"  |
| `exp` / `iat` | expiry / issued-at                     |
| `jti`         | "Тип токена. Должен иметь значение 21" |

**Validation is documented via a static RSA public key** (S9):

> "Чтобы провалидировать ID token, используйте публичный ключ." — followed by a `-----BEGIN PUBLIC KEY----- MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAvsvJlhFX9Ju/...` block.

**Is VK ID a true OIDC provider?** **UNCONFIRMED — no evidence.** No `/.well-known/openid-configuration`, `iss` claim, `aud`, `azp`, `nonce`, `at_hash`, or JWKS endpoint appears anywhere in S1–S13. Claims use `iis`/`app`/`jti` instead of `iss`/`aud`/`typ`. A static PEM key is published instead of a JWKS URL. Treat VK ID as **OAuth 2.1 + PKCE with a proprietary JWT**, not OIDC.

**Should a server-side connector validate it?** **INFERRED: not required.** The connector obtains `user_info` with the access token over TLS from VK's own endpoint — no trust decision depends on the JWT. Since the signing algorithm isn't documented in the decoded example (header shown is `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9` = `HS256`, while the published key is RSA — an internal inconsistency in VK's docs), validating it would add risk, not safety. Suggested: **do not validate `id_token`**; do not parse it for identity (use `user_info.user_id`). Note `id_token` is absent from refresh responses (S4), so anything that depends on it breaks on refresh anyway.

---

## 8. Redirect URI rules (Q7) — significant constraint for Logto

### 8.1 Must be pre-registered and match exactly

**CONFIRMED**, S6:

> "**Доверенный redirect URL** — URL, куда будет переадресован браузер пользователя после того, как пользователь нажмёт Продолжить как. Домен доверенного redirect URL должен **в точности совпадать** с базовым доменом — поле чувствительно к формату и регистру."

> "В качестве адреса веб-страницы используйте доверенный redirect URL, указанный в настройках приложения." (S1, for both authorize and token exchange)

Additional constraints (S6): base domain count ≤ **102** per app, total length ≤ **512** chars; subdomains can be wildcarded by prefixing a dot (`.domain.com`); "Не указывайте в адресе якоря" (no fragment); a trailing slash is allowed ("Если нужно, используйте в конце адреса слеш"). The `redirect_uri` sent at authorize **and** at token exchange must be identical (S3/S4/S5: "Такой же, как на втором шаге").

So: **exact string match against the registered trusted redirect URL** — no normalization, no wildcards within a path, case-sensitive. Whether a trailing-slash difference is tolerated: **UNCONFIRMED** (docs only say trailing slash is _allowed_ in the registration) — treat `redirect_uri` as a byte-exact constant.

### 8.2 HTTPS and localhost/port rules

**CONFIRMED**, S6 (verbatim):

> "чтобы в процессе интеграции VK ID локально проверить, работает ли авторизация, разверните свой проект на **http://localhost:80**. Обязательно добавьте localhost в список базовых доменов. В этом случае поле Базовый домен заполнится таким образом: localhost (порт указывать не нужно). Доверенный redirect URL пропишите с http и без порта — **http://localhost**"

> "на этапе тестирования также можно использовать **443** порт для схемы https. В этом случае дополнительно пропишите в Доверенный redirect URL **https://localhost**. **Другие порты временно не поддерживаются.**"

**Consequence (INFERRED, high impact):** only **port 80 (http)** and **443 (https)** are supported — for `localhost` explicitly, and there is no statement that arbitrary ports are allowed for public domains either ("Другие порты временно не поддерживаются"). A typical Logto dev instance on `http://localhost:3001` / `:3002` therefore **cannot** be used as a VK ID redirect target. Practical options: front Logto with a public HTTPS domain on 443, or tunnel to `https://localhost` on 443.

HTTPS mandatory in production: **INFERRED yes** (production example is `https://your.site`; localhost/http is framed explicitly as a local-testing exception). No document states "HTTPS is required" verbatim.

Native mobile redirect URIs use custom schemes/universal links (`vk<app_id>://vk.ru/...`, S4/S5) — irrelevant for a web connector.

### 8.3 Query strings in `redirect_uri`

**CONFIRMED (indirect)**, S1: VK's own example uses a redirect URI containing a query string (`redirect_uri=https://your.domain/callback_vk?return_to=...`) while warning to validate the parameters. So query strings are structurally allowed; VK appends its params to them. Logto's connector callback is a plain path, so this is not an issue.

---

## 9. Errors, refusing, and limits (Q8)

### 9.1 Authorization errors

See §3.5. Enumerated codes (S1): `invalid_request`, `unsupported_response_type`, `invalid_scope`, `server_error`, `temporarily_unavailable`, `invalid_token`, `access_denied`, `login_required`, `interaction_required`.

Notable: **no documented `user_cancelled` / consent-denied code**; `access_denied` means the _account_ is blocked/deleted (S1). Silent behaviour on consent refusal is **UNCONFIRMED** (VK likely keeps the user on its page) — a connector should surface "no code received" as the generic failure.

### 9.2 Token-endpoint errors

**UNCONFIRMED in detail.** S1 states only: "Если передать параметры некорректно, в ответ вернется ошибка **404 NOT FOUND**", and lists `invalid_token` ("не удалось провалидировать Access token"). The error envelope used by all `oauth2/*` endpoints is `{ error, error_description?, error_uri?, state? }` (S17 `AuthError`; SDK throws when `'error' in resJson`, S16). No OAuth2 `invalid_grant`/`invalid_client` naming is documented. **Do not branch on specific token-error codes.**

### 9.3 Rate limits

**CONFIRMED**, S1:

> "Если вы подключаете авторизацию для конфиденциального приложения, то все запросы будут отправляться в VK ID с ограниченного списка IP-адресов. В редких случаях это может привести к превышению лимита запросов. По умолчанию он составляет **120 000 запросов в сутки на одно приложение**."

> "Для публичных приложений лимит запросов составляет **15 000 запросов в сутки на один IP-адрес**."

Note the public-app limit is **per IP**: a multi-tenant Logto deployment behind one egress IP shares 15 000/day. Confidential app + allow-listed IPs raises it to 120 000/day/app — but requires a static egress IP and the `service_token`.

### 9.4 Business-profile gating (operational, not protocol)

**CONFIRMED**, S6: unverified business profiles have limited access to keys/settings; apps of customers registered before 2025-12-15 are blocked after **2026-03-01** if the business profile is not confirmed; new customers have **60 days** from the first app. Login to the VK ID cabinet is only possible via **VK Бизнес ID** (bid.vk.com). This matters for anyone actually configuring the connector.

---

## 10. Modern VK ID vs legacy VK OAuth (`oauth.vk.com`) (Q9)

**CONFIRMED**, S14 (FAQ "Можно ли интегрировать OAuth ВКонтакте?"):

> "Способ авторизации OAuth ВКонтакте **устарел и больше не поддерживается VK**, так как появилась более современная и безопасная альтернатива авторизации, основанная на протоколе **OAuth 2.1**, — это OAuth VK ID."

**CONFIRMED**, S13: Standalone apps from `dev.vk.com` were **migrated** into the VK ID cabinet; "настройка Standalone-приложений более недоступна … мы перенесли все ваши Standalone-приложения в сервис авторизации VK ID".

**CONFIRMED**, S19 (SDK README): "VK ID SDK поддерживает авторизацию по протоколу [OAuth 2.1](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-10)".

**Conclusion:** use `id.vk.ru` (`/authorize`, `/oauth2/auth`, `/oauth2/user_info`). **Do not** implement `oauth.vk.com/authorize` + `oauth.vk.com/access_token` (implicit/legacy flow, `client_secret` in request, no PKCE). The old flow's exact differences are **UNCONFIRMED** because VK removed it from the current docs — and that is itself the answer: it is unsupported.

Also confirmed the modern server is explicitly called the "authorization server 2.1" (S1: "Перед интеграцией через API с сервером авторизации 2.1").

---

## 11. Independent corroboration from the official SDK source

These are observations that constrain the request shapes empirically (S16/S17/S18):

| Fact                                                                                                                      | Evidence                                                     |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| authorize URL built as `https://id.vk.ru/authorize?...`                                                                   | `getVKIDUrl('authorize', ...)` (S16/S18)                     |
| `code_challenge_method` sent as `'s256'` (lowercase)                                                                      | `const CODE_CHALLENGE_METHOD = 's256'` (S16)                 |
| token exchange: `POST https://id.vk.ru/oauth2/auth?<all params>` with only `code` in the body                             | `exchangeCode()` (S16)                                       |
| `refresh_token` grant for token refresh                                                                                   | `refreshToken()` (S16)                                       |
| `user_info` called as `POST .../oauth2/user_info?client_id=<app>` body `access_token=...`                                 | `userInfo()` (S16)                                           |
| callback payload keys observed by the SDK: `code`, `state`, `device_id`, `type`, `expires_in`, `ext_id`                   | `AuthDataService.sendSuccessData` + `AuthResponse` (S16/S17) |
| errors carry `error`, `error_description?`, `error_uri?`, `state?`                                                        | `AuthError` (S17)                                            |
| `TokenResult` = `{access_token, expires_in, id_token, refresh_token, state, token_type, user_id, scope}` all non-optional | S17                                                          |
| `UserInfoResult = { user: Partial<{avatar,email,first_name,last_name,phone,user_id}> }`                                   | S17                                                          |

Note `expires_in`/`ext_id` appear in the SDK's _popup/postMessage_ payload; they are **not** listed among redirect-flow query params in S1 — another reason not to depend on them (UNCONFIRMED whether a direct redirect includes `expires_in`).

---

## 12. Audit of the upstream connector's assumptions

Upstream files: recovered `src/index.ts`, `src/types.ts`, `src/constant.ts` from the npm package named in NOTICE.

| #   | Upstream behaviour                                                                                                                                                                                          | Verified VK ID reality                                                                              | Verdict                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1   | Config guard requires `clientSecret` (`z.string()`, mandatory)                                                                                                                                              | No `client_secret` in VK ID's token exchange; confidential apps use `service_token` + IP allow-list | **WRONG** — remove or make optional (map to `service_token`) |
| 2   | `clientSecret` never used in any request                                                                                                                                                                    | consistent with reality, which means it is dead weight                                              | **Dead config field**                                        |
| 3   | Callback guard requires `redirectUri` (`z.string()`) from callback params                                                                                                                                   | Callback contains only `code`, `state`, `device_id` (+ optional `type`)                             | **BLOCKING BUG** — always fails validation                   |
| 4   | Callback guard ignores/doesn't require `state`                                                                                                                                                              | `state` is required at authorize and echoed; must be verified                                       | **BUG** — CSRF check lost                                    |
| 5   | Token request sends `redirect_uri: redirectUri` taken from callback                                                                                                                                         | `redirect_uri` must come from config and be byte-identical to the registered URL                    | **BUG** (cascade from #3)                                    |
| 6   | Token request generates a **new** random `state` and ignores the response `state`                                                                                                                           | Docs: re-send the authorize `state`; response `state` must match it                                 | **WRONG**                                                    |
| 7   | No `service_token` support                                                                                                                                                                                  | Required for confidential apps                                                                      | **MISSING FEATURE**                                          |
| 8   | Endpoints: `id.vk.ru/authorize`, `id.vk.ru/oauth2/auth`, `id.vk.ru/oauth2/user_info`; scope `vkid.personal_info`; `code_challenge_method=S256`; PKCE via `pkce-challenge`; `code_verifier` in Logto session | All correct per S1                                                                                  | **CORRECT** ✅                                               |
| 9   | `accessTokenEndpoint` response guard requires `refresh_token`, `id_token`, `state`, `scope`, `expires_in`, `user_id: number`                                                                                | All present on code exchange per S1/S7/S4                                                           | **CORRECT** ✅ (but brittle for future/refresh responses)    |
| 10  | `userInfoResponseGuard`: `user.user_id: string`, optional `first_name/last_name/phone/avatar/email/sex/verified/birthday`                                                                                   | Matches documented response exactly, including `user_id` being a string                             | **CORRECT** ✅                                               |
| 11  | Scope default `vkid.personal_info`                                                                                                                                                                          | Correct default (S10)                                                                               | **CORRECT** ✅                                               |

---

## 13. UNCONFIRMED items (do not hard-code)

1. Callback error contract in the redirect flow (`?error=...` at `redirect_uri` vs a VK error page) — docs say error page; SDK gets errors via `postMessage`. No `user_cancelled` code documented.
2. Whether `state` at the token endpoint is enforced as required (S1 says required, S4 says optional, example requests omit it).
3. Exact token-endpoint error codes/HTTP statuses (only `404 NOT FOUND` on bad `grant_type`/`response_type` is documented).
4. Whether VK ID tolerates a stray `client_secret` parameter (never tested).
5. Whether `client_id` is mandatory on `user_info` (documented in tables, omitted in one curl example).
6. `sex` numeric semantics (VK API `1`/`2` convention assumed; dev.vk.ru method pages were unavailable: "Часть функций недоступна").
7. Exact meaning/mapping of `verified` in `user_info` (field exists; the `is_verified` description is about `users.get()`).
8. OIDC discovery / JWKS: no evidence VK ID provides either.
9. Whether ports other than 80/443 are accepted for non-localhost redirect URIs ("Другие порты временно не поддерживаются" is stated in the localhost/testing context).
10. Trailing-slash normalization behaviour on exact-match.
11. The full `user_info`/`public_info`/`revoke` sections of the API reference (page truncated; only the authorize and token sections were readable in full). **The `user_info` request/response contract above is nonetheless CONFIRMED from three independent no-SDK platform docs (S3/S4/S5) and the SDK source (S16).**

---

## 14. CONNECTOR IMPLICATIONS

Concrete, implementation-ready requirements for `ozvix-logto-connector-vkid`:

### Endpoints (hardcode `id.vk.ru`)

- Authorize: `https://id.vk.ru/authorize`
- Token: `https://id.vk.ru/oauth2/auth` — **POST only**, `Content-Type: application/x-www-form-urlencoded`
- User info: `https://id.vk.ru/oauth2/user_info` — POST, body `access_token=...`, query `client_id=...`
- Optional (only if you implement logout/revocation): `https://id.vk.ru/oauth2/logout`

### Config (`vkConfigGuard`)

- `clientId`: **required** (`z.string().min(1)`).
- `serviceToken`: **optional** — only for VK apps marked _Конфиденциальное_; when set, it is sent as the `service_token` POST parameter on the code exchange **and** on refresh. Document that confidential apps only work from an allow-listed egress IP.
- `clientSecret`: **drop it** (or keep only for backward compatibility, unused, and say so). VK ID has no `client_secret` in the OAuth exchange.
- `scope`: optional, default **`vkid.personal_info`** (space-separated; users needing `email`/`phone` must also enable them in the VK dashboard, and `phone` requires a verified business profile).
- `redirectUri` handling: prefer deriving it from Logto's `redirectUri` argument, but **persist it** (see session below) and re-send the identical string to the token endpoint.

### Authorize step (`getAuthorizationUri`)

- Send exactly: `response_type=code`, `client_id`, `redirect_uri`, `state`, `code_challenge`, `code_challenge_method=S256`, `scope`.
- Optional: `prompt` (`login` to force re-auth), `lang_id`, `scheme`.
- Do **not** send: `device_id` (it does not exist at this stage), `client_secret`, `force_auth`, `revoke`, `origin`, `stats_info`, `v`.
- PKCE: `code_verifier` = 43–128 chars from `[A-Za-z0-9_-]`; `code_challenge = BASE64URL(SHA256(ASCII(verifier)))`.
- **Persist in the Logto session** (`setSession`): `code_verifier`, `state`, and `redirect_uri` — the latter two are needed at token time. If Logto's `state` value might be < 32 chars, validate/log this (VK documents a ≥ 32-char requirement) rather than silently altering it.

### Callback step

- Read **only** `code`, `state`, `device_id` (+ optional `type`); **never require `redirect_uri`** in the callback.
- Validate `state` against the session (`code === callback.state`), else fail with invalid-request.
- If `code` is absent → generic authorization failure (no reliable error params).
- `device_id` is required for the token exchange → fail early with a clear error if missing.

### Token exchange

- Body: `grant_type=authorization_code`, `code`, `code_verifier`, `client_id`, `device_id`, `redirect_uri` (from session/config, byte-identical), `state` (the stored authorize state), plus `service_token` only when configured.
- Verify the response `state` equals the stored `state` when present (skip if empty/absent rather than fail — S4 shows `""` possible).
- Persist `refresh_token` for refresh support: access token is **1 h**, refresh token **180 days** and is **single-use** (rotation invalidates all tokens in the session if an old one is reused).
- Do **not** send `client_secret`.

### User info step

- `POST https://id.vk.ru/oauth2/user_info?client_id=<clientId>` with form body `access_token=<token>`; optionally `device_id`.
- Parse envelope `{ user: { ... } }`; treat every field as optional (`Partial`).
- Subject id = **`user.user_id` as a string** (token-endpoint `user_id` is a number — normalize to string; do not mix).
- `name` = `first_name` + `last_name` (either may be missing → `undefined`, not `"undefined "`).
- `avatar` = absolute URL, use as-is (no size dict).
- `phone` = 11 digits, leading `7`, **no `+`** — normalize to E.164 (`+7…`) if the connector outputs E.164; only present with `scope=phone`.
- `email` = plain address; only present with `scope=email`. Since VK verifies e-mail via OTP during registration (S6: "он укажет почту, ему нужно будет подтвердить её с помощью OTP-кода") — `email_verified` may be set `true` when scope `email` was granted; otherwise **false/undefined**. Do **not** infer verification from `verified` (that is account-identity verification, not e-mail).
- `verified` = account data verification boolean (VK "grey check-mark"); map to nothing security-critical.
- `sex` (number) and `birthday` (`DD.MM.YYYY`) are additive; ignore for Logto's standard profile shape.

### Operational / docs for the connector README

- The VK app must be created in the **VK ID cabinet** (`https://id.vk.ru/about/business/go/`, login via VK Бизнес ID) and the business profile confirmed, else keys/settings are restricted.
- The Logto callback URL must be registered verbatim as the app's **Доверенный redirect URL**, and its host must equal the app's **Базовый домен**.
- Local testing is limited to `http://localhost:80` / `https://localhost:443`; a Logto dev server on another port will not work without a tunnel/proxy.
- Public apps are capped at **15 000 requests/day per IP**; confidential apps at **120 000/day per app** but require static, allow-listed backend IPs + `service_token`.
- No secrets, tokens, or app credentials in logs; the session must store `code_verifier`/`state`/`redirect_uri` server-side.
