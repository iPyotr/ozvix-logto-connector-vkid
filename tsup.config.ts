import { defineConfig } from 'tsup';

/**
 * Build configuration for the Logto connector package.
 *
 * Logto loads a connector by importing `<connector-dir>/lib/index.js`, so:
 * - the entry must emit `lib/index.js`;
 * - the output must be ESM (`"type": "module"`), because the package is loaded with a
 *   dynamic `import()` from `@logto/cli` (which itself is ESM);
 * - `@logto/connector-kit` MUST stay external. Logto compares `ConnectorError` instances and
 *   relies on a single copy of the kit being loaded; bundling it would create a second class
 *   identity and break error handling. `zod` is kept external for the same single-instance reason.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  external: ['@logto/connector-kit', 'zod'],
});
