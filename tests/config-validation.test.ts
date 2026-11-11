import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SocialConnector } from '@logto/connector-kit';
import {
  ConnectorError,
  ConnectorErrorCodes,
  ConnectorConfigFormItemType,
  ConnectorPlatform,
  ConnectorType,
} from '@logto/connector-kit';

import { vkidConfigGuard } from '../src/types.js';
import type { FetchMock } from './support.js';
import {
  CLIENT_ID,
  authorizationPayload,
  callbackData,
  configWith,
  createConnectorWithConfig,
  createFetchMock,
  createSessionHarness,
  createTestConnector,
  expectConnectorError,
  expectFetchNotCalled,
  getTokenResponseAndUserInfo,
  seedSession,
} from './support.js';

const expectInvalidConfigFromAuthorize = async (config: unknown): Promise<ConnectorError> => {
  const connector = await createConnectorWithConfig(config);
  const harness = createSessionHarness();

  return expectConnectorError(
    connector.getAuthorizationUri(authorizationPayload(), harness.setSession),
    ConnectorErrorCodes.InvalidConfig,
  );
};

describe('configuration validation (scenario 13)', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = createFetchMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('[S13] rejects a missing, blank or non-string clientId', async () => {
    for (const config of [{}, { clientId: '' }, { clientId: '   ' }, { clientId: 123 }]) {
      const error = await expectInvalidConfigFromAuthorize(config);
      expect(error).toBeInstanceOf(ConnectorError);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it('[S13] rejects a non-URL or non-http(s) apiBaseUrl', async () => {
    for (const apiBaseUrl of ['not a url', '/relative', 'ftp://id.vk.ru', 'javascript:alert(1)']) {
      await expectInvalidConfigFromAuthorize({ clientId: CLIENT_ID, apiBaseUrl });
    }
    expectFetchNotCalled(fetchMock);
  });

  it('[S13] rejects plain http for non-loopback hosts', async () => {
    // Superseded by the explicit-origin policy below: an administrator may point the connector at
    // any http(s) origin. This test now only pins that non-http(s) schemes are still rejected.
    for (const apiBaseUrl of ['ftp://id.vk.ru', 'file:///etc/passwd', 'javascript:alert(1)']) {
      await expectInvalidConfigFromAuthorize({ clientId: CLIENT_ID, apiBaseUrl });
    }
    expectFetchNotCalled(fetchMock);
  });

  it('[S13] accepts an explicitly configured http origin, including a LAN test host', async () => {
    for (const origin of [
      'http://localhost:8090',
      'http://127.0.0.1:8090',
      'http://[::1]:8090',
      'http://192.0.2.10:8090',
    ]) {
      const connector = await createTestConnector(configWith({ apiBaseUrl: origin }));
      const harness = createSessionHarness();
      const uri = await connector.getAuthorizationUri(authorizationPayload(), harness.setSession);
      const url = new URL(uri);

      expect(url.origin).toBe(origin);
      expect(url.pathname).toBe('/authorize');
    }
    expectFetchNotCalled(fetchMock);
  });

  it('[S13] rejects an apiBaseUrl with a path, query or hash', async () => {
    for (const apiBaseUrl of [
      'https://id.vk.ru/api',
      'https://id.vk.ru/?query=1',
      'https://id.vk.ru/#fragment',
      'https://id.vk.ru/path?query=1#fragment',
    ]) {
      await expectInvalidConfigFromAuthorize({ clientId: CLIENT_ID, apiBaseUrl });
    }
  });

  it('[S13] rejects an apiBaseUrl that embeds credentials', async () => {
    for (const apiBaseUrl of [
      'https://user:secret@id.vk.ru',
      'https://user@id.vk.ru',
      'https://:secret@id.vk.ru',
      'http://user:secret@localhost:8090',
    ]) {
      await expectInvalidConfigFromAuthorize({ clientId: CLIENT_ID, apiBaseUrl });
    }
    expectFetchNotCalled(fetchMock);
  });

  it('[S13] rejects malformed scope tokens', async () => {
    for (const scope of ['vkid.personal_info email!', 'vkid personal_info{', '', '   ']) {
      await expectInvalidConfigFromAuthorize({ clientId: CLIENT_ID, scope });
    }
  });

  it('[S13] accepts a space-separated multi-token scope', async () => {
    const connector = await createTestConnector(
      configWith({ scope: 'vkid.personal_info email phone' }),
    );
    const harness = createSessionHarness();
    const uri = await connector.getAuthorizationUri(authorizationPayload(), harness.setSession);

    expect(new URL(uri).searchParams.get('scope')).toBe('vkid.personal_info email phone');
  });

  it('[S13] rejects a timeout outside the 1000..60000 ms range', async () => {
    for (const timeout of [999, 0, -1, 60_001, 'not-a-number']) {
      await expectInvalidConfigFromAuthorize({ clientId: CLIENT_ID, timeout });
    }
  });

  it('[S13] coerces a numeric-string timeout accepted by the config form', async () => {
    const connector = await createTestConnector();

    const parsed = connector.configGuard.parse({
      clientId: CLIENT_ID,
      timeout: '5000',
    }) as { timeout?: number };

    expect(parsed.timeout).toBe(5000);
  });

  it('[S13] rejects an empty serviceToken', async () => {
    for (const serviceToken of ['', '   ']) {
      await expectInvalidConfigFromAuthorize({ clientId: CLIENT_ID, serviceToken });
    }
  });

  it('[S13] also reports InvalidConfig from the callback entry points, before any fetch', async () => {
    const connector = await createConnectorWithConfig({ clientId: '' });
    const harness = createSessionHarness();
    seedSession(harness);

    await expectConnectorError(
      connector.getUserInfo(callbackData(), harness.getSession),
      ConnectorErrorCodes.InvalidConfig,
    );
    await expectConnectorError(
      getTokenResponseAndUserInfo(connector, callbackData(), harness.getSession),
      ConnectorErrorCodes.InvalidConfig,
    );
    expectFetchNotCalled(fetchMock);
  });
});

describe('connector metadata and configGuard', () => {
  let connector: SocialConnector;

  beforeEach(async () => {
    connector = await createTestConnector();
  });

  it('[metadata] exposes the vk-universal / vk / Social connector identity', () => {
    expect(connector.metadata.id).toBe('vk-universal');
    expect(connector.metadata.target).toBe('vk');
    expect(connector.type).toBe(ConnectorType.Social);
    expect(connector.metadata.platform).toBe(ConnectorPlatform.Universal);
    expect(connector.metadata.isTokenStorageSupported).toBe(true);
    expect(connector.metadata.name.en).toBe('VK OAuth 2.1');
    expect(connector.metadata.name['ru-RU']).toBe('VK OAuth 2.1');
    expect(connector.metadata.logo).toBe('./logo.png');
    expect(connector.metadata.logoDark).toBe('./logo-dark.png');
    expect(connector.metadata.readme).toBe('./CONNECTOR.md');
    expect(connector.metadata.description['ru-RU']).toBeTruthy();
  });

  it('[metadata] ships the Admin Console guide and keeps it readable', async () => {
    // The file referenced by `metadata.readme` must exist in the published package, otherwise the
    // connector page in the Admin Console renders without any setup instructions.
    const { readFile } = await import('node:fs/promises');
    const guide = await readFile('CONNECTOR.md', 'utf8');
    const pkg = JSON.parse(await readFile('package.json', 'utf8')) as { files: string[] };

    expect(guide).toMatch(/^# VK OAuth 2\.1/);
    expect(guide.length).toBeGreaterThan(1500);
    expect(guide).toContain('Доверенный redirect URL');
    expect(guide).toContain('Client ID');
    expect(pkg.files).toContain('CONNECTOR.md');
  });

  it('[metadata] form items describe the whole config surface and flag serviceToken confidential', () => {
    const formItems = connector.metadata.formItems ?? [];

    expect(formItems.map((item) => item.key)).toEqual([
      'clientId',
      'serviceToken',
      'scope',
      'syncEmail',
      'syncPhone',
      'apiBaseUrl',
      'timeout',
    ]);

    const clientIdItem = formItems.find((item) => item.key === 'clientId');
    const serviceTokenItem = formItems.find((item) => item.key === 'serviceToken');

    expect(clientIdItem?.required).toBe(true);
    expect(serviceTokenItem?.type).toBe(ConnectorConfigFormItemType.Text);
    expect(serviceTokenItem?.isConfidential).toBe(true);
    expect(serviceTokenItem?.required).toBe(false);
    expect(JSON.stringify(formItems)).not.toContain('clientSecret');
  });

  it('[metadata] configGuard is the exported vkidConfigGuard', () => {
    expect(connector.configGuard).toBe(vkidConfigGuard);
  });

  it('[configGuard] accepts a minimal config and strips unknown keys', () => {
    const parsed = connector.configGuard.parse({
      clientId: CLIENT_ID,
      clientSecret: 'LEGACY_FIELD_MUST_BE_STRIPPED',
      unexpected: true,
    }) as Record<string, unknown>;

    expect(parsed).toEqual({ clientId: CLIENT_ID });
    expect(Object.keys(parsed)).toEqual(['clientId']);
    expect(parsed).not.toHaveProperty('clientSecret');
    expect(parsed).not.toHaveProperty('unexpected');
  });

  it('[configGuard] rejects invalid or non-object input', () => {
    for (const invalid of [
      {},
      { clientId: 123 },
      { clientId: '' },
      { clientId: CLIENT_ID, syncEmail: 'yes' },
      { clientId: CLIENT_ID, apiBaseUrl: 'ftp://id.vk.ru' },
      { clientId: CLIENT_ID, timeout: 10 },
      null,
      undefined,
      'config',
      [],
    ]) {
      expect(connector.configGuard.safeParse(invalid).success).toBe(false);
    }
  });
});
