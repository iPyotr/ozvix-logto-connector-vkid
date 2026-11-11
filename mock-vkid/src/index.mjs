#!/usr/bin/env node
/**
 * mock-vkid entrypoint: starts the dependency-free mock VK ID provider.
 * Configuration comes from MOCK_VKID_* env vars (see README.md).
 */

import { createMockVkidServer, configFromEnv } from './server.mjs';

const config = configFromEnv(process.env);
const server = createMockVkidServer(config);

server.on('error', (error) => {
  console.error(`[mock-vkid] server error: ${error.message}`);
  process.exitCode = 1;
});

server.listen(config.port, config.host, () => {
  const { port } = server.address();
  const shownHost = config.host === '0.0.0.0' ? 'localhost' : config.host;
  console.log(`[mock-vkid] listening on http://${shownHost}:${port} (bind ${config.host}:${port})`);
  console.log(`[mock-vkid] client_ids=${config.clientIds.join(',')}`);
  console.log(`[mock-vkid] redirect_uris=${config.redirectUris.join(',')}`);
  console.log(`[mock-vkid] health=${`http://${shownHost}:${port}/health`}`);
});

function shutdown(signal) {
  console.log(`[mock-vkid] received ${signal}, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { server, config };
