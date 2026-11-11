# Publishing the repository

This file is a checklist for putting the sanitized copy on GitHub and shipping the artefacts. The
working copy in this repository is the **public** one: it contains no real hostnames, credentials or
personal data. Do not publish a checkout that contains `.env`, tokens or production domain names.

## 1. Create the repository and push

GitHub Desktop is enough:

1. Install GitHub Desktop and sign in to the account that owns (or can write to) the `OZVIX`
   organisation.
2. **File → Add Local Repository** → select the sanitized checkout (the folder that contains
   `.git`, `README.md` and `src/`).
3. If Desktop offers to create a repository because it does not see `.git`, stop — you picked a
   folder without history. Add the checkout that already has the initial commit.
4. Click **Publish repository**:
   - name: `ozvix-logto-connector-vkid`
   - description: see §2
   - owner: `iPyotr` (or an organisation you can publish to), otherwise your personal account
   - clear **Keep this code private**
5. If the organisation is not offered, create an empty repository at
   `https://github.com/organizations/OZVIX/repositories/new` (no README, no licence), then in
   Desktop open **Repository → Repository settings → Remote** and paste the repository URL, then
   **Push origin**.

After the push, check that the CI badge resolves. If the owner or repository name differs from
`iPyotr/ozvix-logto-connector-vkid`, update the badge URLs in `README.md` and `README.ru.md` and the
`repository` / `homepage` / `bugs` fields in `package.json`.

## 2. About section

**Description (English, short):**

> A hardened VK OAuth 2.1 social connector for Logto OSS 1.46 — authorization code + PKCE S256,
> session-bound state and verifier, bilingual UI (EN/RU), 100 % test coverage, Docker image included.

**Description (Russian, if you prefer):**

> Защищённый социальный коннектор VK OAuth 2.1 для Logto OSS 1.46: authorization code + PKCE S256,
> привязка state и verifier к сессии, двуязычный интерфейс (EN/RU), покрытие тестами 100 %,
> готовый Docker-образ.

**Topics:**

```
logto  logto-connector  vk  vk-id  oauth2  pkce  social-login  typescript  docker  self-hosted
```

**Social preview:** upload [`docs/assets/social-preview.png`](assets/social-preview.png) in
**Settings → Social preview**.

## 3. Release v1.1.0

```bash
git tag -a v1.1.0 -m "VK OAuth 2.1 connector 1.1.0"
git push origin v1.1.0
```

Create the release from the tag and use [RELEASE-1.1.0.md](RELEASE-1.1.0.md) as the release body
(it mirrors the `1.1.0` section of [CHANGELOG.md](../CHANGELOG.md) and adds install and verification
notes).
Attach nothing: the npm package and the Docker image are published separately.

## 4. Publish the npm package (optional)

```bash
npm login                       # an account with access to the @ozvix scope
npm publish --access public
```

The `files` list ships `lib/`, the icons, `README.md`, `CONNECTOR.md`, `LICENSE`, `NOTICE` and
`SECURITY.md`. Verify with `npm view @ozvix/connector-vkid version`.

## 5. Publish the Docker image (optional)

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u <github-user> --password-stdin

docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --build-arg LOGTO_BASE_IMAGE=ghcr.io/logto-io/logto@sha256:<digest> \
  -t ghcr.io/ozvix/logto-vkid:1.46.0-vkid.1 \
  --push .
```

`GHCR_TOKEN` needs `write:packages`. Document the image tag in the README quick start so users do not
have to build it themselves.

## 6. Repository settings

| Setting                              | Where                    | Why                                                                        |
| ------------------------------------ | ------------------------ | -------------------------------------------------------------------------- |
| Private vulnerability reporting      | Settings → Security      | Routes reports through [SECURITY.md](../SECURITY.md)                       |
| Dependabot alerts + security updates | Settings → Code security | Keeps `zod` / tooling patched                                              |
| Secret scanning                      | Settings → Code security | Public repository, free                                                    |
| Branch protection on `main`          | Settings → Branches      | Require the CI check, block force pushes                                   |
| Actions permissions                  | Settings → Actions       | Read-only `GITHUB_TOKEN` by default; the integration job only needs Docker |
| Topics and description               | About (pencil icon)      | Discoverability                                                            |

The CI workflow does not need any secret: the integration job uses the local mock provider and the
Docker build uses public base images.

## 7. Final checklist

- [ ] Sanitized checkout pushed to `iPyotr/ozvix-logto-connector-vkid` (or your account)
- [ ] Description, topics and social preview set
- [ ] CI green on `main` (verify + integration + audit + docker)
- [ ] `v1.1.0` tag and release published
- [ ] Badge URLs match the final repository path
- [ ] `package.json` `repository`, `homepage`, `bugs` match the final URL
- [ ] npm package published (optional)
- [ ] Docker image published (optional)
- [ ] Security advisories and Dependabot enabled
- [ ] Branch protection on `main`
