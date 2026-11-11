import type { SocialUserInfo } from '@logto/connector-kit';

import type { VkUser, VkidConfig } from './types.js';
import { stripUnsafeCharacters } from './sanitize.js';

/**
 * Map a VK ID profile onto the normalized Logto `SocialUserInfo` shape.
 *
 * Rules, in order of importance:
 * 1. `id` must be the stable VK user id. It is the only identifier Logto uses to recognise a
 *    returning social identity, so it is never derived from mutable profile fields.
 * 2. `name` is the full name. VK ID returns `first_name` and `last_name` as separate fields; the
 *    upstream implementation mapped only `first_name`, silently dropping the surname.
 * 3. `email` and `phone` are only forwarded when explicitly enabled in the connector
 *    configuration. Logto uses them to *link* a social identity to an existing Logto account
 *    (`findSocialRelatedUser()`), so forwarding them by default would turn a provider-supplied,
 *    possibly unverified identifier into a cross-provider account-takeover primitive. Phone is
 *    additionally preferred over e-mail by Logto, hence the separate switch.
 * 4. Optional fields that are empty, whitespace-only or malformed are omitted entirely instead of
 *    being forwarded as `''` or `null`: Logto's `socialUserInfoGuard` accepts optional strings but
 *    an empty string would be stored as a real (empty) profile value.
 */

/** Names and other free-text profile fields are capped to keep provider data bounded. */
const MAX_TEXT_LENGTH = 256;

const normalizeText = (value: string | undefined): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  // Collapse whitespace, drop control characters and strip Unicode format characters so a hostile
  // display name can neither inject newlines into Logto logs and the Admin Console table nor use a
  // bidi override (U+202E) to render as a different string than the one stored.
  const normalized = stripUnsafeCharacters(value);

  if (normalized.length === 0) {
    return undefined;
  }

  return normalized.slice(0, MAX_TEXT_LENGTH);
};

/** Join the VK ID name parts into a single display name. */
export const buildDisplayName = (
  firstName: string | undefined,
  lastName: string | undefined,
  patronymic?: string,
): string | undefined => {
  const parts = [firstName, lastName, patronymic]
    .map((part) => normalizeText(part))
    .filter((part): part is string => part !== undefined);

  if (parts.length === 0) {
    return undefined;
  }

  return parts.join(' ').slice(0, MAX_TEXT_LENGTH);
};

/**
 * Accept only absolute `https`/`http` URLs as an avatar.
 *
 * A relative or non-URL avatar would be emitted as an image source by Logto clients; a
 * `javascript:` URL in particular must never survive this mapping.
 */
export const normalizeAvatarUrl = (value: string | undefined): string | undefined => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  try {
    const url = new URL(value.trim());

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return undefined;
    }

    return url.toString();
  } catch {
    return undefined;
  }
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizeEmail = (value: string | undefined): string | undefined => {
  const normalized = normalizeText(value);

  if (!normalized || normalized.length > 320) {
    return undefined;
  }

  return emailPattern.test(normalized) ? normalized.toLowerCase() : undefined;
};

/**
 * Normalize a VK phone number to E.164.
 *
 * VK ID returns the number as digits in international format without the leading `+`
 * (e.g. `79001234567`). Logto normalizes phone numbers again before storing them, but it expects
 * an E.164 value here, and an unparsable value is dropped rather than forwarded.
 */
export const normalizePhone = (value: string | undefined): string | undefined => {
  const normalized = normalizeText(value);

  if (!normalized) {
    return undefined;
  }

  const hasPlus = normalized.startsWith('+');
  const digits = normalized.replaceAll(/\D/g, '');

  if (digits.length === 11 && digits.startsWith('7')) {
    return `+${digits}`;
  }

  if (hasPlus && digits.length >= 8 && digits.length <= 15) {
    return `+${digits}`;
  }

  return undefined;
};

/**
 * Build the `SocialUserInfo` returned to Logto.
 *
 * `rawData` is intentionally not included: it would copy the whole VK profile (including phone and
 * e-mail that may not have been synced) into the Logto user record and the Admin Console.
 */
export const mapVkUser = (config: VkidConfig, user: VkUser): SocialUserInfo => {
  const userInfo: SocialUserInfo = { id: user.user_id };

  const name = buildDisplayName(user.first_name, user.last_name, user.patronymic);
  if (name !== undefined) {
    userInfo.name = name;
  }

  const avatar = normalizeAvatarUrl(user.avatar);
  if (avatar !== undefined) {
    userInfo.avatar = avatar;
  }

  if (config.syncEmail) {
    const email = normalizeEmail(user.email);
    if (email !== undefined) {
      userInfo.email = email;
    }
  }

  if (config.syncPhone) {
    const phone = normalizePhone(user.phone);
    if (phone !== undefined) {
      userInfo.phone = phone;
    }
  }

  return userInfo;
};
