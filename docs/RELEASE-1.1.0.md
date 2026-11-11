# v1.1.0 — VK OAuth 2.1 connector for Logto OSS

The first polished release of the connector: VK sign-in on Logto OSS 1.46.0, a bilingual Admin
Console experience and a repository that is ready to be published.

## Highlights

- **VK OAuth 2.1** — authorization code + PKCE `S256` against `id.vk.ru`, no `client_secret`.
- **Hardened token handling** — PKCE verifier, `redirect_uri` and `state` are bound to the Logto
  interaction session and replayed byte-identically; tokens never reach logs or error payloads.
- **`state` compatibility** — the derived image raises the social sign-in `state` from 14 to 46
  characters (VK requires at least 32) and fails the build if the patch cannot be applied.
- **English and Russian UI** — connector name and description use Logto `I18nPhrases`; form labels
  and the in-console guide are bilingual.
- **Opt-in e-mail/phone sync** — validated and normalised, off by default, with a documented
  account-linking caveat.
- **Production-tested** — verified end to end against the real VK service, plus a mock VK provider
  and a Docker integration stack for CI.

## Added

- Connector icon (`logo.png` / `logo-dark.png`, 512×512) in the Connector gallery.
- `SECURITY.md` with private vulnerability reporting, `CONTRIBUTING.md`, a bug-report issue form and
  a pull-request template.
- `docs/IMPLEMENTATION.md` — end-to-end deployment guide, and `docs/PUBLISHING.md` — a release and
  publishing checklist.
- CI: `format:check`, and an integration job that starts the mock stack, runs the OAuth proof inside
  the Logto image and asserts the `state` patch.
- Type-aware ESLint (`recommendedTypeChecked`, `no-floating-promises`, `no-misused-promises`),
  `exactOptionalPropertyTypes` and Prettier with a CI format gate.

## Changed

- The repository is self-contained: the upstream npm artifacts are no longer vendored; their
  shasum and integrity are recorded in `NOTICE` and `docs/SECURITY-AUDIT.md`.
- VK error mapping is deduplicated into `toConnectorError()` in `src/client.ts`.
- Package version 1.1.0; `SECURITY.md` ships in the npm package.

## Fixed

- `.github/workflows/ci.yml` contained invalid YAML (an unquoted `(gate: …)` in a step name) that
  GitHub Actions would have rejected.

## Install

```bash
docker build \
  --build-arg LOGTO_BASE_IMAGE=ghcr.io/logto-io/logto@sha256:<digest> \
  -t ozvix/logto-vkid:1.46.0-vkid.1 .
```

Point the `logto` service in `compose.yaml` at the new image, restart it, then add **VK OAuth 2.1**
in **Connectors → Social connectors**. Full guide: [docs/IMPLEMENTATION.md](IMPLEMENTATION.md).

## Verification

- 125 unit tests, 100 % coverage of `src/`.
- `npm run verify` (typecheck, lint, format, tests, build) is green.
- The connector was verified against Logto OSS 1.46.0 and the real VK OAuth 2.1 service.

## Links

- [Implementation guide](IMPLEMENTATION.md)
- [Configuration reference](../README.md#configuration-reference)
- [Security audit](SECURITY-AUDIT.md)
- [Changelog](../CHANGELOG.md)
