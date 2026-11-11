/**
 * mock-vkid - a dependency-free mock of the modern VK ID OAuth 2.1 provider.
 *
 * Zero npm dependencies, Node.js >= 20, ESM. Everything is kept in memory.
 * The server never performs network egress and never writes files.
 *
 * Protocol implemented (VK ID / "modern" OAuth 2.1 flow):
 *   GET  /authorize        -> validates request, PKCE S256 challenge, issues one-time code
 *   POST /oauth2/auth      -> token endpoint (application/x-www-form-urlencoded)
 *   POST /oauth2/user_info -> user profile for an access token
 *   GET  /health           -> liveness probe
 *   GET  /debug/state      -> recorded requests (secrets redacted)
 *   POST /debug/reset      -> clears in-memory state
 *
 * See mock-vkid/README.md for the env-var contract.
 */

import http from 'node:http';
import crypto from 'node:crypto';

export const PKCE_CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;
export const PKCE_VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;

const DEFAULT_REDIRECT_URIS = [
  'http://localhost:3001/callback',
  'http://localhost:3001/callback/vkid',
  'http://localhost:3001/callback/mock-vkid',
  'http://127.0.0.1:3001/callback',
  // Logto builds the social callback path from the connector's database id
  // (http://localhost:3001/callback/<connector-id>), so the compose harness
  // allowlists the whole prefix instead of a single fixed path.
  'http://localhost:3001/callback/*',
];

const DEFAULT_USER = Object.freeze({
  user_id: '1001',
  first_name: 'Ivan',
  last_name: 'Petrov',
  avatar: 'https://pp.userapi.com/mock-vkid/avatar-1001.png',
  email: 'ivan.petrov@example.com',
  // VK ID returns 11 digits, leading 7, no '+' and no separators.
  phone: '79991234567',
  // VK ID encodes sex as 0 (unknown) / 1 (female) / 2 (male).
  sex: 2,
  verified: false,
  // VK ID formats birthday as DD.MM.YYYY.
  birthday: '01.01.2000',
});

/** VK ID issues scopes as a space-separated list; this is the default one. */
const DEFAULT_SCOPE = 'vkid.personal_info';

const VALID_AUTHORIZE_ERRORS = new Set([
  'access_denied',
  'invalid_request',
  'invalid_client',
  'invalid_scope',
  'unauthorized_client',
  'unsupported_response_type',
  'server_error',
  'temporarily_unavailable',
]);

/** Base64url encoding helper. */
export function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

/** RFC 7636 S256: BASE64URL(SHA256(ASCII(code_verifier))) */
export function computeS256(codeVerifier) {
  return b64url(crypto.createHash('sha256').update(codeVerifier, 'ascii').digest());
}

/** Random url-safe token. */
export function randomToken(bytes = 32) {
  return b64url(crypto.randomBytes(bytes));
}

/** Constant-time string comparison without throwing on length mismatch. */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function firstOf(value) {
  return Array.isArray(value) ? value[0] : value;
}

/** VK ID: token endpoint user_id is a number, user_info user_id is a string. */
function toNumericUserId(userId) {
  const numeric = Number(userId);
  return Number.isFinite(numeric) && String(numeric) === String(userId) ? numeric : String(userId);
}

/** URLSearchParams lookup that returns undefined instead of null. */
function getParam(params, name) {
  if (!params.has(name)) return undefined;
  const value = params.get(name);
  return value === null ? undefined : value;
}

function parseList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function parseIntSafe(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Build a config object. Reads MOCK_VKID_* env vars, but every field can also
 * be passed explicitly (used by the smoke tests).
 */
export function configFromEnv(env = process.env) {
  const user = { ...DEFAULT_USER };
  if (env.MOCK_VKID_USER_JSON) {
    try {
      Object.assign(user, JSON.parse(env.MOCK_VKID_USER_JSON));
    } catch {
      // A malformed user override must not take the mock down; keep defaults.
    }
  }
  const clientIds = parseList(env.MOCK_VKID_CLIENT_IDS || env.MOCK_VKID_CLIENT_ID);
  const redirectUris = parseList(env.MOCK_VKID_REDIRECT_URIS);
  return {
    host: env.MOCK_VKID_HOST || '0.0.0.0',
    port: parseIntSafe(env.MOCK_VKID_PORT, 8090),
    clientIds: clientIds.length > 0 ? clientIds : ['mock-vkid-client-id'],
    clientSecret: env.MOCK_VKID_CLIENT_SECRET || null,
    redirectUris: redirectUris.length > 0 ? redirectUris : [...DEFAULT_REDIRECT_URIS],
    allowAnyRedirect: parseBoolean(env.MOCK_VKID_ALLOW_ANY_REDIRECT, false),
    requireState: !parseBoolean(env.MOCK_VKID_STATE_OPTIONAL, false),
    requireDeviceId: !parseBoolean(env.MOCK_VKID_DEVICE_ID_OPTIONAL, false),
    slowMs: parseIntSafe(env.MOCK_VKID_SLOW_MS, 30000),
    tokenMode: env.MOCK_VKID_TOKEN_MODE || null,
    userMode: env.MOCK_VKID_USER_MODE || null,
    logRequests: parseBoolean(env.MOCK_VKID_LOG_REQUESTS, true),
    authCodeTtlMs: parseIntSafe(env.MOCK_VKID_AUTH_CODE_TTL_MS, 5 * 60 * 1000),
    accessTokenTtlSeconds: parseIntSafe(env.MOCK_VKID_ACCESS_TOKEN_TTL_SECONDS, 3600),
    user,
  };
}

const MODE_KEYS = [
  'mock_error',
  'mock_error_description',
  'mock_authorize_status',
  'mock_no_device_id',
  'mock_no_state',
  'mock_bad_pkce',
  'mock_slow',
  'mock_token_mode',
  'mock_user_mode',
];

/** Pull the mock-* control parameters out of any parameter bag. */
function extractModes(params) {
  const modes = {};
  for (const key of MODE_KEYS) {
    const value = params.get(key);
    if (value !== undefined && value !== null && value !== '') modes[key] = String(value);
  }
  return modes;
}

function isTruthyFlag(value) {
  if (value === undefined || value === null) return false;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

const TOKEN_MODES = new Set([
  'http_400',
  'http_401',
  'http_500',
  'invalid_json',
  'empty',
  'missing_access_token',
  'missing_refresh_token',
  'missing_id_token',
  'missing_user_id',
  'missing_scope',
  'missing_state',
  'missing_expires_in',
]);

const USER_MODES = new Set([
  'http_500',
  'http_401',
  'invalid_json',
  'missing_email',
  'missing_avatar',
  'missing_phone',
  'missing_birthday',
  'missing_first_name',
  'missing_last_name',
  'missing_user_id',
  'empty_strings',
  'null_fields',
  'empty_user',
]);

const SENSITIVE_KEY_RE = /(token|code|secret|password|verifier)/i;

/** Redact anything that looks like a credential before recording it. */
function redactObject(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj || {})) {
    if (SENSITIVE_KEY_RE.test(key)) {
      out[key] = value ? '<redacted>' : value;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = redactObject(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

const HEADER_ALLOWLIST = [
  'content-type',
  'accept',
  'authorization',
  'user-agent',
  'x-forwarded-for',
];

function redactHeaders(headers) {
  const out = {};
  for (const name of HEADER_ALLOWLIST) {
    const value = headers[name];
    if (value === undefined) continue;
    out[name] = name === 'authorization' ? '<redacted>' : String(value);
  }
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jsonBody(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function textBody(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function redirectTo(res, location) {
  res.writeHead(302, {
    location,
    'cache-control': 'no-store',
    'content-length': '0',
  });
  res.end();
}

function readRawBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('request body too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Parse parameters from a request. Accepts form-urlencoded (what VK ID and the
 * connector use), JSON, and query strings; the query string always wins for
 * `mock_*` control flags (handy for tests), form/body wins otherwise.
 */
function collectParams(req, url, rawBody) {
  const params = new URLSearchParams(url.searchParams);
  if (rawBody) {
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (contentType.includes('application/json')) {
      try {
        const parsed = JSON.parse(rawBody);
        if (parsed && typeof parsed === 'object') {
          for (const [key, value] of Object.entries(parsed)) {
            if (!params.has(key)) params.set(key, String(value));
          }
        }
      } catch {
        // Leave the raw body alone; handlers decide what to do.
      }
    } else {
      const form = new URLSearchParams(rawBody);
      for (const [key, value] of form.entries()) {
        if (!params.has(key)) params.set(key, value);
      }
    }
  }
  return params;
}

function buildRedirectUri(redirectUri, params) {
  const target = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    target.searchParams.set(key, String(value));
  }
  return target.toString();
}

/**
 * Create (but do not start) the mock VK ID server.
 * @param {ReturnType<typeof configFromEnv>|object} config
 */
export function createMockVkidServer(config = configFromEnv()) {
  const cfg = {
    ...configFromEnv(),
    ...config,
    clientIds: config.clientIds || configFromEnv().clientIds,
    redirectUris: config.redirectUris || configFromEnv().redirectUris,
    user: { ...DEFAULT_USER, ...(config.user || {}) },
  };

  /** code -> pending authorization record */
  const pendingCodes = new Map();
  /** access_token -> token record */
  const accessTokens = new Map();
  /** refresh_token -> token record */
  const refreshTokens = new Map();
  /** ISO strings + redacted request log */
  const requestLog = [];
  const counters = { authorize: 0, token: 0, userInfo: 0, rejected: 0, codesIssued: 0 };

  function record(entry) {
    if (!cfg.logRequests) return;
    requestLog.push({ ts: new Date().toISOString(), ...entry });
    if (requestLog.length > 200) requestLog.splice(0, requestLog.length - 200);
  }

  function findOrCreateUserId(params) {
    const requested = getParam(params, 'user_id');
    if (requested) return String(requested);
    return String(cfg.user.user_id ?? '1001');
  }

  function normalizeRedirectUri(value) {
    // Accept the exact allowlisted form, and also tolerate a single trailing
    // slash difference (very common when users copy redirect URIs around).
    const candidate = String(value || '');
    const allow = cfg.redirectUris || [];
    if (allow.includes(candidate)) return candidate;
    if (candidate.endsWith('/') && allow.includes(candidate.slice(0, -1)))
      return candidate.slice(0, -1);
    if (allow.includes(`${candidate}/`)) return `${candidate}/`;

    // Wildcard entries pin scheme + host + path prefix and allow any tail, e.g.
    // "http://localhost:3001/callback/*". The compose harness needs this because
    // Logto derives the callback path from the dynamically assigned connector id.
    let candidateUrl;
    try {
      candidateUrl = new URL(candidate);
    } catch {
      return null;
    }
    for (const entry of allow) {
      if (!entry.endsWith('*')) continue;
      try {
        const prefixUrl = new URL(entry.slice(0, -1));
        const prefixPath = `${prefixUrl.pathname.replace(/\/+$/, '')}/`;
        if (
          candidateUrl.origin === prefixUrl.origin &&
          candidateUrl.pathname.startsWith(prefixPath)
        ) {
          return candidate;
        }
      } catch {
        // Ignore malformed allowlist entries; the next entry may match.
      }
    }
    return null;
  }

  function makeIdToken({ userId, clientId }) {
    const now = Math.floor(Date.now() / 1000);
    // VK ID does not issue OIDC claims: it uses iis/sub/app/jti (see
    // docs/research/VK-ID-PROTOCOL.md section 7). Emulate that shape.
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'mock-vkid-key-1' }));
    const payload = b64url(
      JSON.stringify({
        iis: 'VK',
        sub: Number.isFinite(Number(userId)) ? Number(userId) : String(userId),
        app: clientId,
        iat: now,
        exp: now + 3600,
        jti: 21,
      }),
    );
    // The mock does not sign with a real key; the signature segment is a
    // placeholder so consumers that only decode/split the JWT still work.
    const signature = b64url(crypto.createHash('sha256').update(`${header}.${payload}`).digest());
    return `${header}.${payload}.${signature}`;
  }

  function issueAuthorizationCode(params, modes, redirectUri, deviceId, requireDeviceId) {
    // Real VK ID codes look like "vk2.a.<opaque>".
    const code = `vk2.a.${randomToken(24)}`;
    const now = Date.now();
    pendingCodes.set(code, {
      clientId: String(getParam(params, 'client_id') || ''),
      redirectUri,
      codeChallenge: String(getParam(params, 'code_challenge') || ''),
      codeChallengeMethod: String(getParam(params, 'code_challenge_method') || ''),
      state: params.has('state') ? String(getParam(params, 'state')) : null,
      scope: String(getParam(params, 'scope') || DEFAULT_SCOPE),
      deviceId,
      requireDeviceId,
      userId: findOrCreateUserId(params),
      mockTokenMode: modes.mock_token_mode || null,
      mockUserMode: modes.mock_user_mode || null,
      mockBadPkce: isTruthyFlag(modes.mock_bad_pkce),
      createdAt: now,
      expiresAt: now + cfg.authCodeTtlMs,
      used: false,
    });
    counters.codesIssued += 1;
    return code;
  }

  function consumeAuthorizationCode(code) {
    const record = pendingCodes.get(code);
    if (!record)
      return {
        error: 'invalid_grant',
        description: 'Authorization code not found or already used',
      };
    // Single use: burn it before any further validation.
    pendingCodes.delete(code);
    record.used = true;
    if (Date.now() > record.expiresAt) {
      counters.rejected += 1;
      return { error: 'invalid_grant', description: 'Authorization code expired' };
    }
    return { record };
  }

  function applyUserMode(mode, baseUser) {
    const user = { ...baseUser };
    switch (mode) {
      case 'missing_email':
        delete user.email;
        break;
      case 'missing_avatar':
        delete user.avatar;
        break;
      case 'missing_phone':
        delete user.phone;
        break;
      case 'missing_birthday':
        delete user.birthday;
        break;
      case 'missing_first_name':
        delete user.first_name;
        break;
      case 'missing_last_name':
        delete user.last_name;
        break;
      case 'missing_user_id':
        delete user.user_id;
        break;
      case 'empty_strings':
        for (const key of Object.keys(user)) {
          if (typeof user[key] === 'string') user[key] = '';
        }
        break;
      case 'null_fields':
        for (const key of Object.keys(user)) user[key] = null;
        break;
      case 'empty_user':
        for (const key of Object.keys(user)) delete user[key];
        break;
      default:
        break;
    }
    return user;
  }

  function handleTokenMode(mode, res, payload) {
    switch (mode) {
      case 'http_400':
        jsonBody(res, 400, {
          error: 'invalid_request',
          error_description: 'mock-vkid: forced 400',
        });
        return true;
      case 'http_401':
        jsonBody(res, 401, { error: 'invalid_client', error_description: 'mock-vkid: forced 401' });
        return true;
      case 'http_500':
        jsonBody(res, 500, { error: 'server_error', error_description: 'mock-vkid: forced 500' });
        return true;
      case 'invalid_json': {
        const broken = '{"access_token": "this-is-not-valid-json"'; // deliberately truncated
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'content-length': Buffer.byteLength(broken),
          'cache-control': 'no-store',
        });
        res.end(broken);
        return true;
      }
      case 'empty':
        jsonBody(res, 200, {});
        return true;
      case 'missing_access_token':
        delete payload.access_token;
        break;
      case 'missing_refresh_token':
        delete payload.refresh_token;
        break;
      case 'missing_id_token':
        delete payload.id_token;
        break;
      case 'missing_user_id':
        delete payload.user_id;
        break;
      case 'missing_scope':
        delete payload.scope;
        break;
      case 'missing_state':
        delete payload.state;
        break;
      case 'missing_expires_in':
        delete payload.expires_in;
        break;
      default:
        return false;
    }
    return false;
  }

  function handleUserInfoMode(mode, res, user) {
    switch (mode) {
      case 'http_500':
        jsonBody(res, 500, { error: 'server_error', error_description: 'mock-vkid: forced 500' });
        return true;
      case 'http_401':
        jsonBody(res, 401, { error: 'invalid_token', error_description: 'mock-vkid: forced 401' });
        return true;
      case 'invalid_json': {
        const broken = '{"user": {"user_id": "1001"'; // deliberately truncated
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'content-length': Buffer.byteLength(broken),
          'cache-control': 'no-store',
        });
        res.end(broken);
        return true;
      }
      default:
        return false;
    }
  }

  async function handleAuthorize(req, res, url) {
    counters.authorize += 1;
    const rawBody = req.method === 'POST' ? await readRawBody(req).catch(() => '') : '';
    const params = collectParams(req, url, rawBody);
    const modes = extractModes(params);
    const redirectUriParam = String(getParam(params, 'redirect_uri') || '');

    if (isTruthyFlag(modes.mock_slow)) {
      await sleep(cfg.slowMs);
    }

    if (modes.mock_authorize_status) {
      const status = parseIntSafe(modes.mock_authorize_status, 500);
      record({
        kind: 'authorize',
        outcome: { status, error: 'mock_authorize_status' },
        mock: modes,
      });
      textBody(
        res,
        status,
        `mock-vkid: forced ${status} at /authorize`,
        'text/plain; charset=utf-8',
      );
      return;
    }

    const resolvedRedirect = normalizeRedirectUri(redirectUriParam);
    if (!resolvedRedirect && !cfg.allowAnyRedirect) {
      counters.rejected += 1;
      record({
        kind: 'authorize',
        outcome: { status: 400, error: 'redirect_uri_not_allowed' },
        mock: modes,
      });
      jsonBody(res, 400, {
        error: 'invalid_request',
        error_description: `redirect_uri is not registered on this mock provider: ${redirectUriParam}`,
        allowed_redirect_uris: cfg.redirectUris,
      });
      return;
    }
    const redirectUri = resolvedRedirect || redirectUriParam;

    const stateEcho =
      params.has('state') && !isTruthyFlag(modes.mock_no_state)
        ? String(getParam(params, 'state'))
        : null;

    if (modes.mock_error) {
      const error = VALID_AUTHORIZE_ERRORS.has(modes.mock_error)
        ? modes.mock_error
        : 'server_error';
      const errorDescription = modes.mock_error_description || `mock-vkid: forced ${error}`;
      const location = buildRedirectUri(redirectUri, {
        error,
        error_description: errorDescription,
        state: stateEcho,
      });
      record({
        kind: 'authorize',
        outcome: { status: 302, error, redirect: safeRedirectForLog(location) },
        mock: modes,
      });
      redirectTo(res, location);
      return;
    }

    const clientId = String(getParam(params, 'client_id') || '');
    if (!clientId || !cfg.clientIds.includes(clientId)) {
      counters.rejected += 1;
      const location = buildRedirectUri(redirectUri, {
        error: 'unauthorized_client',
        error_description: 'Unknown client_id',
        state: stateEcho,
      });
      record({
        kind: 'authorize',
        outcome: { status: 302, error: 'unauthorized_client' },
        mock: modes,
      });
      redirectTo(res, location);
      return;
    }

    if (String(getParam(params, 'response_type') || '') !== 'code') {
      counters.rejected += 1;
      const location = buildRedirectUri(redirectUri, {
        error: 'unsupported_response_type',
        error_description: 'Only response_type=code is supported',
        state: stateEcho,
      });
      record({
        kind: 'authorize',
        outcome: { status: 302, error: 'unsupported_response_type' },
        mock: modes,
      });
      redirectTo(res, location);
      return;
    }

    const missing = [];
    if (cfg.requireState && !params.has('state')) missing.push('state');
    if (!params.get('code_challenge')) missing.push('code_challenge');
    if (!params.get('code_challenge_method')) missing.push('code_challenge_method');
    if (missing.length > 0) {
      counters.rejected += 1;
      const location = buildRedirectUri(redirectUri, {
        error: 'invalid_request',
        error_description: `Missing required parameter(s): ${missing.join(', ')}`,
        state: stateEcho,
      });
      record({
        kind: 'authorize',
        outcome: { status: 302, error: 'invalid_request', missing },
        mock: modes,
      });
      redirectTo(res, location);
      return;
    }

    const codeChallengeMethod = String(getParam(params, 'code_challenge_method'));
    // VK's own SDK sends lowercase 's256'; the docs say 'S256'. Accept either.
    if (!/^s256$/i.test(codeChallengeMethod)) {
      counters.rejected += 1;
      const location = buildRedirectUri(redirectUri, {
        error: 'invalid_request',
        error_description: 'code_challenge_method must be S256',
        state: stateEcho,
      });
      record({
        kind: 'authorize',
        outcome: { status: 302, error: 'invalid_request', reason: 'pkce_method' },
        mock: modes,
      });
      redirectTo(res, location);
      return;
    }

    const codeChallenge = String(getParam(params, 'code_challenge'));
    if (!PKCE_CHALLENGE_RE.test(codeChallenge)) {
      counters.rejected += 1;
      const location = buildRedirectUri(redirectUri, {
        error: 'invalid_request',
        error_description: 'code_challenge must be 43 base64url characters (S256)',
        state: stateEcho,
      });
      record({
        kind: 'authorize',
        outcome: { status: 302, error: 'invalid_request', reason: 'pkce_format' },
        mock: modes,
      });
      redirectTo(res, location);
      return;
    }

    // device_id is PRODUCED by VK ID at authorize time (it is not an authorize
    // request parameter). We generate one, echo it in the callback, and require
    // the token request to send the identical value. mock_no_device_id=1
    // simulates the (buggy) case where the provider omits it.
    let deviceId = null;
    let requireDeviceId = false;
    if (!isTruthyFlag(modes.mock_no_device_id)) {
      deviceId = `vk-dev-${randomToken(12)}`;
      requireDeviceId = cfg.requireDeviceId;
    }

    const code = issueAuthorizationCode(params, modes, redirectUri, deviceId, requireDeviceId);

    const location = buildRedirectUri(redirectUri, {
      code,
      state: stateEcho,
      device_id: isTruthyFlag(modes.mock_no_device_id) ? undefined : deviceId,
      // Modern VK ID also returns type=code_v2; connectors must ignore it.
      type: 'code_v2',
    });
    record({
      kind: 'authorize',
      outcome: { status: 302, code_issued: true, redirect: safeRedirectForLog(location) },
      mock: modes,
    });
    redirectTo(res, location);
  }

  function safeRedirectForLog(location) {
    try {
      const url = new URL(location);
      return `${url.origin}${url.pathname}`;
    } catch {
      return '<invalid>';
    }
  }

  async function handleToken(req, res, url) {
    counters.token += 1;
    const rawBody = await readRawBody(req).catch(() => '');
    const params = collectParams(req, url, rawBody);
    const modes = extractModes(params);
    // A mode forced on the token request wins; otherwise the mode captured at
    // /authorize (stored with the code) applies, so a connector that never
    // forwards mock_* flags can still be exercised end-to-end.
    const requestedTokenMode = modes.mock_token_mode || cfg.tokenMode || null;

    if (isTruthyFlag(modes.mock_slow)) {
      await sleep(cfg.slowMs);
    }

    if (requestedTokenMode && !TOKEN_MODES.has(requestedTokenMode)) {
      jsonBody(res, 400, {
        error: 'invalid_request',
        error_description: `Unknown mock_token_mode: ${requestedTokenMode}`,
      });
      return;
    }

    const grantType = String(getParam(params, 'grant_type') || '');

    if (grantType === 'refresh_token') {
      const providedRefresh = String(getParam(params, 'refresh_token') || '');
      const tokenRecord = refreshTokens.get(providedRefresh);
      if (!tokenRecord) {
        counters.rejected += 1;
        jsonBody(res, 400, { error: 'invalid_grant', error_description: 'Unknown refresh_token' });
        return;
      }
      const refreshClientId = String(getParam(params, 'client_id') || '');
      if (refreshClientId && !cfg.clientIds.includes(refreshClientId)) {
        counters.rejected += 1;
        jsonBody(res, 400, { error: 'invalid_client', error_description: 'Unknown client_id' });
        return;
      }
      refreshTokens.delete(providedRefresh);
      const rotated = {
        ...tokenRecord,
        accessToken: randomToken(32),
        refreshToken: randomToken(32),
        expiresAt: Date.now() + cfg.accessTokenTtlSeconds * 1000,
      };
      accessTokens.set(rotated.accessToken, rotated);
      refreshTokens.set(rotated.refreshToken, rotated);
      const payload = makeTokenPayload(rotated);
      if (handleTokenMode(requestedTokenMode, res, payload)) {
        record({
          kind: 'token',
          outcome: { status: res.statusCode, mode: requestedTokenMode },
          mock: modes,
        });
        return;
      }
      jsonBody(res, 200, payload);
      record({ kind: 'token', outcome: { status: 200, grant_type: 'refresh_token' }, mock: modes });
      return;
    }

    if (grantType !== 'authorization_code') {
      counters.rejected += 1;
      jsonBody(res, 400, {
        error: 'unsupported_grant_type',
        error_description: `grant_type must be authorization_code, got "${grantType}"`,
      });
      record({
        kind: 'token',
        outcome: { status: 400, error: 'unsupported_grant_type' },
        mock: modes,
      });
      return;
    }

    const code = String(getParam(params, 'code') || '');
    const consumed = consumeAuthorizationCode(code);
    if (consumed.error) {
      jsonBody(res, 400, { error: consumed.error, error_description: consumed.description });
      record({ kind: 'token', outcome: { status: 400, error: consumed.error }, mock: modes });
      return;
    }
    const record_ = consumed.record;
    const tokenMode =
      requestedTokenMode ||
      (record_.mockTokenMode && TOKEN_MODES.has(record_.mockTokenMode)
        ? record_.mockTokenMode
        : null);

    const clientId = String(getParam(params, 'client_id') || '');
    if (!clientId || !cfg.clientIds.includes(clientId)) {
      counters.rejected += 1;
      jsonBody(res, 400, { error: 'invalid_client', error_description: 'Unknown client_id' });
      record({ kind: 'token', outcome: { status: 400, error: 'invalid_client' }, mock: modes });
      return;
    }
    if (cfg.clientSecret !== null) {
      const providedSecret = String(getParam(params, 'client_secret') || '');
      if (providedSecret && !safeEqual(providedSecret, cfg.clientSecret)) {
        counters.rejected += 1;
        jsonBody(res, 400, { error: 'invalid_client', error_description: 'Bad client_secret' });
        record({ kind: 'token', outcome: { status: 400, error: 'invalid_client' }, mock: modes });
        return;
      }
    }

    const redirectUri = String(getParam(params, 'redirect_uri') || '');
    if (!safeEqual(redirectUri, record_.redirectUri)) {
      counters.rejected += 1;
      jsonBody(res, 400, {
        error: 'invalid_grant',
        error_description: 'redirect_uri does not match the authorization request',
      });
      record({
        kind: 'token',
        outcome: { status: 400, error: 'invalid_grant', reason: 'redirect_uri' },
        mock: modes,
      });
      return;
    }

    if (record_.requireDeviceId) {
      const providedDeviceId = String(getParam(params, 'device_id') || '');
      if (!providedDeviceId || !safeEqual(providedDeviceId, record_.deviceId)) {
        counters.rejected += 1;
        jsonBody(res, 400, {
          error: 'invalid_grant',
          error_description: 'device_id does not match the authorization request',
        });
        record({
          kind: 'token',
          outcome: { status: 400, error: 'invalid_grant', reason: 'device_id' },
          mock: modes,
        });
        return;
      }
    }

    const codeVerifier = String(getParam(params, 'code_verifier') || '');
    if (!codeVerifier) {
      counters.rejected += 1;
      jsonBody(res, 400, {
        error: 'invalid_request',
        error_description: 'code_verifier is required (PKCE)',
      });
      record({
        kind: 'token',
        outcome: { status: 400, error: 'invalid_request', reason: 'missing_verifier' },
        mock: modes,
      });
      return;
    }

    const pkceFailure =
      record_.mockBadPkce ||
      !PKCE_VERIFIER_RE.test(codeVerifier) ||
      !safeEqual(computeS256(codeVerifier), record_.codeChallenge);
    if (pkceFailure) {
      counters.rejected += 1;
      jsonBody(res, 400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
      record({
        kind: 'token',
        outcome: { status: 400, error: 'invalid_grant', reason: 'pkce' },
        mock: modes,
      });
      return;
    }

    const accessToken = randomToken(32);
    const refreshToken = randomToken(32);
    const expiresIn = cfg.accessTokenTtlSeconds;
    const tokenRecord = {
      accessToken,
      refreshToken,
      clientId: record_.clientId,
      userId: record_.userId,
      scope: record_.scope,
      state: record_.state,
      mockUserMode: modes.mock_user_mode || record_.mockUserMode || cfg.userMode || null,
      expiresAt: Date.now() + expiresIn * 1000,
    };
    accessTokens.set(accessToken, tokenRecord);
    refreshTokens.set(refreshToken, tokenRecord);

    const payload = {
      access_token: accessToken,
      refresh_token: refreshToken,
      id_token: makeIdToken({ userId: record_.userId, clientId: record_.clientId }),
      token_type: 'Bearer',
      expires_in: expiresIn,
      // VK ID returns user_id as a NUMBER in the token response (it is a
      // STRING in /oauth2/user_info - do not mix them up).
      user_id: toNumericUserId(record_.userId),
      scope: record_.scope,
      state: record_.state,
    };

    if (handleTokenMode(tokenMode, res, payload)) {
      record({
        kind: 'token',
        outcome: { status: res.statusCode ?? 200, mode: tokenMode },
        mock: modes,
      });
      return;
    }

    jsonBody(res, 200, payload);
    record({ kind: 'token', outcome: { status: 200, mode: tokenMode }, mock: modes });
  }

  function makeTokenPayload(tokenRecord) {
    // Real VK ID omits id_token from refresh responses, so the mock does too.
    return {
      access_token: tokenRecord.accessToken,
      refresh_token: tokenRecord.refreshToken,
      token_type: 'Bearer',
      expires_in: cfg.accessTokenTtlSeconds,
      user_id: toNumericUserId(tokenRecord.userId),
      scope: tokenRecord.scope,
      state: tokenRecord.state,
    };
  }

  async function handleUserInfo(req, res, url) {
    counters.userInfo += 1;
    const rawBody = await readRawBody(req).catch(() => '');
    const params = collectParams(req, url, rawBody);
    const modes = extractModes(params);

    let userMode = modes.mock_user_mode || cfg.userMode || null;

    if (isTruthyFlag(modes.mock_slow)) {
      await sleep(cfg.slowMs);
    }

    if (userMode && !USER_MODES.has(userMode)) {
      jsonBody(res, 400, {
        error: 'invalid_request',
        error_description: `Unknown mock_user_mode: ${userMode}`,
      });
      return;
    }

    let accessToken = String(getParam(params, 'access_token') || '');
    if (!accessToken) {
      const authHeader = String(req.headers.authorization || '');
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      if (match) accessToken = match[1].trim();
    }

    const tokenRecord = accessToken ? accessTokens.get(accessToken) : undefined;
    if (!tokenRecord) {
      counters.rejected += 1;
      jsonBody(res, 401, {
        error: 'invalid_token',
        error_description: accessToken
          ? 'access_token is unknown or expired'
          : 'access_token is required',
      });
      record({ kind: 'user_info', outcome: { status: 401, error: 'invalid_token' }, mock: modes });
      return;
    }
    if (Date.now() > tokenRecord.expiresAt) {
      accessTokens.delete(accessToken);
      counters.rejected += 1;
      jsonBody(res, 401, { error: 'invalid_token', error_description: 'access_token expired' });
      record({ kind: 'user_info', outcome: { status: 401, error: 'expired' }, mock: modes });
      return;
    }

    if (!userMode) userMode = tokenRecord.mockUserMode || null;

    if (handleUserInfoMode(userMode, res, null)) {
      record({
        kind: 'user_info',
        outcome: { status: res.statusCode, mode: userMode },
        mock: modes,
      });
      return;
    }

    const user = applyUserMode(userMode, cfg.user);
    // VK ID returns user_id as a STRING in /oauth2/user_info even though the
    // token endpoint returns it as a number.
    if (user.user_id !== undefined && user.user_id !== null) {
      user.user_id = String(user.user_id);
    }
    jsonBody(res, 200, { user });
    record({ kind: 'user_info', outcome: { status: 200, mode: userMode }, mock: modes });
  }

  async function route(req, res) {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/health' || path === '/healthz' || path === '/readyz') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        jsonBody(res, 405, { error: 'method_not_allowed' });
        return;
      }
      jsonBody(res, 200, {
        status: 'ok',
        service: 'mock-vkid',
        timestamp: new Date().toISOString(),
        pending_codes: pendingCodes.size,
        active_tokens: accessTokens.size,
        redirect_uris: cfg.redirectUris,
      });
      return;
    }

    if (path === '/') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        jsonBody(res, 405, { error: 'method_not_allowed' });
        return;
      }
      jsonBody(res, 200, {
        service: 'mock-vkid',
        description: 'Dependency-free mock of the modern VK ID OAuth 2.1 provider',
        endpoints: {
          authorize: 'GET /authorize',
          token: 'POST /oauth2/auth',
          user_info: 'POST /oauth2/user_info',
          health: 'GET /health',
          debug_state: 'GET /debug/state',
          debug_reset: 'POST /debug/reset',
        },
        mock_modes: MODE_KEYS,
      });
      return;
    }

    if (path === '/authorize') {
      await handleAuthorize(req, res, url);
      return;
    }

    if (path === '/oauth2/auth') {
      if (req.method !== 'POST') {
        jsonBody(res, 405, { error: 'method_not_allowed', error_description: 'Use POST' });
        return;
      }
      await handleToken(req, res, url);
      return;
    }

    if (path === '/oauth2/user_info') {
      if (req.method !== 'POST' && req.method !== 'GET') {
        jsonBody(res, 405, { error: 'method_not_allowed' });
        return;
      }
      await handleUserInfo(req, res, url);
      return;
    }

    if (path === '/debug/state') {
      jsonBody(res, 200, {
        service: 'mock-vkid',
        now: new Date().toISOString(),
        counters,
        pending_codes: pendingCodes.size,
        active_access_tokens: accessTokens.size,
        active_refresh_tokens: refreshTokens.size,
        requests: requestLog,
      });
      return;
    }

    if (path === '/debug/reset') {
      if (req.method !== 'POST') {
        jsonBody(res, 405, { error: 'method_not_allowed' });
        return;
      }
      pendingCodes.clear();
      accessTokens.clear();
      refreshTokens.clear();
      requestLog.length = 0;
      for (const key of Object.keys(counters)) counters[key] = 0;
      jsonBody(res, 200, { status: 'reset' });
      return;
    }

    jsonBody(res, 404, { error: 'not_found', path });
  }

  const server = http.createServer((req, res) => {
    route(req, res).catch((error) => {
      counters.rejected += 1;
      const status = error?.statusCode || 500;
      if (!res.headersSent) {
        jsonBody(res, status, {
          error: status === 413 ? 'request_too_large' : 'server_error',
          error_description: String(error?.message || error),
        });
      } else {
        res.end();
      }
    });
  });

  // Expose internals for the smoke tests without leaking them over HTTP.
  server.mockState = {
    pendingCodes,
    accessTokens,
    refreshTokens,
    requestLog,
    counters,
  };
  server.mockConfig = cfg;

  return server;
}

export default createMockVkidServer;
