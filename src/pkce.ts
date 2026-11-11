import { createHash, randomBytes } from 'node:crypto';

/**
 * PKCE (RFC 7636) helpers.
 *
 * Implemented on top of `node:crypto` instead of a dependency: the connector needs exactly two
 * calls (one CSPRNG read and one SHA-256 digest), and the upstream package's `pkce-challenge`
 * dependency was a browser-oriented bundle that was also missing from `dependencies`.
 */

/** PKCE verifier length in characters. RFC 7636 allows 43–128; 32 random bytes encode to 43. */
const VERIFIER_BYTE_LENGTH = 32;

/**
 * Create a high-entropy `code_verifier` as an unpadded base64url string.
 *
 * 32 random bytes give 256 bits of entropy (the verifier must have at least 256 bits of entropy
 * per RFC 7636 §7.1), and base64url encoding uses only the unreserved character set mandated by
 * RFC 7636 §4.1. The result is 43 characters long, which is also the minimum permitted length.
 */
export const createCodeVerifier = (): string =>
  randomBytes(VERIFIER_BYTE_LENGTH).toString('base64url');

/**
 * Derive the S256 `code_challenge` from a verifier: `BASE64URL(SHA256(ASCII(verifier)))`.
 *
 * This connector only ever uses S256. `plain` is not offered because it provides no protection
 * when the authorization response leaks, and it is not needed for a confidential server-side
 * client with a code_verifier stored in the Logto interaction session.
 */
export const createCodeChallenge = (codeVerifier: string): string =>
  createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
