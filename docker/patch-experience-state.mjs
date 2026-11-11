// Logto Experience 1.46.0 generates the social sign-in `state` as `se_` + base64url(8 random bytes)
// = 14 characters. VK OAuth 2.1 requires a `state` of at least 32 characters
// (https://id.vk.ru/about/business/go/docs/ru/vkid/latest/vk-id/connection/api-description), and the
// official VK SDKs enforce the same minimum (kMinStateLength = 32).
//
// This patch raises the random part to 32 bytes (43 base64url characters, 46 with the prefix) inside
// the pinned Logto 1.46.0 experience bundle. Only the `generateState` call site is touched; the
// `se_` prefix is kept, so Logto Core still routes the callback and the experience still compares the
// same value it stored. The build fails if the exact pattern is absent (a Logto upgrade would change
// it), so the image can never silently ship an unpatched bundle.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { brotliCompressSync, gzipSync, constants as zlibConstants } from 'node:zlib';

const ASSETS_DIR = '/etc/logto/packages/experience/dist/assets';
const FROM = '`${q5}${jm()}`';
const TO = '`${q5}${jm(32)}`';

const file = readdirSync(ASSETS_DIR).find((name) => /^index-.*\.js$/.test(name));

if (!file) {
  throw new Error(`experience bundle not found in ${ASSETS_DIR}`);
}

const path = `${ASSETS_DIR}/${file}`;
const source = readFileSync(path, 'utf8');

if (!source.includes(TO)) {
  if (!source.includes(FROM)) {
    throw new Error(
      `[patch-experience-state] generateState pattern not found in ${file}; ` +
        'Logto changed its bundle layout. Re-evaluate the VK state-length patch before shipping.',
    );
  }

  writeFileSync(path, source.replace(FROM, TO));

  if (!readFileSync(path, 'utf8').includes(TO)) {
    throw new Error('[patch-experience-state] patch verification failed');
  }
}

// Logto serves precompressed siblings when present (content-encoding: gzip), so a stale `.gz`/`.br`
// would keep serving the unpatched bundle. Regenerate them from the patched file.
const gzipPath = `${path}.gz`;
const brotliPath = `${path}.br`;
const patched = readFileSync(path);

if (existsSync(gzipPath)) {
  writeFileSync(gzipPath, gzipSync(patched, { level: 9 }));
  if (!readFileSync(gzipPath).length)
    throw new Error('[patch-experience-state] failed to rewrite .gz');
}

if (existsSync(brotliPath)) {
  writeFileSync(
    brotliPath,
    brotliCompressSync(patched, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 9 },
    }),
  );
  if (!readFileSync(brotliPath).length)
    throw new Error('[patch-experience-state] failed to rewrite .br');
}

console.log(
  `[patch-experience-state] social sign-in state raised to 46 characters for VK OAuth 2.1 ` +
    `(gzip=${existsSync(gzipPath)}, brotli=${existsSync(brotliPath)})`,
);
