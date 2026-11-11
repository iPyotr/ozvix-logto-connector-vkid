/**
 * Sanitisation of everything that enters the connector from outside its own code.
 *
 * Two classes of characters are removed, for two different reasons:
 *
 * - C0/C1 control characters (including `\n`, `\r`, `\u001b`): Logto serialises a `ConnectorError`
 *   payload into the error message and writes it to its log. A callback parameter or a provider
 *   error string containing a line break or an ANSI escape could otherwise forge log lines or
 *   corrupt terminal output.
 * - Unicode format characters (bidi overrides, zero-width joiners, line/paragraph separators, BOM):
 *   an identity or a display name carrying U+202E can render as a completely different string in
 *   the Admin Console or in a log viewer while comparing unequal to what an operator reads.
 *
 * This is a *text* sanitiser: it bounds and neutralises hostile strings, it does not try to
 * interpret them. Values with a known shape (the VK user id) are additionally checked against a
 * strict pattern and rejected outright when they do not match, because an identity must fail closed
 * rather than be silently rewritten.
 */

/* eslint-disable no-control-regex -- matching control characters is the whole point here. */
const UNSAFE_CHARACTERS =
  /[\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u2028-\u202E\u2060-\u2069\u206A-\u206F\uFEFF]/g;
/* eslint-enable no-control-regex */

/** Maximum length of a provider-supplied diagnostic string forwarded into an error payload. */
export const MAX_PROVIDER_TEXT_LENGTH = 200;

/** Maximum length of a provider-supplied OAuth error code. */
export const MAX_PROVIDER_ERROR_CODE_LENGTH = 64;

/**
 * Maximum length of a VK user id. VK user ids are decimal, but the guard accepts the small set of
 * punctuation characters that opaque provider ids commonly use, so the cap leaves room.
 */
export const MAX_IDENTITY_LENGTH = 64;

/** Characters an identity may consist of: ASCII word characters plus `.`, `:` and `-`. */
export const IDENTITY_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

/** Replace control and format characters with a space and collapse runs of whitespace. */
export const stripUnsafeCharacters = (value: string): string =>
  value.replaceAll(UNSAFE_CHARACTERS, ' ').replaceAll(/\s+/g, ' ').trim();

/**
 * Sanitise a provider-supplied diagnostic value (`error`, `error_description`, ...).
 *
 * Returns `undefined` for anything that is not a non-empty string, or that becomes empty after
 * sanitisation, so the caller can omit the field instead of forwarding `''`.
 */
export const sanitizeProviderText = (
  value: unknown,
  maxLength = MAX_PROVIDER_TEXT_LENGTH,
): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = stripUnsafeCharacters(value);

  if (normalized.length === 0) {
    return undefined;
  }

  return normalized.slice(0, maxLength);
};

/**
 * Validate a provider identity (the VK user id) and reject anything that is not a short, plain
 * ASCII token.
 *
 * Failing closed is deliberate: the identity is the only value Logto uses to recognise a returning
 * social account, and it is stored and displayed verbatim.
 */
export const sanitizeIdentity = (value: string): string | undefined => {
  const trimmed = value.trim();

  return IDENTITY_PATTERN.test(trimmed) ? trimmed : undefined;
};
