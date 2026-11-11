# syntax=docker/dockerfile:1.7
#
# Base Logto image. Override with --build-arg to pin the exact image your deployment runs, e.g.
#   docker build --build-arg LOGTO_BASE_IMAGE=ghcr.io/logto-io/logto@sha256:<digest> -t <tag> .
# The value must be declared before the first FROM to be usable in a FROM line.
ARG LOGTO_BASE_IMAGE=svhd/logto:1.46.0
#
# Derived Logto OSS image with the VK ID connector pre-installed.
#
# Why a derived image instead of rebuilding Logto:
#   Logto 1.46.0 discovers social connectors at RUNTIME by scanning
#   /etc/logto/packages/core/connectors and importing <dir>/lib/index.js from every direct child
#   whose package.json name starts with "connector-" (or "@scope/connector-"). It is not a
#   compile-time registry, so the official image only needs the connector directory to be present.
#   Deriving from the official image therefore keeps the Logto version, the Node.js runtime and the
#   database schema untouched, and does not rebuild Logto itself.
#
# The connector bundle is pure JavaScript: @logto/connector-kit and zod are resolved from the
# Logto image at runtime (both are already there), so nothing is installed into the runtime image.

# ---- Stage 1: build the connector package ------------------------------------------------
FROM node:22-alpine AS connector-build
WORKDIR /connector
ENV CI=true

# `npm ci` needs only the manifests; keeping this layer separate caches the install.
# `--ignore-scripts` keeps dependency lifecycle scripts from executing during the build: the tree is
# lockfile-pinned, and tsup/esbuild build correctly without their install script (verified by
# building this image with the flag).
COPY package.json package-lock.json ./
RUN --mount=type=cache,id=npm-connector,target=/root/.npm \
    npm ci --ignore-scripts --no-audit --no-fund

COPY tsconfig.json tsup.config.ts ./
COPY src ./src
RUN npm run build

# ---- Stage 2: the Logto OSS image with the connector installed -----------------------------
FROM ${LOGTO_BASE_IMAGE}

LABEL org.opencontainers.image.title="logto-vkid" \
      org.opencontainers.image.description="Logto OSS 1.46.0 with the OZVIX VK ID social connector" \
      org.opencontainers.image.source="https://github.com/OZVIX/ozvix-logto-connector-vkid" \
      org.opencontainers.image.licenses="MPL-2.0"

# Directory name is arbitrary; the loader keys off the package.json "name" field.
ARG CONNECTOR_DIR=/etc/logto/packages/core/connectors/connector-ozvix-vkid

# VK OAuth 2.1 requires a `state` of at least 32 characters; Logto Experience 1.46.0 generates 14
# (`se_` + 8 random bytes). The patch raises the random part to 32 bytes and fails the build if the
# pinned bundle no longer matches, so an unpatched image can never be shipped silently.
COPY docker/patch-experience-state.mjs /tmp/patch-experience-state.mjs
RUN node /tmp/patch-experience-state.mjs

COPY --from=connector-build /connector/lib "${CONNECTOR_DIR}/lib"
COPY --from=connector-build /connector/package.json "${CONNECTOR_DIR}/package.json"
COPY logo.png logo-dark.png README.md CONNECTOR.md LICENSE NOTICE "${CONNECTOR_DIR}/"

# Fail the build instead of shipping an image whose connector would be silently skipped:
# the loader requires dependencies["@logto/connector-kit"] to satisfy the installed version,
# and the entry point must exist at <dir>/lib/index.js.
RUN set -eu; \
    cd "${CONNECTOR_DIR}"; \
    test -f lib/index.js || { echo "FATAL: lib/index.js missing"; exit 1; }; \
    node -e "const p=require('./package.json'); const v=require('/etc/logto/packages/core/node_modules/@logto/connector-kit/package.json').version; const semver=require('/etc/logto/packages/core/node_modules/semver'); if(!p.name.startsWith('connector-')&&!p.name.split('/')[1]?.startsWith('connector-')){throw new Error('package name must be connector-* or @scope/connector-*');} const range=p.dependencies['@logto/connector-kit']; if(!semver.satisfies(v,range)){throw new Error('connector-kit range '+range+' does not satisfy installed '+v);} console.log('connector '+p.name+'@'+p.version+' accepts connector-kit '+v);"

# The base image runs as root and has no USER directive; keep that behaviour so Logto's own
# entrypoint and file permissions are unchanged.
EXPOSE 3001

ENTRYPOINT ["npm", "run"]
CMD ["start"]
