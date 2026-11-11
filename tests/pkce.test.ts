import { describe, expect, it } from 'vitest';

import { createCodeChallenge, createCodeVerifier } from '../src/pkce.js';
import {
  authorize,
  createSessionHarness,
  createTestConnector,
  sha256Challenge,
} from './support.js';

/** RFC 7636 §4.1: verifiers/challenges are unpadded base64url strings. */
const PKCE_CHARACTERS = /^[\w\-._~]+$/;

describe('PKCE helpers and S256 derivation (scenario 1)', () => {
  it('[S1] produces a 43-character, unpadded base64url code verifier', () => {
    const verifier = createCodeVerifier();

    expect(verifier).toHaveLength(43);
    expect(verifier).toMatch(PKCE_CHARACTERS);
    expect(verifier).not.toContain('=');
    expect(verifier).not.toContain('+');
    expect(verifier).not.toContain('/');
  });

  it('[S1] creates a fresh, high-entropy verifier on every call', () => {
    const verifiers = new Set(Array.from({ length: 200 }, () => createCodeVerifier()));

    expect(verifiers.size).toBe(200);

    for (const verifier of verifiers) {
      expect(verifier).toHaveLength(43);
    }
  });

  it('[S1] derives BASE64URL(SHA256(ASCII(verifier))) independently for node:crypto', () => {
    for (let index = 0; index < 25; index += 1) {
      const verifier = createCodeVerifier();

      // `sha256Challenge` is a direct node:crypto implementation in the test helper, not the
      // production helper under test, so this checks the algorithm and not a tautology.
      expect(createCodeChallenge(verifier)).toBe(sha256Challenge(verifier));
    }
  });

  it('[S1] reproduces the RFC 7636 Appendix B S256 test vector', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

    expect(createCodeChallenge(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('[S1] sends code_challenge_method=S256 bound to the verifier stored in the session', async () => {
    const connector = await createTestConnector();
    const harness = createSessionHarness();
    const { url, verifier } = await authorize(connector, harness);

    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(sha256Challenge(verifier));
    expect(url.searchParams.get('code_challenge')).toMatch(PKCE_CHARACTERS);
    expect(verifier).toMatch(PKCE_CHARACTERS);
    expect(harness.peek().vk_code_verifier).toBe(verifier);
  });

  it('[S1] mints a different verifier and challenge for every authorization request', async () => {
    const connector = await createTestConnector();
    const firstHarness = createSessionHarness();
    const secondHarness = createSessionHarness();

    const first = await authorize(connector, firstHarness);
    const second = await authorize(connector, secondHarness);

    expect(first.verifier).not.toBe(second.verifier);
    expect(first.url.searchParams.get('code_challenge')).not.toBe(
      second.url.searchParams.get('code_challenge'),
    );
  });
});
