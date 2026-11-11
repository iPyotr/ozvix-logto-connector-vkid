#!/bin/sh
# Back up everything needed to undo a VK ID connector deployment on a Logto OSS Docker host.
#
# Usage:
#   ./backup-logto-vkid.sh [backup-root]
#
# Default backup root: /opt/logto/backups
# Creates <backup-root>/<UTC timestamp>/ containing:
#   - compose.yaml / compose.override.yaml (or whatever compose file was used)
#   - the current image reference and image id of the running logto service
#   - the connector directory copied out of the running container (if present)
#   - a PostgreSQL dump of the Logto database
#   - a MANIFEST file describing the host and the restore command
#
# The dump uses `pg_dump` from the same PostgreSQL container, so no client installation is needed.

set -eu

BACKUP_ROOT="${1:-/opt/logto/backups}"
COMPOSE_FILE="${COMPOSE_FILE:-/opt/logto/compose.yaml}"
LOGTO_SERVICE="${LOGTO_SERVICE:-logto}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="${BACKUP_ROOT}/${STAMP}"
CONNECTOR_DIR_IN_IMAGE="/etc/logto/packages/core/connectors/connector-ozvix-vkid"

umask 077

if [ ! -f "${COMPOSE_FILE}" ]; then
  echo "FATAL: compose file not found: ${COMPOSE_FILE}" >&2
  exit 1
fi

COMPOSE_CMD="docker compose -f ${COMPOSE_FILE}"

mkdir -p "${TARGET}"

echo "==> Backing up to ${TARGET}"

# 1. Compose configuration (the source of truth for the deployment).
cp "${COMPOSE_FILE}" "${TARGET}/compose.yaml"
for extra in /opt/logto/compose.override.yaml /opt/logto/.env; do
  if [ -f "${extra}" ]; then
    cp "${extra}" "${TARGET}/$(basename "${extra}")"
  fi
done

# 2. Current image and container identity.
${COMPOSE_CMD} images > "${TARGET}/compose-images.txt" 2>/dev/null || true
${COMPOSE_CMD} ps > "${TARGET}/compose-ps.txt" 2>/dev/null || true
CONTAINER_ID="$(${COMPOSE_CMD} ps -q "${LOGTO_SERVICE}" 2>/dev/null || true)"
if [ -n "${CONTAINER_ID}" ]; then
  docker inspect --format '{{.Config.Image}} {{.Image}}' "${CONTAINER_ID}" > "${TARGET}/logto-image.txt" || true
fi

# 3. Connector directory as it exists inside the container (rollback does not depend on the image).
if [ -n "${CONTAINER_ID}" ]; then
  mkdir -p "${TARGET}/connectors"
  if docker exec "${CONTAINER_ID}" test -d "${CONNECTOR_DIR_IN_IMAGE}"; then
    docker cp "${CONTAINER_ID}:${CONNECTOR_DIR_IN_IMAGE}" "${TARGET}/connectors/connector-ozvix-vkid"
    echo "    connector directory copied"
  else
    echo "    no connector directory in the running container (nothing to copy)"
  fi
fi

# 4. Database dump. PostgreSQL is not published on the host, so it runs inside the db container.
DB_SERVICE="${DB_SERVICE:-postgres}"
DB_USER="${DB_USER:-logto}"
DB_NAME="${DB_NAME:-logto}"
if ${COMPOSE_CMD} ps "${DB_SERVICE}" >/dev/null 2>&1; then
  echo "==> Dumping PostgreSQL (${DB_SERVICE}/${DB_NAME})"
  ${COMPOSE_CMD} exec -T "${DB_SERVICE}" \
    pg_dump --no-owner --no-privileges -U "${DB_USER}" "${DB_NAME}" \
    | gzip -9 > "${TARGET}/logto-db.sql.gz"
else
  echo "WARNING: service '${DB_SERVICE}' not found; skipping database dump" >&2
fi

cat > "${TARGET}/MANIFEST" <<EOF
created_utc=${STAMP}
host=$(hostname)
compose_file=${COMPOSE_FILE}
logto_service=${LOGTO_SERVICE}
db_service=${DB_SERVICE}
db_name=${DB_NAME}
db_user=${DB_USER}
connector_dir=${CONNECTOR_DIR_IN_IMAGE}
restore=see docs/INSTALL-LOGTO-DOCKER.md "Rollback" section; the database dump is
restore=${TARGET}/logto-db.sql.gz and the connector copy is ${TARGET}/connectors/
EOF

chmod -R go-rwx "${TARGET}" 2>/dev/null || true
echo "==> Backup complete: ${TARGET}"
echo "    Restore instructions: docs/INSTALL-LOGTO-DOCKER.md § Rollback"
