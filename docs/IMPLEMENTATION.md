# Implementation guide

End-to-end: from an empty VK ID application to "Continue with VK" on a self-hosted Logto OSS
instance. Every command uses placeholders — replace `<logto-domain>`, `<connector-id>` and
`<vk-app-id>` with your values.

```
Browser ──► Logto Experience ──► VK ID authorize ──► consent ──► /callback/<connector-id>
                │                                                   │
                └────────── session: PKCE verifier, state, redirect ─┘
                                    │
                            token exchange (POST /oauth2/auth)
                                    │
                            profile (POST /oauth2/user_info)
                                    │
                            Logto user / identity link
```

## 1. Choose the deployment model

| Model                           | When to use                                                          | Trade-off                                                                              |
| ------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Derived image** (recommended) | You control the Logto container image and can rebuild it on upgrades | Rebuild on every Logto upgrade; the build fails closed if the patch cannot be applied  |
| Bind mount                      | You must keep the stock image                                        | Mount the package and patch the Experience bundle manually; easier to break on upgrade |

The rest of this guide uses the derived image. The bind-mount alternative is described in
[INSTALL-LOGTO-DOCKER.md](INSTALL-LOGTO-DOCKER.md).

## 2. Prerequisites

| Requirement           | Details                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| Logto OSS             | 1.46.0 — the connector is verified against this version                                                 |
| Public HTTPS endpoint | The Admin Console requires a secure context (Web Crypto); VK accepts redirect URIs on ports 80/443 only |
| Reverse proxy         | Caddy, nginx or Traefik terminating TLS; set `TRUST_PROXY_HEADER=1`                                     |
| VK ID application     | Web application with a confirmed business profile if you need e-mail/phone                              |
| Docker + Compose      | On the Logto host, with the ability to build images                                                     |

## 3. Create the VK ID application

In the VK ID cabinet (<https://id.vk.ru/about/business/go/>) → **My applications** → create a
**Web** application.

| VK ID field          | Value                                               | Notes                                                                            |
| -------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------- |
| Base domain          | `<logto-domain>`                                    | Without scheme, port or path                                                     |
| Trusted redirect URL | `https://<logto-domain>/callback/<connector-id>`    | Exact string match; the id is shown by Logto after the connector is added        |
| Scopes               | `vkid.personal_info` (+ `email`, `phone` if needed) | E-mail/phone must also be enabled for the application                            |
| Application type     | Public (default)                                    | Confidential applications additionally need a service token and an IP allow-list |

You will not have `<connector-id>` until step 6. The usual order is: build and deploy Logto, add the
connector, copy the callback URI from the connector page, then paste it into VK.

Do **not** put the _protected key_ (`client_secret`) into the connector: VK OAuth 2.1 has no
`client_secret` parameter in the redirect flow.

## 4. Build the derived image

Pin the base to the exact Logto image your deployment runs — a tag is fine for a test, a digest is
preferred in production:

```bash
git clone https://github.com/OZVIX/ozvix-logto-connector-vkid.git
cd ozvix-logto-connector-vkid

docker build \
  --build-arg LOGTO_BASE_IMAGE=ghcr.io/logto-io/logto@sha256:<digest> \
  -t ozvix/logto-vkid:1.46.0-vkid.1 .
```

The build:

1. compiles the connector with `npm ci && npm run build`;
2. copies it to `/etc/logto/packages/core/connectors/connector-ozvix-vkid`;
3. raises the social sign-in `state` from 14 to 46 characters in the Experience bundle (VK requires
   ≥ 32) and regenerates the `.gz`/`.br` siblings;
4. fails if the package name, the `@logto/connector-kit` range or the `state` patch cannot be
   satisfied.

## 5. Run Logto

A minimal `compose.yaml` (the same file works for a fresh install):

```yaml
name: logto

services:
  postgres:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: logto
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?required}
      POSTGRES_DB: logto
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U logto -d logto']
      interval: 5s
      timeout: 5s
      retries: 15
    networks: [backend]

  logto:
    image: ozvix/logto-vkid:1.46.0-vkid.1
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DB_URL: postgres://logto:${POSTGRES_PASSWORD:?required}@postgres:5432/logto
      TRUST_PROXY_HEADER: '1'
      ENDPOINT: https://<logto-domain>
      ADMIN_ENDPOINT: https://<admin-domain>
    ports:
      - '127.0.0.1:3001:3001'
      - '127.0.0.1:3002:3002'
    networks: [backend]

volumes:
  postgres_data:

networks:
  backend:
    driver: bridge
```

Start it:

```bash
docker compose up -d
curl -s -o /dev/null -w '%{http_code}\n' https://<logto-domain>/api/status   # 204
```

The reverse proxy must forward `X-Forwarded-*` headers; `TRUST_PROXY_HEADER=1` tells Logto to
trust them. Without it, the Admin Console reports "does not match any configured admin endpoint".

## 6. Add the connector in the Admin Console

1. Open `https://<admin-domain>/console/connectors/social` → **Add social connector**.
2. Pick **VK OAuth 2.1** → **Next**.
3. Fill in:

   | Field                    | Value                                                                            |
   | ------------------------ | -------------------------------------------------------------------------------- |
   | Client ID                | `<vk-app-id>` (the numeric application id)                                       |
   | Service token            | Empty for a public application; only for a confidential one                      |
   | Scope                    | `vkid.personal_info` (+ `email`, `phone` if needed)                              |
   | Sync e-mail / Sync phone | Off unless you need them (see [profile sync](#profile-sync-and-account-linking)) |
   | VK ID API origin         | Empty in production                                                              |
   | Request timeout          | `8000`                                                                           |

4. **Save**. Copy **Redirect URI (Callback URI)** — it ends with `/callback/<connector-id>`.
5. Paste it into the VK ID application's trusted redirect URL.

## 7. Enable it in the sign-in experience

**Sign-in experience → Sign-in and account → Social sign-in** → add **VK OAuth 2.1**. Keep at least
one other connector (for example Yandex ID) so an administrator is never locked out.

If you want accounts created with different providers but the same e-mail to merge, enable
**Automatic account linking** in the same section. Read the caveat below first.

## 8. Verify

| Check               | Expected                                                         |
| ------------------- | ---------------------------------------------------------------- |
| Connector gallery   | VK OAuth 2.1 row with the icon                                   |
| Sign-in page        | "Continue with VK" next to the other providers                   |
| Consent screen      | VK shows the application name and the requested scopes           |
| Callback            | `GET /callback/<connector-id>?code=…&device_id=…&state=…` → 200  |
| Logto user          | Created with the VK display name; e-mail/phone only if synced    |
| Logs                | No `[load-connector]` error, no tokens or codes in the log lines |
| Existing connectors | Still listed and working (they were not modified)                |

The local mock stack (`compose.test.yaml` + `docker/vkid-proof.mjs`) proves the protocol end to end
without a VK account; see [LOCAL-TESTING.md](LOCAL-TESTING.md).

## Profile sync and account linking

Logto 1.46 syncs **e-mail and phone only when the user is created**. On later sign-ins it updates
`name` and `avatar` only, even with **Sync profile** enabled and even when accounts are linked.
Consequences:

- new users get e-mail/phone from VK (if the app scopes are granted and the address is not already
  used by another account);
- existing users keep whatever e-mail/phone they already had — fill them manually in **User
  management** or via the Management API if needed;
- automatic linking matches on phone first, then on e-mail, and does **not** verify the provider's
  address: only enable it when you trust VK (or the other provider) to verify e-mail ownership.

This is by design in Logto, not a connector limitation; the behaviour is implemented in
`toSyncedProfile` in `packages/core/src/routes/experience/classes/verifications/social-verification.ts`.

## Operations

| Task          | Command                                                                                |
| ------------- | -------------------------------------------------------------------------------------- |
| Back up       | `pg_dump` + copy `compose.yaml` and `.env` (see `deploy/scripts/backup-logto-vkid.sh`) |
| Upgrade Logto | rebuild with the new base digest, `docker compose up -d logto`                         |
| Roll back     | restore the previous `compose.yaml` (or image tag) and `docker compose up -d logto`    |
| Logs          | `docker compose logs -f logto`                                                         |
| Health        | `curl https://<logto-domain>/api/status` → `204`                                       |

The connector package lives in the image, so a Logto upgrade always requires a rebuild of the derived
image. Keep the previous image tag so a rollback is one command.

## Security checklist

- [ ] `ADMIN_ENDPOINT` is on a private network or behind an allow-list.
- [ ] `TRUST_PROXY_HEADER=1` only when a trusted reverse proxy is in front.
- [ ] No `client_secret` in the connector configuration.
- [ ] E-mail/phone sync enabled only if the provider verifies them.
- [ ] Automatic account linking is a deliberate decision.
- [ ] The service token, if used, is rotated on a schedule and never logged.
- [ ] Backups are encrypted and stored outside the host.

## Troubleshooting

| Symptom                                                       | Cause / fix                                                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Connector missing from the gallery                            | Loader skipped it: check the package name, `lib/index.js`, the `@logto/connector-kit` range and the log line |
| VK error before consent                                       | Redirect URI mismatch (exact string), wrong base domain, or a port other than 80/443                         |
| `invalid_scope`                                               | The scope is not enabled for the VK application                                                              |
| `401 connector.authorization_failed`                          | The user declined consent or the VK account is blocked                                                       |
| `502 connector.social_provider_unreachable`                   | Logto cannot reach `id.vk.ru` (egress, DNS, timeout)                                                         |
| `state` too short / VK rejects the request                    | The derived image was not used or the patch did not apply; rebuild and check the build log                   |
| Admin Console: "insecure contexts"                            | Serve the Console over HTTPS                                                                                 |
| Admin Console: "does not match any configured admin endpoint" | Set `TRUST_PROXY_HEADER=1` and align `ADMIN_ENDPOINT` with the public URL                                    |

More: [TROUBLESHOOTING.md](TROUBLESHOOTING.md), [VK-ID-SETUP.md](VK-ID-SETUP.md),
[ARCHITECTURE.md](ARCHITECTURE.md).
