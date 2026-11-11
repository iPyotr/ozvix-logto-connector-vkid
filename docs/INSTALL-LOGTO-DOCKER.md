# Installing the VK ID connector into Logto OSS 1.46.0 (Docker)

This document describes how to add the VK ID social connector to the existing OZVIX Logto
deployment **without touching the user database, the OIDC issuer, or the working Yandex ID
connector**, and how to roll it back.

Target environment (as deployed):

| Item                       | Value                                                                            |
| -------------------------- | -------------------------------------------------------------------------------- |
| VPS                        | Debian 12                                                                        |
| Logto                      | OSS 1.46.0, official image `svhd/logto:1.46.0`                                   |
| Compose file               | `/opt/logto/compose.yaml`                                                        |
| Container                  | `logto-logto-1`, `WORKDIR /etc/logto`                                            |
| Existing connectors        | `/etc/logto/packages/connectors`                                                 |
| Custom connector directory | `/etc/logto/packages/core/connectors`                                            |
| PostgreSQL                 | separate container in the same compose project                                   |
| Public endpoint            | `https://auth.example.com`                                                          |
| Admin console              | `https://auth-admin.example.com`                                                    |
| Reverse proxy              | Caddy                                                                            |
| Sign-in mode               | social-only (username/password registration disabled), Yandex ID already enabled |

---

## 1. What does not work, and why

**Copying the npm package into a container directory is not enough, and `docker cp` is not a
deployment.**

Three separate mechanisms are involved:

1. **Discovery is a runtime directory scan.** Logto 1.46.0 does not keep a compiled registry of
   connectors. At boot, `@logto/cli`'s `getConnectorPackagesFromDirectory()` scans the direct
   children of `/etc/logto/packages/core/connectors`, reads each child's `package.json`, and keeps
   only directories whose `name` starts with `connector-` (or is `@scope/connector-…`).
2. **Loading is an ESM import of a fixed path.** For each candidate the loader reads
   `<dir>/package.json`, checks that `dependencies["@logto/connector-kit"]` **satisfies the
   connector-kit version installed in the image** (5.2.0 for Logto 1.46.0), and then
   `import("<dir>/lib/index.js")`. Anything else — a different directory layout, a CommonJS `.cjs`
   file, a missing dependency declaration — is skipped with a log line and the connector silently
   does not appear.
3. **The container filesystem is ephemeral.** Any directory created by `docker cp` or an interactive
   `docker exec` disappears on the next `docker compose up -d` (recreate), on `docker compose pull`,
   and on host reboot after an image change. The deployment must therefore live in the image or in
   a declared mount.

Additional hard requirements:

- The connector's `package.json` name must be `connector-*` / `@scope/connector-*`. This package is
  `@ozvix/connector-vkid` — accepted.
- The declared connector-kit range must include `5.2.0`. This package declares `^5.2.0`.
- `@logto/connector-kit` and `zod` must resolve from the image. They are already present in the
  official image (`@logto/core` depends on both), so the connector needs **no** `node_modules` of
  its own.
- The **upstream** `@workingbit/connector-vk@0.0.4` package must not be installed: it pins
  `@logto/connector-kit@5.1.2` exactly, which fails the version gate on Logto 1.46.0, and its
  callback validation requires a `redirectUri` parameter that VK ID never sends (see
  [`SECURITY-AUDIT.md`](SECURITY-AUDIT.md) F-01/F-06).
- Do not install this connector and the upstream package at the same time. Both use the factory id
  `vk-universal`, and Logto rejects duplicate factory ids
  (`connector.more_than_one_connector_factory`, HTTP 422).

---

## 2. Two supported deployment models

### Option A — derived image (recommended)

`FROM svhd/logto:1.46.0` plus a `COPY` of the connector directory into
`/etc/logto/packages/core/connectors/`. Implemented by the [`Dockerfile`](../Dockerfile) in this
repository.

### Option B — bind mount into the official image

Keep `image: svhd/logto:1.46.0` and mount a host directory **at the connector subdirectory only**:

```yaml
volumes:
  - /opt/logto/connectors/connector-ozvix-vkid:/etc/logto/packages/core/connectors/connector-ozvix-vkid:ro
```

### Comparison

|                                                  | **A. Derived image**                                         | **B. Bind mount**                                                                                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Persists across container recreation             | yes — baked into the image                                   | yes — declared in compose                                                                                                                                |
| Survives `docker compose pull` of the base image | yes (rebuild needed to _update_ the base, which is intended) | yes (mount stays; base image updates independently)                                                                                                      |
| Reproducible on another host                     | yes — one image reference                                    | needs the directory copied to the same path                                                                                                              |
| Rollback                                         | retag/point back to the previous image (seconds)             | remove the mount + recreate (seconds)                                                                                                                    |
| Risk of shadowing official connectors            | none                                                         | none **only if** the mount targets the connector subdirectory; mounting `/etc/logto/packages/core/connectors` itself would hide every official connector |
| Build toolchain on the VPS                       | Docker only (multi-stage build)                              | none                                                                                                                                                     |
| Supply chain                                     | image contents are auditable and immutable                   | anyone with host access can swap files                                                                                                                   |
| Failure mode                                     | image fails to build (visible)                               | connector silently skipped (needs log check)                                                                                                             |

**Recommendation: Option A.** The connector is real application code, so it should be versioned,
built once and shipped immutably; every update becomes an image with its own tag, which makes
rollback a one-line change. Use Option B only if you cannot build images on the host or need to hot
swap the connector without restarting the service.

Both options are non-destructive: neither touches PostgreSQL, the OIDC issuer, the sign-in
experience, or the Yandex ID connector.

---

## 3. Before you start

### 3.1 Back up

Run the bundled script on the VPS (it copies compose files, the running image identity, the current
connector directory and a `pg_dump` of the Logto database):

```bash
sudo mkdir -p /opt/logto/backups
sudo COMPOSE_FILE=/opt/logto/compose.yaml \
     DB_SERVICE=postgres DB_NAME=logto DB_USER=logto \
     sh deploy/scripts/backup-logto-vkid.sh /opt/logto/backups
```

The script never publishes PostgreSQL and never stops the running stack. Verify that the backup
directory contains `compose.yaml`, `compose-images.txt`, `logto-db.sql.gz` and `MANIFEST`.

> The database dump is a precaution, not a requirement: adding a connector does not migrate or
> modify existing users. A connector row is created only when you click **Add connector** in the
> Admin Console.

### 3.2 Record the current state

```bash
cd /opt/logto
sudo docker compose ps
sudo docker inspect --format '{{.Config.Image}}' logto-logto-1
sudo docker exec logto-logto-1 sh -c 'ls -la /etc/logto/packages/core/connectors | head -40'
```

Note the image reference, and confirm the connector directory listing so you can prove the
difference afterwards.

### 3.3 Prepare the VK ID application

Follow [`VK-ID-SETUP.md`](VK-ID-SETUP.md): create a VK ID application, and enter the **exact**
callback URI that Logto shows in the connector settings as the trusted redirect URL. It must be on
`https://auth.example.com` (port 443) — VK ID does not accept arbitrary ports, including `:3001`.

---

## 4. Option A — build and deploy the derived image

### 4.1 Get the sources onto the host

```bash
sudo git clone https://github.com/OZVIX/ozvix-logto-connector-vkid.git /opt/ozvix-logto-connector-vkid
cd /opt/ozvix-logto-connector-vkid
sudo git checkout v1.0.0        # pin a release tag, never deploy a moving branch
```

### 4.2 Build the image

On the VPS (needs Docker with BuildKit, ~5 minutes, ~300 MB of build cache for the `npm ci` layer):

```bash
cd /opt/ozvix-logto-connector-vkid
sudo docker build -t ozvix/logto-vkid:1.46.0-vkid.1 .
```

The build performs the typecheck-independent safety checks at the end of the Dockerfile: it fails if
`lib/index.js` is missing, if the package name is not `connector-*`, or if the declared
connector-kit range does not satisfy the connector-kit version inside the image.

If you prefer to build on a workstation and ship the image without a registry:

```bash
# workstation
docker build -t ozvix/logto-vkid:1.46.0-vkid.1 .
docker save ozvix/logto-vkid:1.46.0-vkid.1 | gzip -9 > logto-vkid-1.46.0-vkid.1.tar.gz
scp logto-vkid-1.46.0-vkid.1.tar.gz root@<vps>:/tmp/

# VPS
gunzip -c /tmp/logto-vkid-1.46.0-vkid.1.tar.gz | sudo docker load
```

### 4.3 Keep the previous image for rollback

```bash
sudo docker image tag svhd/logto:1.46.0 svhd/logto:1.46.0.pre-vkid
```

### 4.4 Point compose at the new image

Create `/opt/logto/compose.override.yaml`. Docker Compose loads `compose.override.yaml`
automatically next to `compose.yaml`, so the existing start command does not change:

```yaml
# /opt/logto/compose.override.yaml
services:
  logto:
    image: ozvix/logto-vkid:1.46.0-vkid.1
    # Optional but recommended: fail fast if Logto does not come up.
    healthcheck:
      test:
        [
          'CMD',
          'node',
          '-e',
          "fetch('http://127.0.0.1:3001/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
        ]
      interval: 30s
      timeout: 5s
      retries: 5
      start_period: 60s
```

Do **not** copy this file over `compose.yaml`; do not change `ENDPOINT`, `ADMIN_ENDPOINT`,
`DB_URL`, ports or volumes. The override replaces one key.

> **Behind Caddy (or any reverse proxy) set `TRUST_PROXY_HEADER=1`.** Logto 1.46.0 reads
> `TRUST_PROXY_HEADER` and ignores the older `TRUST_PROXY`; without it the request origin is `http`
> while `ADMIN_ENDPOINT` is `https`, and the Admin Console is served by the default tenant
> ("does not match any configured admin endpoint"). The proxy must send `X-Forwarded-Proto`, which
> Caddy does by default. The Admin Console also requires HTTPS: over plain HTTP it cannot create the
> first administrator (`Crypto.subtle` is unavailable in an insecure context).
> If your stack is started with an explicit `-f`, pass both files:

```bash
sudo docker compose -f /opt/logto/compose.yaml -f /opt/logto/compose.override.yaml up -d
```

### 4.5 Recreate only the Logto service

```bash
cd /opt/logto
sudo docker compose up -d logto
sudo docker compose ps
```

PostgreSQL is left running and untouched.

### 4.6 Verify that Logto loaded the connector

```bash
# 1. No loader error for our connector (an error would appear as "skip ... due to error")
sudo docker compose logs --since 10m logto | grep -iE 'load-connector|connector' || true

# 2. The files are inside the container
sudo docker exec logto-logto-1 sh -c \
  'ls -la /etc/logto/packages/core/connectors/connector-ozvix-vkid /etc/logto/packages/core/connectors/connector-ozvix-vkid/lib'

# 3. Logto is healthy
curl -fsS https://auth.example.com/api/status && echo
```

Then in the Admin Console:

1. **Connectors → Social connectors → Add connector** — "VK ID" must be listed with its
   description. If it is not listed, see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md)
   §"Connector is not listed".
2. Open **VK ID**, paste the VK ID **Client ID** (and a **service token** only for a confidential VK
   app), keep the scope `vkid.personal_info`, leave **Sync e-mail**/**Sync phone number** disabled
   unless you have decided otherwise, and **Save**.
3. Copy the **Callback URI** shown on that page and paste it into the VK ID application as the
   trusted redirect URL. Then re-open the connector and save again if you changed anything.
4. **Sign-in experience → Sign-up and sign-in → Social sign-in** → add **VK ID**, keep Yandex ID.
5. Open `https://auth.example.com` in a private window: "Continue with VK ID" must appear next to the
   Yandex ID button.

### 4.7 Functional check

- Sign in with VK ID as a **new** user: Logto creates a user with the VK name and avatar.
- Sign out, sign in again: the same Logto user is reused (identity is matched by the VK user id).
- Sign in with Yandex ID: unchanged, existing users unaffected.
- An existing Logto user can attach VK ID from the Account Center (account linking) — this uses the
  same connector.

---

## 5. Option B — bind mount (alternative)

Only the connector **subdirectory** is mounted, so the official connector symlinks in
`/etc/logto/packages/core/connectors` stay intact.

1. Build the connector package on any machine with Node.js ≥ 22:

   ```bash
   npm ci
   npm run build
   ```

2. Copy the runtime files to the host:

   ```bash
   sudo mkdir -p /opt/logto/connectors/connector-ozvix-vkid/lib
   sudo cp -r lib/*            /opt/logto/connectors/connector-ozvix-vkid/lib/
   sudo cp package.json README.md LICENSE NOTICE logo.png logo-dark.png \
               /opt/logto/connectors/connector-ozvix-vkid/
   sudo chmod -R a+rX /opt/logto/connectors/connector-ozvix-vkid
   ```

   The directory must contain `package.json` (name `@ozvix/connector-vkid`) and `lib/index.js`.

3. Add the mount to the `logto` service in `/opt/logto/compose.yaml`:

   ```yaml
   volumes:
     - /opt/logto/connectors/connector-ozvix-vkid:/etc/logto/packages/core/connectors/connector-ozvix-vkid:ro
   ```

4. Recreate the service and verify exactly as in §4.6–4.7:

   ```bash
   cd /opt/logto && sudo docker compose up -d logto
   ```

Caveats: with `:ro` the mount cannot be modified from inside the container (good). Do **not** mount
over `/etc/logto/packages/core/connectors` — that hides every official connector, including Yandex
ID's. Bind mounts are not captured by `docker save`, so a host rebuild needs the directory copied
again.

---

## 6. Updating the connector

```bash
cd /opt/ozvix-logto-connector-vkid
sudo git fetch --tags
sudo git checkout v1.1.0
sudo docker build -t ozvix/logto-vkid:1.46.0-vkid.2 .
sudo docker image tag svhd/logto:1.46.0.pre-vkid ozvix/logto-vkid:1.46.0-vkid.1   # keep the old one
sudo sed -i 's/1.46.0-vkid.1/1.46.0-vkid.2/' /opt/logto/compose.override.yaml
cd /opt/logto && sudo docker compose up -d logto
```

The connector row in the database keeps its `connectorId` (`vk-universal`), so the configuration
survives the update. Keep the factory id stable across releases.

When Logto itself is updated (for example to 1.47.x), rebuild the derived image on the new base tag:

```bash
sudo docker pull svhd/logto:1.47.0
sudo docker build --build-arg LOGTO_BASE=svhd/logto:1.47.0 ...
```

The Dockerfile currently pins the base tag literally; change the `FROM` line (or add an `ARG`) and
re-run the verification in §4.6. Connector Kit API changes between Logto minor versions are the
main compatibility risk — see [`ARCHITECTURE.md`](ARCHITECTURE.md) §6.

---

## 7. Rollback

### 7.1 Connector only (no data loss, preferred)

```bash
cd /opt/logto
# remove the override so compose.yaml's original image is used again
sudo rm -f /opt/logto/compose.override.yaml
sudo docker compose up -d logto
sudo docker compose ps
```

or point the override back at the previous tag:

```bash
sudo sed -i 's/1.46.0-vkid.2/1.46.0.pre-vkid/' /opt/logto/compose.override.yaml
sudo docker compose up -d logto
```

The VK ID row stays in the database but is not loaded, so the button disappears and sign-in keeps
working through Yandex ID. You can also disable the VK ID connector in the Admin Console without
changing the image at all.

### 7.2 Connector + database (destructive, only if you restored an older backup)

```bash
sudo COMPOSE_FILE=/opt/logto/compose.yaml sh deploy/scripts/rollback-logto-vkid.sh \
  /opt/logto/backups/<timestamp> svhd/logto:1.46.0 --restore-db
```

This drops and re-creates the Logto database from the dump, discarding every user and session
created after the dump. The script asks for confirmation first.

### 7.3 Verify the rollback

- `https://auth.example.com` shows no VK ID button;
- Yandex ID sign-in still works;
- existing OIDC applications (your OIDC applications and others) still authenticate — the issuer and client
  registrations were never modified.

---

## 8. Operational notes

- **Do not** `docker cp` the connector into a running container and consider it deployed.
- **Do not** edit files inside the container; the next recreate reverts them.
- The connector writes nothing to disk and keeps no state; all transient OAuth state lives in
  Logto's interaction session (server side) and expires with it.
- VK ID has a documented limit of **15 000 requests/day per public IP** for public applications; a
  Logto instance behind one egress IP shares that budget. Confidential applications raise it to
  120 000/day per application but require an allow-listed egress IP and a service token.
- Backups: run `deploy/scripts/backup-logto-vkid.sh` before every update. It is safe to run on a
  live stack.
