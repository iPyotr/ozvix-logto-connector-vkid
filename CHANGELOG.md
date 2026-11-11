# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This project is a derivative work; see [`NOTICE`](NOTICE) for provenance and the list of modified
files, and [`docs/SECURITY-AUDIT.md`](docs/SECURITY-AUDIT.md) for the audit of the upstream package.

## [1.1.0] — 2026-11-11

### Added

- Connector icon `logo.png` / `logo-dark.png` (512×512, transparent rounded corners) shown in the
  Connector gallery and on the connector page.
- Bilingual presentation: `name` and `description` use Logto's `I18nPhrases` (`en`, `ru-RU`); form
  labels and descriptions are bilingual strings because `@logto/connector-kit` 5.2.0 defines them as
  plain strings; `CONNECTOR.md` now contains English and Russian sections with a language switch.
- `SECURITY.md` (private vulnerability reporting), `CONTRIBUTING.md`, a bug-report issue form and a
  pull-request template.
- CI: `format:check`, and an integration job that starts the mock stack, runs the full OAuth proof
  inside the Logto image and asserts the `state` compatibility patch.
- Prettier configuration and `format` / `format:check` scripts.
- Type-aware ESLint (`recommendedTypeChecked`, `no-floating-promises`, `no-misused-promises`) and
  `exactOptionalPropertyTypes` in TypeScript.

### Changed

- The repository is self-contained: the upstream npm artifacts are no longer vendored. Their
  shasum/integrity are recorded in [NOTICE](NOTICE) and `docs/SECURITY-AUDIT.md`, and the source
  stays available from the original distributor.
- VK error mapping is deduplicated into `toConnectorError()` in `src/client.ts`.
- Package version 1.1.0; `SECURITY.md` ships in the npm package.

### Fixed

- `.github/workflows/ci.yml` was invalid YAML: a step name contained an unquoted `(gate: …)`, which
  GitHub Actions would have rejected. Prettier's YAML parser surfaced it.

## [1.0.0] — 2026-11-10

First release of the hardened connector. Not compatible with the upstream
`@workingbit/connector-vk` installation procedure: install this package instead (the connector
factory id is unchanged, so an existing `connectorId` row keeps working).

### Added

- Modern VK ID integration: OAuth 2.1 authorization code flow with PKCE (`S256`) against
  `https://id.vk.ru`.
- `getTokenResponseAndUserInfo` implementation, so Logto's Secret Vault token storage works
  (`isTokenStorageSupported: true`).
- Connector-session binding of the PKCE verifier, the Logto redirect URI and the OAuth `state`
  (`vk_code_verifier`, `vk_redirect_uri`, `vk_state`).
- Verification of the `state` echoed in the callback and in the token response.
- Token-subject/profile-subject consistency check (`tokenResponse.user_id` vs `user_info.user_id`).
- Structured error mapping onto `ConnectorErrorCodes` (`AuthorizationFailed`,
  `SocialAuthCodeInvalid`, `SocialAccessTokenInvalid`, `InvalidResponse`, `InvalidRequestParameters`,
  `InvalidConfig`).
- Opt-in e-mail and phone synchronisation (`syncEmail`, `syncPhone`, both default `false`) with
  validation and E.164 normalisation.
- Configurable API origin (`apiBaseUrl`), used for VK mirrors and for the local mock server.
- Configurable request timeout (`timeout`, default 8000 ms).
- Full name mapping (`first_name` + `last_name` + `patronymic`).
- Avatar validation (absolute `http(s)` URL only).
- 125 unit tests across the 16 required scenarios, with 100 % statement/branch/function/line
  coverage of `src/`.
- Docker integration environment: mock VK ID OAuth server, PostgreSQL and Logto OSS 1.46.0 behind
  `compose.test.yaml`, with health checks and compose profiles.
- Derived production image (`Dockerfile`) based on the official `svhd/logto:1.46.0` image.
- Backup and rollback scripts (`deploy/scripts/`), an example compose override, and
  `docs/INSTALL-LOGTO-DOCKER.md` with an Option A / Option B comparison.
- `CONNECTOR.md` — the connector's setup guide rendered inside the Admin Console
  (`metadata.readme`), in Russian: VK ID cabinet steps, configuration reference, scopes, protocol
  limitations, troubleshooting. The package README stays the project/deployment document.
- Connector display name is **VK OAuth 2.1** in the connector gallery and in the docs, matching the
  protocol version VK documents for `id.vk.ru`.
- Docker build applies a verified compatibility patch to the Logto Experience bundle: the social
  sign-in `state` is raised from 14 to 46 characters, because VK OAuth 2.1 requires at least 32.
  The build fails if the pinned Logto bundle no longer matches the pattern.
- Documentation: `README.md`, `README.ru.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY-AUDIT.md`,
  `docs/VK-ID-SETUP.md`, `docs/TROUBLESHOOTING.md`, `docs/LOCAL-TESTING.md`,
  `docs/INSTALL-LOGTO-DOCKER.md`.
- CI: typecheck, lint, unit tests, coverage, build, package-contents check, bundle-import check,
  dependency audit, Docker image build and image contents assertion.

### Fixed (relative to `@workingbit/connector-vk@0.0.4`)

- **Local test stack behind HTTPS:** `compose.test.yaml` set `TRUST_PROXY`, which Logto 1.46.0
  ignores; behind a reverse proxy the request origin therefore stayed `http`, the Admin Console
  refused the `https` `ADMIN_ENDPOINT` and served the default tenant ("does not match any configured
  admin endpoint"). The variable is now `TRUST_PROXY_HEADER`.
- **VK `state` length:** VK OAuth 2.1 requires a `state` of at least 32 characters, but Logto 1.46.0
  generates 14 (`se_` + 8 random bytes), so a real VK authorization could be rejected as
  `invalid_request`. The derived image now patches the pinned Experience bundle to 32 random bytes
  (46 characters) and fails the build if the patch no longer applies.
- **Admin Console over plain HTTP:** the Console needs a secure context (`Crypto.subtle`), so it
  cannot create the first administrator on `http://`; the local-testing docs now require an HTTPS
  endpoint (a local Caddy with its own CA is enough).

- **Blocking:** callback validation required a `redirectUri` parameter that VK ID never sends, so
  every real login failed. The redirect URI now comes from the connector session.
- **Token leak:** token and callback payloads were serialised into `ConnectorError` messages and
  could therefore reach the Logto log. Error payloads now contain only statuses, OAuth error codes
  and field names.
- **CSRF:** `state` was never bound to the authorization request — a fresh random value was
  generated at token time. The original `state` is now persisted, replayed and verified.
- **Credential model:** the mandatory but unused `clientSecret` was removed; confidential VK apps
  are supported through the optional `serviceToken` (`service_token`), which is the parameter VK ID
  actually defines. `client_secret` is never sent.
- **Logto 1.46.0 compatibility:** the exact `@logto/connector-kit@5.1.2` pin failed the loader's
  version gate (the image ships 5.2.0) and the connector was silently skipped. The range is now
  `^5.2.0`.
- Over-strict token-response schema (required `refresh_token`, `id_token`, `state`, `scope`,
  `user_id`) relaxed to `access_token` + optional fields.
- Profile name no longer drops the surname.
- Provider e-mail and phone are no longer forwarded unconditionally (account-linking risk), and the
  phone is normalised.
- Declined-consent callbacks are mapped to `AuthorizationFailed` instead of a generic error carrying
  the raw parameters.
- Session validation checks the PKCE verifier shape (length, charset), not only its presence.
- `pkce-challenge` (bundled but undeclared) replaced by a `node:crypto` implementation.
- `ky` removed; the platform `fetch` is used, including a timeout error shape that Logto maps to
  `502 connector.social_provider_unreachable`.
- README rewritten: the upstream README documented GitHub, not VK ID.
- License compliance: `LICENSE` (MPL-2.0) and `NOTICE` (provenance, attribution, modifications)
  added; the upstream package shipped neither.

### Security

See [`docs/SECURITY-AUDIT.md`](docs/SECURITY-AUDIT.md) for the full findings list (22 findings) and
the residual-risk register.

Additional input hardening applied in the independent security pass:

- Provider and callback `error` / `error_description` values are stripped of control and Unicode
  format characters and capped (200 characters for a description, 64 for an error code) before they
  are placed into an error payload. A callback query string is fully attacker-controlled and Logto
  serialises error payloads into its log, so these values could otherwise forge log lines or flood
  the log.
- The VK user id — the value Logto stores and displays as the social identity — must match
  `[A-Za-z0-9._:-]{1,64}`. A hostile value now fails closed with `InvalidResponse` instead of being
  stored verbatim.
- Unicode bidi/zero-width characters are stripped from display names, so a name cannot render as a
  different string in the Admin Console than the one stored.
- `apiBaseUrl` rejects URLs that embed credentials (`https://user:secret@host`), which would
  otherwise appear in the timeout error message.
- Provider response bodies are capped at 1 MiB (both `content-length` and the actual body), so a
  misconfigured or compromised API origin cannot make the Logto process buffer an arbitrary body.
- The image build runs `npm ci --ignore-scripts`, so no dependency lifecycle script executes during
  the Docker build. Verified by building the derived image with the flag: `tsup`/`esbuild` still
  produce the bundle.
- `apiBaseUrl` accepts an explicit plain-HTTP origin (a LAN mirror or an integration-test host).
  Previously plain HTTP was limited to loopback hosts. HTTPS remains the default and the documented
  production choice; the README states that a plain-HTTP origin sends the access token, the
  authorization code and the PKCE verifier unencrypted. This is an administrator decision, not an
  attacker-reachable setting.
- 11 unit tests cover these paths (125 in total, still 100 % coverage).

### Known limitations

- No refresh-token grant: VK ID rotates single-use refresh tokens and requires the `device_id` issued
  during authorization, which Logto's token set does not persist.
- `id_token` is not validated: VK ID is not an OIDC provider and publishes no usable discovery/JWKS
  contract.
- VK OAuth 2.1 requires a minimum `state` length of 32 characters. The derived image patches
  Logto's Experience bundle to 46 characters at build time; a stock Logto 1.46.0 image is not
  compliant.
- VK ID only accepts redirect URIs on ports 80/443, so a Logto development instance on `:3001`
  cannot be a real VK ID redirect target.
