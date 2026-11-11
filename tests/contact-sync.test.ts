import { describe, expect, it } from 'vitest';

import { addContactScopes } from '../src/client.js';
import { normalizePhone } from '../src/profile.js';

describe('contact sync helpers', () => {
  it('adds email and phone scopes when the sync switches are enabled', () => {
    expect(addContactScopes('vkid.personal_info', { syncEmail: true, syncPhone: true })).toBe(
      'vkid.personal_info email phone',
    );
  });

  it('does not duplicate scopes that are already present', () => {
    expect(addContactScopes('vkid.personal_info email', { syncEmail: true, syncPhone: true })).toBe(
      'vkid.personal_info email phone',
    );
  });

  it('keeps the configured scope when contact sync is disabled', () => {
    expect(addContactScopes('vkid.personal_info', { syncEmail: false, syncPhone: false })).toBe(
      'vkid.personal_info',
    );
    expect(addContactScopes(undefined, { syncEmail: false, syncPhone: false })).toBe(
      'vkid.personal_info',
    );
  });

  it('normalizes the Russian local 8XXXXXXXXXX phone form to +7XXXXXXXXXX', () => {
    expect(normalizePhone('89991234567')).toBe('+79991234567');
    expect(normalizePhone('8 (999) 123-45-67')).toBe('+79991234567');
  });

  it('keeps the existing international and +7 forms', () => {
    expect(normalizePhone('79001234567')).toBe('+79001234567');
    expect(normalizePhone('+44 20 7183 8750')).toBe('+442071838750');
  });
});
