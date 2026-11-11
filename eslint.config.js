import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'lib/**',
      'dist/**',
      'node_modules/**',
      'coverage/**',
      // Container-only diagnostic scripts and the mock provider are plain Node ESM run outside
      // this package's build; they are not part of the connector bundle.
      'mock-vkid/**',
      'docker/**',
      // The ESLint config file is not part of the TypeScript project.
      'eslint.config.js',
    ],
  },
  js.configs.recommended,
  // Type-aware linting: catches floating promises and misused promise handlers in a library whose
  // whole job is asynchronous I/O.
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
    },
  },
  {
    files: ['tests/**/*.ts', '*.config.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Test doubles implement Promise-returning APIs without real async work.
      '@typescript-eslint/require-await': 'off',
    },
  },
);
