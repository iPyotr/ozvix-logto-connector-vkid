# syntax=docker/dockerfile:1
# Dependency-free mock VK ID OAuth 2.1 provider.
# There are no npm dependencies to install, so the image is tiny and the build
# works fully offline against a locally cached node:22-alpine image.
FROM node:22-alpine

ENV NODE_ENV=production \
    MOCK_VKID_HOST=0.0.0.0 \
    MOCK_VKID_PORT=8090

WORKDIR /app

COPY package.json ./
COPY src ./src

USER node

EXPOSE 8090

HEALTHCHECK --interval=5s --timeout=3s --start-period=3s --retries=10 \
  CMD node -e "fetch('http://127.0.0.1:8090/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/index.mjs"]
