# Contributing

Thanks for taking the time to improve the VK OAuth 2.1 connector.

## Requirements

- Node.js **>= 22** (the package declares `engines.node >= 22`).
- Docker (only for the integration stack in `compose.test.yaml`).

## Setup

```bash
npm ci
npm run verify   # typecheck + lint + format check + tests + build
```

`npm run verify` is the same gate CI runs. The integration job additionally starts the mock VK
provider and runs `docker/vkid-proof.mjs` inside the built Logto image.

## Code style

- TypeScript strict mode, including `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`.
- ESLint with type-aware rules; **do not** disable rules to silence a real finding — explain the
  exception in a comment when the rule cannot apply (for example, Logto's async factory contract).
- Prettier: run `npm run format` before committing; CI runs `npm run format:check`.
- Tests: Vitest. New behaviour needs a test, and coverage stays at 100 % for `src/`.

## Commit and pull requests

- Conventional commit subjects (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
- Keep a pull request focused; describe the behaviour change and the security impact.
- Update `CHANGELOG.md` under the unreleased/current version and the relevant docs when behaviour
  changes, and add the Russian counterpart when user-facing documentation changes.
- Never commit `.env`, tokens, keys or screenshots containing real accounts.

## Security

- Read [SECURITY.md](SECURITY.md) before changing session handling, PKCE, token exchange, error
  payloads or log output.
- The connector must not log or return access/refresh/id tokens, authorization codes or PKCE
  verifiers. `tests/error-secrecy.test.ts` guards this.
- Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

This project is MPL-2.0. By contributing you agree that your contribution is licensed under the same
terms (inbound = outbound), and you keep the existing notices in [NOTICE](NOTICE) intact.
