## What changed

<!-- One or two sentences. Link the issue if there is one. -->

## Security impact

<!-- Does this touch session handling, PKCE, token exchange, error payloads, log output or the
     Dockerfile patch? If not, say "none". -->

## Checklist

- [ ] `npm run verify` passes locally (typecheck, lint, format check, tests, build)
- [ ] New behaviour is covered by a test; coverage of `src/` stays at 100 %
- [ ] No tokens, codes, verifiers, secrets or real accounts appear in code, tests, logs or screenshots
- [ ] Documentation and `CHANGELOG.md` updated (English and, for user-facing docs, Russian)
- [ ] The connector still loads in Logto 1.46.0 (integration job or a manual check)
