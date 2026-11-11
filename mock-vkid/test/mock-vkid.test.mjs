/**
 * Smoke tests for mock-vkid. Zero external dependencies: node:test + node:assert
 * + global fetch (Node >= 20). Run with `npm --prefix mock-vkid test`.
 *
 * Each test boots a fresh in-memory server on an ephemeral port, so tests are
 * fully isolated and do not touch the compose stack on port 8090.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { createMockVkidServer, computeS256, configFromEnv } from '../src/server.mjs';

const CLIENT_ID = 'mock-vkid-client-id';
const REDIRECT_URI = 'http://localhost:3001/callback';

function randomVerifier() {
  // 48 random bytes -> 64 base64url chars (valid: 43..128, charset A-Za-z0-9-._~)
  return crypto.randomBytes(48).toString('base64url');
}

async function startServer(overrides = {}) {
  const config = { ...configFromEnv({}), ...overrides };
  const server = createMockVkidServer(config);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  return {
    server,
    base,
    close: () => new Promise((resolve) => server.close(resolve)),
    async fetch(path, init) {
      return fetch(`${base}${path}`, { redirect: 'manual', ...init });
    },
  };
}

/** Runs a test with its own server; the server is always closed afterwards. */
function withServer(overrides, fn) {
  return async (t) => {
    const env = await startServer(overrides);
    t.after(async () => {
      await env.close();
    });
    await fn(env, t);
  };
}

function buildAuthorizeUrl(env, overrides = {}) {
  const verifier = randomVerifier();
  const params = {
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    state: 'state-abc-123',
    code_challenge: computeS256(verifier),
    code_challenge_method: 'S256',
    ...overrides,
  };
  const url = new URL('/authorize', env.base);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    url.searchParams.set(key, String(value));
  }
  return { url, params, verifier };
}

async function authorize(env, overrides = {}) {
  const { url, params, verifier } = buildAuthorizeUrl(env, overrides);
  const res = await fetch(url.toString(), { redirect: 'manual' });
  const location = res.headers.get('location');
  return { res, location, params, verifier };
}

function tokenForm({ code, verifier, deviceId, overrides = {} }) {
  const base = {
    grant_type: 'authorization_code',
    code: code || '',
    code_verifier: verifier || '',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
  };
  // device_id is produced by /authorize; forward exactly what the callback gave
  // us. Tests can still override it explicitly.
  if (deviceId !== null && deviceId !== undefined) base.device_id = deviceId;
  return new URLSearchParams({ ...base, ...overrides });
}

async function postToken(env, form, query = '') {
  return env.fetch(`/oauth2/auth${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
}

async function authorizeCode(env, overrides = {}) {
  const { location, verifier, params } = await authorize(env, overrides);
  assert.ok(location, 'authorize must return a Location header');
  const redirect = new URL(location);
  const code = redirect.searchParams.get('code');
  const deviceId = redirect.searchParams.get('device_id');
  return { location, verifier, params, code, deviceId };
}

async function obtainToken(
  env,
  { authorizeOverrides = {}, tokenQuery = '', tokenOverrides = {} } = {},
) {
  const { code, verifier, deviceId } = await authorizeCode(env, authorizeOverrides);
  const res = await postToken(
    env,
    tokenForm({ code, verifier, deviceId, overrides: tokenOverrides }),
    tokenQuery,
  );
  let body = null;
  try {
    body = await res.clone().json();
  } catch {
    body = null;
  }
  return { res, body, code, verifier, deviceId };
}

// ---------------------------------------------------------------------------
// 1. Infrastructure / health
// ---------------------------------------------------------------------------

test(
  'GET /health returns 200 ok',
  withServer({}, async (env) => {
    const res = await env.fetch('/health');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'mock-vkid');
  }),
);

test(
  'GET / returns 200 with the endpoint map',
  withServer({}, async (env) => {
    const res = await env.fetch('/');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.match(body.endpoints.authorize, /\/authorize/);
    assert.ok(Array.isArray(body.mock_modes) && body.mock_modes.length > 0);
  }),
);

test(
  'unknown route returns 404',
  withServer({}, async (env) => {
    const res = await env.fetch('/nope');
    assert.equal(res.status, 404);
  }),
);

// ---------------------------------------------------------------------------
// 2. PKCE S256 primitive (RFC 7636 Appendix B test vector)
// ---------------------------------------------------------------------------

test('computeS256 matches the RFC 7636 test vector', () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const expected = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
  assert.equal(computeS256(verifier), expected);
});

// ---------------------------------------------------------------------------
// 3. /authorize happy path and validation
// ---------------------------------------------------------------------------

test(
  'authorize succeeds, redirects with code+state+device_id+type',
  withServer({}, async (env) => {
    const { res, location } = await authorize(env);
    assert.equal(res.status, 302);
    const redirect = new URL(location);
    assert.equal(`${redirect.origin}${redirect.pathname}`, REDIRECT_URI);
    // Real VK ID codes look like vk2.a.<opaque>.
    assert.match(redirect.searchParams.get('code'), /^vk2\.a\./);
    assert.equal(redirect.searchParams.get('state'), 'state-abc-123');
    // device_id is PRODUCED by the provider (it is not an authorize parameter).
    const deviceId = redirect.searchParams.get('device_id');
    assert.ok(deviceId && deviceId.startsWith('vk-dev-'), 'server-generated device_id expected');
    assert.equal(redirect.searchParams.get('type'), 'code_v2');
  }),
);

test(
  'authorize rejects an unregistered redirect_uri with 400 (no redirect)',
  withServer({}, async (env) => {
    const { res, location } = await authorize(env, {
      redirect_uri: 'http://evil.example/callback',
    });
    assert.equal(res.status, 400);
    assert.equal(location, null);
    const body = await res.json();
    assert.equal(body.error, 'invalid_request');
  }),
);

test(
  'authorize redirects unsupported response_type as an error',
  withServer({}, async (env) => {
    const { res, location } = await authorize(env, { response_type: 'token' });
    assert.equal(res.status, 302);
    const redirect = new URL(location);
    assert.equal(redirect.searchParams.get('error'), 'unsupported_response_type');
  }),
);

test(
  'redirect_uri wildcard entry accepts the dynamic Logto callback path',
  withServer({ redirectUris: ['http://localhost:3001/callback/*'] }, async (env) => {
    const { res, location } = await authorize(env, {
      redirect_uri: 'http://localhost:3001/callback/vk-universal',
    });
    assert.equal(res.status, 302);
    const redirect = new URL(location);
    assert.equal(
      `${redirect.origin}${redirect.pathname}`,
      'http://localhost:3001/callback/vk-universal',
    );
    assert.ok(redirect.searchParams.get('code'));
  }),
);

test(
  'redirect_uri wildcard entry still rejects a different origin',
  withServer({ redirectUris: ['http://localhost:3001/callback/*'] }, async (env) => {
    const { res, location } = await authorize(env, {
      redirect_uri: 'http://evil.example/callback/vk-universal',
    });
    assert.equal(res.status, 400);
    assert.equal(location, null);
  }),
);

test(
  'authorize redirects unknown client_id as unauthorized_client',
  withServer({}, async (env) => {
    const { location } = await authorize(env, { client_id: 'someone-else' });
    const redirect = new URL(location);
    assert.equal(redirect.searchParams.get('error'), 'unauthorized_client');
  }),
);

test(
  'authorize rejects a missing code_challenge',
  withServer({}, async (env) => {
    const { location } = await authorize(env, { code_challenge: undefined });
    const redirect = new URL(location);
    assert.equal(redirect.searchParams.get('error'), 'invalid_request');
    assert.match(redirect.searchParams.get('error_description'), /code_challenge/);
  }),
);

test(
  'authorize rejects code_challenge_method=plain',
  withServer({}, async (env) => {
    const { location } = await authorize(env, { code_challenge_method: 'plain' });
    const redirect = new URL(location);
    assert.equal(redirect.searchParams.get('error'), 'invalid_request');
    assert.match(redirect.searchParams.get('error_description'), /S256/);
  }),
);

test(
  'authorize rejects a malformed S256 challenge (wrong length)',
  withServer({}, async (env) => {
    const { location } = await authorize(env, { code_challenge: 'too-short' });
    const redirect = new URL(location);
    assert.equal(redirect.searchParams.get('error'), 'invalid_request');
    assert.match(redirect.searchParams.get('error_description'), /43/);
  }),
);

test(
  'authorize rejects a missing state',
  withServer({}, async (env) => {
    const { location } = await authorize(env, { state: undefined });
    const redirect = new URL(location);
    assert.equal(redirect.searchParams.get('error'), 'invalid_request');
    assert.match(redirect.searchParams.get('error_description'), /state/);
  }),
);

test(
  'authorize failure mode: mock_error=access_denied',
  withServer({}, async (env) => {
    const { res, location } = await authorize(env, {
      mock_error: 'access_denied',
      state: 'keep-me',
    });
    assert.equal(res.status, 302);
    const redirect = new URL(location);
    assert.equal(redirect.searchParams.get('error'), 'access_denied');
    assert.ok(redirect.searchParams.get('error_description'));
    assert.equal(redirect.searchParams.get('state'), 'keep-me');
    assert.equal(redirect.searchParams.get('code'), null);
  }),
);

test(
  'authorize failure mode: mock_no_device_id omits device_id and the token does not require it',
  withServer({}, async (env) => {
    const { location, verifier } = await authorize(env, { mock_no_device_id: '1' });
    const redirect = new URL(location);
    assert.equal(redirect.searchParams.get('device_id'), null);
    const code = redirect.searchParams.get('code');
    const res = await postToken(env, tokenForm({ code, verifier }));
    assert.equal(res.status, 200);
  }),
);

test(
  'authorize failure mode: mock_authorize_status=500',
  withServer({}, async (env) => {
    const { res } = await authorize(env, { mock_authorize_status: '500' });
    assert.equal(res.status, 500);
  }),
);

test(
  'authorize failure mode: mock_slow=1 delays longer than the configured slowMs',
  withServer({ slowMs: 120 }, async (env) => {
    const started = Date.now();
    await authorize(env, { mock_slow: '1' });
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 100, `expected >= 100ms delay, got ${elapsed}ms`);
  }),
);

// ---------------------------------------------------------------------------
// 4. /oauth2/auth token endpoint
// ---------------------------------------------------------------------------

test(
  'token exchange returns a complete VK ID style payload',
  withServer({}, async (env) => {
    const { res, body } = await obtainToken(env);
    assert.equal(res.status, 200);
    assert.equal(typeof body.access_token, 'string');
    assert.ok(body.access_token.length >= 32);
    assert.equal(typeof body.refresh_token, 'string');
    assert.equal(typeof body.id_token, 'string');
    assert.equal(body.id_token.split('.').length, 3, 'id_token must be a 3-part JWT');
    assert.equal(body.token_type, 'Bearer');
    assert.equal(typeof body.expires_in, 'number');
    // VK ID returns user_id as a NUMBER at the token endpoint.
    assert.equal(body.user_id, 1001);
    assert.equal(typeof body.user_id, 'number');
    // VK ID's default scope is vkid.personal_info, not email.
    assert.equal(body.scope, 'vkid.personal_info');
    assert.equal(body.state, 'state-abc-123');

    // The id_token uses VK's proprietary claims (iis/sub/app/jti), not OIDC.
    const claims = JSON.parse(
      Buffer.from(body.id_token.split('.')[1], 'base64url').toString('utf8'),
    );
    assert.equal(claims.iis, 'VK');
    assert.equal(claims.jti, 21);
    assert.equal(claims.sub, 1001);
    assert.equal(claims.app, CLIENT_ID);
  }),
);

test(
  'token response user_id is numeric while user_info user_id is a string',
  withServer({}, async (env) => {
    const { body: token } = await obtainToken(env);
    assert.equal(typeof token.user_id, 'number');
    const res = await env.fetch('/oauth2/user_info', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ access_token: token.access_token }).toString(),
    });
    const { user } = await res.json();
    assert.equal(typeof user.user_id, 'string');
    assert.equal(user.user_id, String(token.user_id));
  }),
);

test(
  'token endpoint verifies PKCE: wrong verifier -> 400 invalid_grant',
  withServer({}, async (env) => {
    const { code, deviceId } = await authorizeCode(env);
    const res = await postToken(env, tokenForm({ code, verifier: randomVerifier(), deviceId }));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'invalid_grant');
    assert.match(body.error_description, /PKCE/);
  }),
);

test(
  'token endpoint requires code_verifier',
  withServer({}, async (env) => {
    const { code, deviceId } = await authorizeCode(env);
    const res = await postToken(env, tokenForm({ code, verifier: '', deviceId }));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'invalid_request');
    assert.match(body.error_description, /code_verifier/);
  }),
);

test(
  'authorization codes are single use',
  withServer({}, async (env) => {
    const { code, verifier, deviceId } = await authorizeCode(env);
    const first = await postToken(env, tokenForm({ code, verifier, deviceId }));
    assert.equal(first.status, 200);
    const second = await postToken(env, tokenForm({ code, verifier, deviceId }));
    assert.equal(second.status, 400);
    const body = await second.json();
    assert.equal(body.error, 'invalid_grant');
  }),
);

test(
  'concurrent redemption of the same code yields exactly one success',
  withServer({}, async (env) => {
    const { code, verifier, deviceId } = await authorizeCode(env);
    const [a, b] = await Promise.all([
      postToken(env, tokenForm({ code, verifier, deviceId })),
      postToken(env, tokenForm({ code, verifier, deviceId })),
    ]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [200, 400]);
  }),
);

test(
  'token endpoint rejects a wrong grant_type',
  withServer({}, async (env) => {
    const res = await postToken(
      env,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: CLIENT_ID,
      }),
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'unsupported_grant_type');
  }),
);

test(
  'token endpoint rejects a wrong client_id',
  withServer({}, async (env) => {
    const { code, verifier, deviceId } = await authorizeCode(env);
    const res = await postToken(
      env,
      tokenForm({ code, verifier, deviceId, overrides: { client_id: 'other-client' } }),
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'invalid_client');
  }),
);

test(
  'token endpoint rejects a redirect_uri mismatch',
  withServer({}, async (env) => {
    const { code, verifier, deviceId } = await authorizeCode(env);
    const res = await postToken(
      env,
      tokenForm({
        code,
        verifier,
        deviceId,
        overrides: { redirect_uri: 'http://localhost:3001/callback/other' },
      }),
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'invalid_grant');
    assert.match(body.error_description, /redirect_uri/);
  }),
);

test(
  'token endpoint rejects a device_id mismatch',
  withServer({}, async (env) => {
    const { code, verifier, deviceId } = await authorizeCode(env);
    const res = await postToken(
      env,
      tokenForm({ code, verifier, deviceId, overrides: { device_id: 'wrong-device' } }),
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'invalid_grant');
    assert.match(body.error_description, /device_id/);
  }),
);

test(
  'token failure mode: mock_bad_pkce rejects even a correct verifier',
  withServer({}, async (env) => {
    const { res, body } = await obtainToken(env, { authorizeOverrides: { mock_bad_pkce: '1' } });
    assert.equal(res.status, 400);
    assert.equal(body.error, 'invalid_grant');
  }),
);

test(
  'token failure mode: forced HTTP 500',
  withServer({}, async (env) => {
    const { res } = await obtainToken(env, { authorizeOverrides: { mock_token_mode: 'http_500' } });
    assert.equal(res.status, 500);
  }),
);

test(
  'token failure mode: forced HTTP 400',
  withServer({}, async (env) => {
    const { res, body } = await obtainToken(env, {
      authorizeOverrides: { mock_token_mode: 'http_400' },
    });
    assert.equal(res.status, 400);
    assert.equal(body.error, 'invalid_request');
  }),
);

test(
  'token failure mode: invalid JSON body',
  withServer({}, async (env) => {
    const { res } = await obtainToken(env, {
      authorizeOverrides: { mock_token_mode: 'invalid_json' },
    });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.throws(() => JSON.parse(text), /Unexpected|JSON/i);
  }),
);

test(
  'token failure mode: missing_refresh_token omits only that field',
  withServer({}, async (env) => {
    const { res, body } = await obtainToken(env, {
      authorizeOverrides: { mock_token_mode: 'missing_refresh_token' },
    });
    assert.equal(res.status, 200);
    assert.equal('refresh_token' in body, false);
    assert.equal(typeof body.access_token, 'string');
  }),
);

test(
  'token failure mode: empty payload',
  withServer({}, async (env) => {
    const { res, body } = await obtainToken(env, {
      authorizeOverrides: { mock_token_mode: 'empty' },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(body, {});
  }),
);

test(
  'token endpoint supports grant_type=refresh_token',
  withServer({}, async (env) => {
    const { body: first } = await obtainToken(env);
    const res = await postToken(
      env,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: first.refresh_token,
        client_id: CLIENT_ID,
      }),
    );
    assert.equal(res.status, 200);
    const refreshed = await res.json();
    assert.equal(typeof refreshed.access_token, 'string');
    assert.notEqual(refreshed.access_token, first.access_token);
  }),
);

// ---------------------------------------------------------------------------
// 5. /oauth2/user_info
// ---------------------------------------------------------------------------

test(
  'user_info returns the VK ID user shape',
  withServer({}, async (env) => {
    const { body: token } = await obtainToken(env);
    const res = await env.fetch('/oauth2/user_info', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        access_token: token.access_token,
        client_id: CLIENT_ID,
      }).toString(),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    const user = body.user;
    assert.equal(user.user_id, '1001');
    assert.equal(user.first_name, 'Ivan');
    assert.equal(user.last_name, 'Petrov');
    assert.match(user.avatar, /^https:\/\/pp\.userapi\.com\//);
    assert.equal(user.email, 'ivan.petrov@example.com');
    // VK returns 11 digits, leading 7, no '+' and no separators.
    assert.equal(user.phone, '79991234567');
    assert.equal(user.sex, 2);
    assert.equal(user.verified, false);
    // VK formats birthday as DD.MM.YYYY.
    assert.equal(user.birthday, '01.01.2000');
  }),
);

test(
  'user_info accepts Authorization: Bearer',
  withServer({}, async (env) => {
    const { body: token } = await obtainToken(env);
    const res = await env.fetch('/oauth2/user_info', {
      method: 'POST',
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    assert.equal(res.status, 200);
  }),
);

test(
  'user_info without a token returns 401',
  withServer({}, async (env) => {
    const res = await env.fetch('/oauth2/user_info', { method: 'POST' });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, 'invalid_token');
  }),
);

test(
  'user_info with an unknown token returns 401',
  withServer({}, async (env) => {
    const res = await env.fetch('/oauth2/user_info', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ access_token: 'not-a-real-token' }).toString(),
    });
    assert.equal(res.status, 401);
  }),
);

async function userInfoWithMode(env, mode) {
  const { body: token } = await obtainToken(env, { authorizeOverrides: { mock_user_mode: mode } });
  const res = await env.fetch('/oauth2/user_info', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ access_token: token.access_token }).toString(),
  });
  return res;
}

test(
  'user_info failure mode: missing_email',
  withServer({}, async (env) => {
    const res = await userInfoWithMode(env, 'missing_email');
    assert.equal(res.status, 200);
    const { user } = await res.json();
    assert.equal('email' in user, false);
    assert.equal(user.user_id, '1001');
  }),
);

test(
  'user_info failure mode: missing_avatar',
  withServer({}, async (env) => {
    const res = await userInfoWithMode(env, 'missing_avatar');
    const { user } = await res.json();
    assert.equal('avatar' in user, false);
  }),
);

test(
  'user_info failure mode: empty_strings',
  withServer({}, async (env) => {
    const res = await userInfoWithMode(env, 'empty_strings');
    const { user } = await res.json();
    assert.equal(user.first_name, '');
    assert.equal(user.email, '');
    assert.equal(user.avatar, '');
  }),
);

test(
  'user_info failure mode: null_fields',
  withServer({}, async (env) => {
    const res = await userInfoWithMode(env, 'null_fields');
    const { user } = await res.json();
    assert.equal(user.user_id, null);
    assert.equal(user.email, null);
    assert.equal(user.avatar, null);
    assert.equal(user.sex, null);
  }),
);

test(
  'user_info failure mode: invalid JSON body',
  withServer({}, async (env) => {
    const res = await userInfoWithMode(env, 'invalid_json');
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.throws(() => JSON.parse(text), /Unexpected|JSON/i);
  }),
);

test(
  'user_info failure mode: forced HTTP 500',
  withServer({}, async (env) => {
    const res = await userInfoWithMode(env, 'http_500');
    assert.equal(res.status, 500);
  }),
);

test(
  'user_info failure mode: forced HTTP 401',
  withServer({}, async (env) => {
    const res = await userInfoWithMode(env, 'http_401');
    assert.equal(res.status, 401);
  }),
);

// ---------------------------------------------------------------------------
// 6. Introspection endpoints used by integration assertions
// ---------------------------------------------------------------------------

test(
  'GET /debug/state records requests and redacts secrets',
  withServer({}, async (env) => {
    const { body: token } = await obtainToken(env);
    const res = await env.fetch('/debug/state');
    assert.equal(res.status, 200);
    const state = await res.json();
    assert.ok(state.requests.length >= 2, 'authorize + token must be recorded');
    assert.equal(state.counters.authorize, 1);
    assert.equal(state.counters.token, 1);
    assert.equal(state.counters.codesIssued, 1);
    assert.equal(state.active_access_tokens, 1);
    const serialized = JSON.stringify(state);
    assert.equal(serialized.includes(token.access_token), false, 'access_token must be redacted');
    assert.equal(serialized.includes(token.refresh_token), false, 'refresh_token must be redacted');
  }),
);

test(
  'POST /debug/reset clears in-memory state',
  withServer({}, async (env) => {
    await obtainToken(env);
    const reset = await env.fetch('/debug/reset', { method: 'POST' });
    assert.equal(reset.status, 200);
    const state = await (await env.fetch('/debug/state')).json();
    assert.equal(state.counters.authorize, 0);
    assert.equal(state.counters.token, 0);
    assert.equal(state.requests.length, 0);
    assert.equal(state.active_access_tokens, 0);
  }),
);
