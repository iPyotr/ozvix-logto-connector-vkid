# VK OAuth 2.1

[English](#english) · [Русский](#русский)

## English

Add "Continue with VK" to your Logto sign-in experience. The connector implements the modern
**VK OAuth 2.1** protocol: authorization code + PKCE (`S256`) against the `https://id.vk.ru`
authorization server. This is not the legacy `oauth.vk.com` flow.

### 1. Create a VK ID application

1. Sign in to the VK ID cabinet at <https://id.vk.ru/about/business/go/> with the VK account that
   owns the application. Keys and settings are available after the business profile is confirmed.
2. Create a **web** application (the cabinet's exact type names are not documented; pick the
   server-side / web option).
3. Set **Базовый домен** (base domain) to the public host that serves Logto, for example
   `auth.example.com`.
4. Set the **trusted redirect URL** to the connector's callback. Copy it from this page —
   **Redirect URI (Callback URI)** — do not type it by hand:
   `https://<your Logto endpoint>/callback/<connector-id>`. VK matches it **by exact string**, and
   only ports 80 and 443 are accepted.
5. Copy **ID приложения** (a number) — this is the connector's **Client ID**.

### 2. Configure the connector

| Field                                  | Value                                                                                                                                              |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client ID / Идентификатор приложения   | The numeric application id from the VK ID cabinet.                                                                                                 |
| Service token / Сервисный ключ доступа | Leave empty for a public web application. Only _confidential_ VK ID applications need it, and they must also call from an allow-listed IP.         |
| Scope / Права доступа                  | `vkid.personal_info` unless you need more. Add `email` and/or `phone` only if they are enabled in the VK ID cabinet.                               |
| Sync e-mail                            | Off unless you want Logto to receive the VK e-mail. Logto may then link an existing account by e-mail.                                             |
| Sync phone number                      | Off, same reasoning. Logto prefers a phone match when linking accounts.                                                                            |
| VK ID API origin                       | Leave empty in production. `https://id.vk.com` also works but redirects to `id.vk.ru`. A plain `http://` origin is for LAN mirrors and tests only. |
| Request timeout                        | `8000` ms by default; allowed range 1000–60000.                                                                                                    |

There is no `clientSecret` field: VK OAuth 2.1 has no `client_secret` parameter. Never paste the
application's _Защищённый ключ_ here.

### 3. Enable the connector

1. Save the connector.
2. Go to **Sign-in experience → Sign-in and account → Social sign-in** and add **VK OAuth 2.1**.
   Keep at least one other social connector (for example Yandex ID) so an administrator cannot be
   locked out.
3. Open the sign-in page in a private window: "Continue with VK" must appear next to the other
   providers.

### 4. What is forwarded to Logto

- The stable VK user id as the social identity, used to recognise a returning user.
- The display name from `first_name`, `last_name` and, when present, `patronymic`.
- The avatar URL, only when it is an absolute `http(s)` URL.
- E-mail and phone only when `Sync e-mail` / `Sync phone number` are enabled and the scopes are
  granted; the phone number is normalised to E.164.

### 5. After the first sign-in

Logto stores the VK display name automatically; there is no "enter your name" step for it. Extra
questions after the VK consent come from the **Sign-in experience**: if it requires a `username`,
`email` or `phone` identifier, Logto asks for it because a VK profile has none of these. To finish
the sign-in immediately, remove the extra identifiers in **Sign-in experience → Sign-up and sign-in
→ Sign-up identifiers**, or enable `email` together with `Sync e-mail` and the `email` scope.

### 6. Protocol notes

- VK access tokens live 1 hour. The connector forwards tokens to Logto's Secret Vault when token
  storage is enabled, but it does not implement a refresh grant: VK rotates refresh tokens and
  requires the `device_id` issued during authorization, which Logto does not persist.
- VK OAuth 2.1 is not OpenID Connect: there is no discovery document or JWKS, so `id_token` is not
  validated. Identity comes from `user_info` over TLS with a token obtained directly from VK.
- Public VK applications are limited to 15 000 requests/day per IP; confidential ones to
  120 000/day per application.
- VK requires `state` of at least 32 characters. Stock Logto 1.46.0 generates 14; the derived image
  of this project raises it to 46 at build time and fails the build if that patch cannot be applied.

### 7. Troubleshooting

| Symptom                                                              | Fix                                                                                                                                |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| VK OAuth 2.1 is not in the connector gallery                         | The loader skipped the package: check the Logto log for `[load-connector]`, the package name and the `@logto/connector-kit` range. |
| VK shows an error page before consent                                | The trusted redirect URL does not match the callback URI exactly, or it uses a port other than 80/443.                             |
| `401 connector.authorization_failed`                                 | The VK account is blocked or consent was refused.                                                                                  |
| `502 connector.social_provider_unreachable` with `ETIMEDOUT`         | Logto cannot reach VK: check egress, DNS and the timeout.                                                                          |
| Signed in but no e-mail or phone                                     | Sync switches are off, or the scope is not enabled in the VK cabinet.                                                              |
| Admin Console says "Insecure contexts (non-HTTPS) are not supported" | Serve the Console over HTTPS; Web Crypto needs a secure context.                                                                   |
| Admin Console says "does not match any configured admin endpoint"    | Behind a reverse proxy set `TRUST_PROXY_HEADER=1` and make `ADMIN_ENDPOINT` match the public URL.                                  |

### 8. E-mail and phone sync

The connector automatically adds `email` / `phone` to the VK scope when the matching **Sync**
switch is on. VK must still allow the scope in the VK ID application dashboard; `phone`
additionally requires a verified business profile. See [`docs/VK-CONTACTS.md`](docs/VK-CONTACTS.md)
for the checklist, diagnostics and deployment notes.

## Русский

Добавьте вход «Продолжить с VK» в сценарий входа Logto. Коннектор реализует современный протокол
**VK OAuth 2.1**: authorization code + PKCE (`S256`) на сервере авторизации `https://id.vk.ru`.
Это не устаревший `oauth.vk.com`.

### 1. Создайте приложение VK ID

1. Войдите в кабинет VK ID: <https://id.vk.ru/about/business/go/> — под аккаунтом VK, которому
   принадлежит приложение. Ключи и настройки доступны после подтверждения бизнес-профиля.
2. Создайте приложение типа **Web**.
3. Укажите **Базовый домен** — публичный хост, на котором работает Logto, например
   `auth.example.com`.
4. В поле **Доверенный redirect URL** вставьте Callback URI коннектора. Скопируйте его на
   странице коннектора — поле **Redirect URI (Callback URI)** — не набирайте вручную: это
   `https://<ваш Logto endpoint>/callback/<connector-id>`. VK сравнивает адрес **посимвольно** и
   принимает только порты 80 и 443.
5. Скопируйте **ID приложения** (число) — это поле **Client ID**.

### 2. Настройте коннектор

| Поле                                   | Значение                                                                                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client ID / Идентификатор приложения   | Числовой **ID приложения** из кабинета VK ID.                                                                                                      |
| Service token / Сервисный ключ доступа | Оставьте пустым для публичного веб-приложения. Нужен только приложениям со статусом _Конфиденциальное_, и они должны обращаться с разрешённого IP. |
| Scope / Права доступа                  | `vkid.personal_info`, если не нужно больше. `email`/`phone` — только если они включены в кабинете VK ID.                                           |
| Sync e-mail                            | Выключено, если не хотите передавать e-mail VK в Logto: Logto может связать существующий аккаунт по e-mail.                                        |
| Sync phone number                      | Выключено по той же причине; при связывании Logto предпочитает телефон.                                                                            |
| VK ID API origin                       | В продакшене оставьте пустым. `https://id.vk.com` работает, но перенаправляет на `id.vk.ru`. Обычный `http://` — только для LAN-зеркал и тестов.   |
| Request timeout                        | По умолчанию `8000` мс; допустимо 1000–60000.                                                                                                      |

Поля `clientSecret` нет: в VK OAuth 2.1 нет параметра `client_secret`. Никогда не вставляйте сюда
_Защищённый ключ_ приложения.

### 3. Включите коннектор

1. Сохраните коннектор.
2. Перейдите в **Sign-in experience → Sign-in and account → Social sign-in** и добавьте
   **VK OAuth 2.1**. Оставьте хотя бы один другой социальный коннектор (например, Yandex ID),
   чтобы администратор не потерял доступ.
3. Откройте страницу входа в приватном окне: рядом с другими провайдерами должна появиться кнопка
   «Продолжить с VK».

### 4. Какие данные передаются в Logto

- Стабильный VK user id как социальная идентичность.
- Отображаемое имя из `first_name`, `last_name` и, если пришло, `patronymic`.
- Ссылка на аватар — только абсолютный `http(s)`-URL.
- E-mail и телефон — только при включённых синхронизациях и выданных scope; телефон приводится к E.164.

### 5. После первого входа

Logto сам сохраняет имя из VK — отдельного шага «введите имя» нет. Дополнительные вопросы после
согласия VK задаёт **Sign-in experience**: если там обязателен `username`/`email`/`phone`, Logto
попросит его, потому что в профиле VK таких полей нет. Чтобы вход завершался сразу, уберите лишние
идентификаторы в **Sign-in experience → Sign-up and sign-in → Sign-up identifiers** или включите
`email` вместе с синхронизацией e-mail и scope `email`.

### 6. Ограничения протокола

- Access token VK живёт 1 час. Коннектор передаёт токены в Secret Vault Logto, но **не реализует
  refresh**: VK ротирует refresh-токены и требует `device_id`, который Logto не хранит.
- VK OAuth 2.1 — не OpenID Connect: нет discovery и JWKS, поэтому `id_token` не валидируется.
- Публичные приложения VK — 15 000 запросов в сутки на IP, конфиденциальные — 120 000 на приложение.
- VK требует `state` не короче 32 символов. Стандартный Logto 1.46.0 генерирует 14; производный
  образ проекта увеличивает его до 46 при сборке и падает, если патч не применим.

### 7. Диагностика

| Симптом                                                         | Что делать                                                                                                          |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| VK OAuth 2.1 нет в списке коннекторов                           | Загрузчик пропустил пакет: проверьте лог Logto на `[load-connector]`, имя пакета и диапазон `@logto/connector-kit`. |
| VK показывает ошибку до согласия                                | Доверенный redirect URL не совпадает с Callback URI посимвольно или использует порт, отличный от 80/443.            |
| `401 connector.authorization_failed`                            | Аккаунт VK заблокирован или пользователь отказал в доступе.                                                         |
| `502 connector.social_provider_unreachable` с `ETIMEDOUT`       | Logto не может достучаться до VK: проверьте исходящий трафик, DNS и таймаут.                                        |
| Вход выполнен, но e-mail/телефона нет                           | Выключены синхронизации или scope не включён в кабинете VK ID.                                                      |
| Console пишет «Insecure contexts (non-HTTPS) are not supported» | Admin Console должен работать по HTTPS.                                                                             |
| Console пишет «does not match any configured admin endpoint»    | За прокси задайте `TRUST_PROXY_HEADER=1` и проверьте `ADMIN_ENDPOINT`.                                              |

### 8. E-mail и телефон

При включённом переключателе **Sync** коннектор сам добавляет `email`/`phone` в scope VK.
Разрешение всё равно должно быть включено в кабинете VK ID; для телефона нужен подтверждённый
бизнес-профиль. Чеклист, диагностика и деплой — в [`docs/VK-CONTACTS.md`](docs/VK-CONTACTS.md).
