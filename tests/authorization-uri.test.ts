import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SocialConnector } from '@logto/connector-kit';

import { buildAuthorizationUrl } from '../src/client.js';
import type { FetchMock, SessionHarness } from './support.js';
import {
  API_BASE,
  CLIENT_ID,
  DEFAULT_API_BASE,
  REDIRECT_URI,
  SERVICE_TOKEN,
  STATE,
  authorizationPayload,
  authorize,
  configWith,
  createFetchMock,
  createSessionHarness,
  createTestConnector,
  expectFetchNotCalled,
  sha256Challenge,
} from './support.js';

describe('getAuthorizationUri (scenario 2)', () => {
  let fetchMock: FetchMock;
  let connector: SocialConnector;
  let harness: SessionHarness;

  beforeEach(async () => {
    fetchMock = createFetchMock();
    connector = await createTestConnector();
    harness = createSessionHarness();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('[S2] builds the canonical authorize URL with every required OAuth 2.1 + PKCE parameter', async () => {
    const { url } = await authorize(connector, harness);
    const challenge = url.searchParams.get('code_challenge');

    expect(url.origin).toBe(API_BASE);
    expect(url.pathname).toBe('/authorize');
    expect(Object.fromEntries(url.searchParams.entries())).toEqual({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      state: STATE,
      scope: 'vkid.personal_info',
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    expect([...url.searchParams.keys()]).toHaveLength(7);
    expect(challenge).toBe(sha256Challenge(harness.peek().vk_code_verifier ?? ''));
    expectFetchNotCalled(fetchMock);
  });

  it('[S2] defaults to the canonical VK ID API origin (https://id.vk.ru)', async () => {
    const defaultConnector = await createTestConnector({ clientId: CLIENT_ID });
    const defaultHarness = createSessionHarness();
    const uri = await defaultConnector.getAuthorizationUri(
      authorizationPayload(),
      defaultHarness.setSession,
    );
    const url = new URL(uri);

    expect(url.origin).toBe(DEFAULT_API_BASE);
    expect(url.origin).toBe('https://id.vk.ru');
    expect(url.pathname).toBe('/authorize');
  });

  it('[S2] uses vkid.personal_info as the default scope', async () => {
    const { url } = await authorize(connector, harness);

    expect(url.searchParams.get('scope')).toBe('vkid.personal_info');
  });

  it('[S2] lets the connector config override the default scope', async () => {
    const scopedConnector = await createTestConnector(
      configWith({ scope: 'vkid.personal_info email' }),
    );
    const { url } = await authorize(scopedConnector, createSessionHarness());

    expect(url.searchParams.get('scope')).toBe('vkid.personal_info email');
  });

  it('[S2] lets the Logto payload scope win over the configured scope', async () => {
    const scopedConnector = await createTestConnector(
      configWith({ scope: 'vkid.personal_info email' }),
    );
    const { url } = await authorize(scopedConnector, createSessionHarness(), {
      scope: 'email phone',
    });

    expect(url.searchParams.get('scope')).toBe('email phone');
  });

  it('[S2] never puts the service token, verifier or client secret in the browser URL', async () => {
    const confidentialConnector = await createTestConnector(
      configWith({ serviceToken: SERVICE_TOKEN }),
    );
    const { url } = await authorize(confidentialConnector, harness);
    const verifier = harness.peek().vk_code_verifier ?? '';

    expect(url.href).not.toContain(SERVICE_TOKEN);
    expect(url.href).not.toContain(verifier);
    expect(url.searchParams.has('service_token')).toBe(false);
    expect(url.searchParams.has('client_secret')).toBe(false);
    expect(url.searchParams.has('code_verifier')).toBe(false);
  });

  it('[S2] persists exactly the three vk_* session keys, once, bound to the request', async () => {
    const { url, verifier } = await authorize(connector, harness);
    const stored = harness.peek();

    expect(harness.setSession).toHaveBeenCalledTimes(1);
    expect(harness.setSession).toHaveBeenCalledWith({
      vk_code_verifier: verifier,
      vk_redirect_uri: REDIRECT_URI,
      vk_state: STATE,
    });
    expect(Object.keys(stored).sort()).toEqual(['vk_code_verifier', 'vk_redirect_uri', 'vk_state']);
    expect(stored.vk_code_verifier).toBe(verifier);
    expect(stored.vk_redirect_uri).toBe(REDIRECT_URI);
    expect(stored.vk_state).toBe(STATE);
    expect(url.searchParams.get('code_challenge')).toBe(sha256Challenge(verifier));
  });

  it('[S2] strips a trailing slash from the configured apiBaseUrl', async () => {
    const trailingSlashConnector = await createTestConnector(
      configWith({ apiBaseUrl: `${API_BASE}/` }),
    );
    const { url } = await authorize(trailingSlashConnector, createSessionHarness());

    expect(url.href.startsWith(`${API_BASE}/authorize?`)).toBe(true);
    expect(url.href).not.toContain('//authorize');
    expect(url.origin).toBe(API_BASE);
    expect(url.pathname).toBe('/authorize');
  });

  it('[S2] honours an explicit apiBaseUrl override (e.g. https://id.vk.com alias)', async () => {
    const aliasConnector = await createTestConnector(
      configWith({ apiBaseUrl: 'https://id.vk.com' }),
    );
    const { url } = await authorize(aliasConnector, createSessionHarness());

    expect(url.origin).toBe('https://id.vk.com');
    expect(url.pathname).toBe('/authorize');
  });

  it('[S2] round-trips redirect_uri and scope through URL encoding', async () => {
    const redirectUri = 'https://logto.example.com/callback/vk-universal?tenant=acme&next=%2Fapp';
    const { url } = await authorize(connector, harness, {
      redirectUri,
      scope: 'vkid.personal_info email',
    });

    expect(url.searchParams.get('redirect_uri')).toBe(redirectUri);
    expect(url.searchParams.get('scope')).toBe('vkid.personal_info email');
  });

  it('[S2] accepts explicit extra params and lets them override generated ones', () => {
    const uri = buildAuthorizationUrl({
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      state: STATE,
      codeChallenge: 'challenge-value',
      apiBaseUrl: API_BASE,
      extraParams: { prompt: 'login', scope: 'email' },
    });
    const url = new URL(uri);

    expect(url.searchParams.get('prompt')).toBe('login');
    expect(url.searchParams.get('scope')).toBe('email');
    expect(url.searchParams.get('code_challenge')).toBe('challenge-value');
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);

    const defaultOriginUri = buildAuthorizationUrl({
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      state: STATE,
      codeChallenge: 'challenge-value',
    });
    expect(new URL(defaultOriginUri).origin).toBe(DEFAULT_API_BASE);
  });
});
