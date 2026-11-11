import { afterEach, describe, expect, it, vi } from 'vitest';

import type { VkUser, VkidConfig } from '../src/types.js';
import {
  buildDisplayName,
  mapVkUser,
  normalizeAvatarUrl,
  normalizeEmail,
  normalizePhone,
} from '../src/profile.js';
import {
  CLIENT_ID,
  callbackData,
  configWith,
  createFetchMock,
  createSessionHarness,
  createTestConnector,
  queueSuccessfulExchange,
  seedSession,
} from './support.js';

const makeConfig = (overrides: Partial<VkidConfig> = {}): VkidConfig => ({
  clientId: CLIENT_ID,
  ...overrides,
});

const makeUser = (overrides: Partial<VkUser> = {}): VkUser => ({
  user_id: '42',
  ...overrides,
});

describe('profile mapping (scenario 12)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('[S12] omits email and phone by default even when the provider sent them', () => {
    for (const verified of [false, true]) {
      const userInfo = mapVkUser(
        makeConfig(),
        makeUser({
          first_name: 'Ivan',
          last_name: 'Ivanov',
          avatar: 'https://pp.userapi.com/avatar.png',
          email: 'ivan@example.com',
          phone: '79001234567',
          verified,
        }),
      );

      expect(userInfo).toEqual({
        id: '42',
        name: 'Ivan Ivanov',
        avatar: 'https://pp.userapi.com/avatar.png',
      });
      expect('email' in userInfo).toBe(false);
      expect('phone' in userInfo).toBe(false);
    }
  });

  it('[S12] omits missing optional fields entirely instead of emitting undefined-valued keys', () => {
    const userInfo = mapVkUser(makeConfig(), makeUser());

    expect(userInfo).toEqual({ id: '42' });
    expect(Object.keys(userInfo)).toEqual(['id']);
    expect(JSON.stringify(userInfo)).toBe('{"id":"42"}');

    for (const key of ['name', 'email', 'phone', 'avatar', 'rawData']) {
      expect(key in userInfo).toBe(false);
    }
  });

  it('[S12] drops a valid provider email when syncEmail is false', () => {
    const userInfo = mapVkUser(
      makeConfig({ syncEmail: false }),
      makeUser({ email: 'ivan@example.com' }),
    );

    expect('email' in userInfo).toBe(false);
  });

  it('[S12] forwards a lowercased, validated email when syncEmail is true', () => {
    const userInfo = mapVkUser(
      makeConfig({ syncEmail: true }),
      makeUser({ email: 'Ivan.Petrov@Example.COM' }),
    );

    expect(userInfo.email).toBe('ivan.petrov@example.com');
  });

  it('[S12] drops malformed emails when syncEmail is true', () => {
    for (const email of ['not-an-email', 'user@localhost', '', '   ', 'a b@example.com']) {
      const userInfo = mapVkUser(makeConfig({ syncEmail: true }), makeUser({ email }));
      expect('email' in userInfo).toBe(false);
    }
  });

  it('[S12] drops an over-long email when syncEmail is true', () => {
    const email = `${'a'.repeat(310)}@example.com`;
    expect(email.length).toBeGreaterThan(320);

    const userInfo = mapVkUser(makeConfig({ syncEmail: true }), makeUser({ email }));

    expect('email' in userInfo).toBe(false);
  });

  it('[S12] normalizes 79001234567 to +79001234567 when syncPhone is true', () => {
    const userInfo = mapVkUser(makeConfig({ syncPhone: true }), makeUser({ phone: '79001234567' }));

    expect(userInfo.phone).toBe('+79001234567');
  });

  it('[S12] normalizes the Russian local 8XXXXXXXXXX form to +7XXXXXXXXXX', () => {
    const userInfo = mapVkUser(makeConfig({ syncPhone: true }), makeUser({ phone: '89991234567' }));

    expect(userInfo.phone).toBe('+79991234567');
    expect(normalizePhone('8 (999) 123-45-67')).toBe('+79991234567');
  });

  it('[S12] normalizes formatted and international phone numbers when syncPhone is true', () => {
    expect(normalizePhone('7 (900) 123-45-67')).toBe('+79001234567');
    expect(normalizePhone('+44 20 7183 8750')).toBe('+442071838750');
    expect(normalizePhone('+7 900 123 45 67')).toBe('+79001234567');
  });

  it('[S12] drops unusable phone values when syncPhone is true', () => {
    for (const phone of ['call me maybe', '12345', '+12', '']) {
      const userInfo = mapVkUser(makeConfig({ syncPhone: true }), makeUser({ phone }));
      expect('phone' in userInfo).toBe(false);
    }
  });

  it('[S12] drops a valid provider phone when syncPhone is false', () => {
    const userInfo = mapVkUser(
      makeConfig({ syncPhone: false }),
      makeUser({ phone: '79001234567' }),
    );

    expect('phone' in userInfo).toBe(false);
  });

  it('[S12] joins first and last name, preserving the surname', () => {
    expect(buildDisplayName('Ivan', 'Ivanov')).toBe('Ivan Ivanov');
    expect(buildDisplayName('Ivan', undefined)).toBe('Ivan');
    expect(buildDisplayName(undefined, 'Ivanov')).toBe('Ivanov');

    const userInfo = mapVkUser(makeConfig(), makeUser({ first_name: 'Ivan', last_name: 'Ivanov' }));
    expect(userInfo.name).toBe('Ivan Ivanov');
  });

  it('[S12] includes the patronymic when the provider returns one', () => {
    expect(buildDisplayName('Ivan', 'Ivanov', 'Ivanovich')).toBe('Ivan Ivanov Ivanovich');
  });

  it('[S12] omits the name when both name parts are empty or whitespace', () => {
    expect(buildDisplayName('', '   ')).toBeUndefined();
    expect(buildDisplayName(undefined, undefined)).toBeUndefined();

    const userInfo = mapVkUser(makeConfig(), makeUser({ first_name: '  ', last_name: '\t\n' }));
    expect('name' in userInfo).toBe(false);
  });

  it('[S12] collapses whitespace/control characters and caps the name at 256 characters', () => {
    expect(buildDisplayName(' Ivan\nPetrov ', 'Sidorov')).toBe('Ivan Petrov Sidorov');

    const capped = buildDisplayName('A'.repeat(300), undefined);
    expect(capped).toHaveLength(256);
  });

  it('[S12] strips bidi and zero-width characters so a display name cannot be spoofed', () => {
    // U+202E (right-to-left override) makes "Ivan\u202Egnp.exe" render as a different string.
    expect(buildDisplayName('Ivan\u202Egnp.exe', undefined)).toBe('Ivan gnp.exe');
    expect(buildDisplayName('Iv\u200Ban', undefined)).toBe('Iv an');
    expect(buildDisplayName('\uFEFFLeading', undefined)).toBe('Leading');

    const userInfo = mapVkUser(
      makeConfig(),
      makeUser({ first_name: '\u202Eevil', last_name: 'name' }),
    );
    expect(userInfo.name).toBe('evil name');
    expect(userInfo.name).not.toMatch(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/);
  });

  it('[S12] accepts only absolute http(s) avatar URLs', () => {
    expect(normalizeAvatarUrl('https://pp.userapi.com/avatar.png')).toBe(
      'https://pp.userapi.com/avatar.png',
    );
    expect(normalizeAvatarUrl('http://pp.userapi.com/avatar.png')).toBe(
      'http://pp.userapi.com/avatar.png',
    );
    expect(normalizeAvatarUrl('javascript:alert(1)')).toBeUndefined();
    expect(normalizeAvatarUrl('data:image/png;base64,AAAA')).toBeUndefined();
    expect(normalizeAvatarUrl('/avatar.png')).toBeUndefined();
    expect(normalizeAvatarUrl('pp.userapi.com/avatar.png')).toBeUndefined();
    expect(normalizeAvatarUrl('')).toBeUndefined();
    expect(normalizeAvatarUrl('   ')).toBeUndefined();
  });

  it('[S12] normalizes the avatar URL representation', () => {
    expect(normalizeAvatarUrl('HTTPS://PP.UserAPI.com/Avatar.png')).toBe(
      'https://pp.userapi.com/Avatar.png',
    );

    const userInfo = mapVkUser(
      makeConfig(),
      makeUser({ avatar: 'https://pp.userapi.com/avatar.png' }),
    );
    expect(userInfo.avatar).toBe('https://pp.userapi.com/avatar.png');
  });

  it('[S12] accepts a well-formed normalizer input for e-mail and phone helpers', () => {
    expect(normalizeEmail('USER@Example.com')).toBe('user@example.com');
    expect(normalizeEmail('nope')).toBeUndefined();
    expect(normalizePhone(undefined)).toBeUndefined();
  });

  it('[S12] ignores provider fields of the wrong type', () => {
    const userInfo = mapVkUser(
      makeConfig({ syncEmail: true, syncPhone: true }),
      makeUser({
        first_name: 42 as unknown as string,
        email: 123 as unknown as string,
        phone: 456 as unknown as string,
        avatar: 789 as unknown as string,
      }),
    );

    expect(userInfo).toEqual({ id: '42' });
  });

  it('[S12] never copies raw provider data into rawData', () => {
    const userInfo = mapVkUser(
      makeConfig(),
      makeUser({
        sex: 2,
        verified: true,
        birthday: '01.01.2000',
        email: 'ivan@example.com',
        phone: '79001234567',
      }),
    );

    expect('rawData' in userInfo).toBe(false);
    expect(userInfo).not.toHaveProperty('sex');
    expect(userInfo).not.toHaveProperty('verified');
    expect(userInfo).not.toHaveProperty('birthday');
  });

  it('[S12] end-to-end: the connector forwards contacts only when sync flags are enabled', async () => {
    const fetchMock = createFetchMock();
    const connector = await createTestConnector(configWith({ syncEmail: true, syncPhone: true }));
    const harness = createSessionHarness();
    seedSession(harness);
    queueSuccessfulExchange(fetchMock);

    const userInfo = await connector.getUserInfo(callbackData(), harness.getSession);

    expect(userInfo).toEqual({
      id: '42',
      name: 'Ivan Ivanov',
      avatar: 'https://pp.userapi.com/avatar.png',
      email: 'ivan@example.com',
      phone: '+79001234567',
    });
    expect(Object.keys(userInfo).sort()).toEqual(['avatar', 'email', 'id', 'name', 'phone']);
  });
});
