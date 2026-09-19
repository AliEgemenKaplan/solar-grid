import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/generated/**', '**/node_modules/**', '**/coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // Nest wires classes through decorators, so parameter properties and
      // empty constructors are normal here.
      '@typescript-eslint/no-empty-function': ['error', { allow: ['constructors'] }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          // `const { a, b, ...rest } = obj` is how you omit properties; the
          // named ones are the point, not an oversight.
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    // The operator dashboard runs in a browser, and React's rules of hooks are
    // the ones most worth a machine checking.
    files: ['frontend/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat.recommended,
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      // Nothing in the dashboard writes to the console: a stray log is how a
      // token ends up somewhere it should not be.
      'no-console': 'error',
    },
  },
  {
    files: ['frontend/vite.config.ts', 'frontend/vitest.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Test doubles stand in for Prisma clients and HTTP clients; typing them
    // fully would test the mocks rather than the code.
    files: ['**/test/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  prettier,
);
