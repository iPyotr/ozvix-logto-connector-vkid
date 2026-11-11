/**
 * In-container proof for the VK ID connector inside the derived Logto image.
 *
 * 1. Runs exactly the discovery code path Logto core uses:
 *    getConnectorPackagesFromDirectory() + loadConnectorFactories().
 * 2. Builds the connector with a mock-stack config and exercises the real
 *    OAuth 2.1 + PKCE code flow against the mock VK ID server that shares this
 *    container's network namespace (http://localhost:8090).
 *
 * Run (stack must be up):
 *   docker compose -f compose.test.yaml cp docker/vkid-proof.mjs logto:/tmp/vkid-proof.mjs
 *   docker compose -f compose.test.yaml exec logto node /tmp/vkid-proof.mjs
 */

const CONNECTORS_DIR = '/etc/logto/packages/core/connectors';
const CONNECTOR_DIR = `${CONNECTORS_DIR}/connector-ozvix-vkid`;

const { getConnectorPackagesFromDirectory } = await import('/etc/logto/packages/cli/lib/utils.js');
const { loadConnectorFactories } = await import(
  '/etc/logto/packages/cli/lib/connector/factories.js'
);

// --- 1. Discovery: same functions Logto core calls at runtime -----------------
const packages = await getConnectorPackagesFromDirectory(CONNECTORS_DIR);
const ours = packages.find((pkg) => pkg.path === CONNECTOR_DIR);
console.log(`DISCOVERY: ${packages.length} connector package(s) found in ${CONNECTORS_DIR}`);
console.log(`DISCOVERY: vk connector package = ${ours?.name ?? 'NOT FOUND'}`);

const factories = await loadConnectorFactories(packages);
const vk = factories.find((factory) => factory.metadata.id === 'vk-universal');
console.log(
  `FACTORY: ${vk ? `${vk.metadata.id} | target=${vk.metadata.target} | type=${vk.type}` : 'NOT LOADED'}`,
);

// --- 2. Live OAuth 2.1 + PKCE flow against the mock VK ID provider -----------
const { default: createConnector } = await import(`${CONNECTOR_DIR}/lib/index.js`);

const config = {
  clientId: 'mock-vkid-client-id',
  apiBaseUrl: 'http://localhost:8090',
  scope: 'vkid.personal_info',
};
const connector = await createConnector({ getConfig: async () => config });

let session;
const redirectUri = 'http://localhost:3001/callback/vk-universal';
const state = 'mock-proof-state-0123456789abcdef0123456789abcdef';
const authorizeUrl = await connector.getAuthorizationUri(
  { redirectUri, state, connectorId: 'vk-universal', connectorFactoryId: 'vk-universal' },
  async (value) => {
    session = value;
  },
);
const parsedAuthorize = new URL(authorizeUrl);
console.log(`AUTHORIZE: host=${parsedAuthorize.origin} path=${parsedAuthorize.pathname}`);
console.log(`AUTHORIZE: params=${[...parsedAuthorize.searchParams.keys()].sort().join(',')}`);
console.log(
  `SESSION: keys=${Object.keys(session ?? {})
    .sort()
    .join(',')} verifier_len=${session?.vk_code_verifier?.length}`,
);

const authorizeResponse = await fetch(authorizeUrl, { redirect: 'manual' });
const location = authorizeResponse.headers.get('location');
if (!location) {
  throw new Error(`mock /authorize did not redirect (status ${authorizeResponse.status})`);
}
const callbackQuery = new URL(location).searchParams;
console.log(
  `MOCK CALLBACK: status=${authorizeResponse.status} code_len=${callbackQuery.get('code')?.length} device_id=${callbackQuery.get('device_id') ? 'present' : 'MISSING'} state_echo=${callbackQuery.get('state') === state}`,
);

const userInfo = await connector.getUserInfo(
  {
    code: callbackQuery.get('code'),
    device_id: callbackQuery.get('device_id'),
    state: callbackQuery.get('state'),
  },
  async () => session,
);

console.log(
  `USER INFO: ${JSON.stringify({
    id: userInfo.id,
    name: userInfo.name ?? null,
    avatar: userInfo.avatar ?? null,
    email: userInfo.email ?? null,
  })}`,
);
console.log('PROOF OK');
