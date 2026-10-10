import js from '@eslint/js';
import globals from 'globals';
import eslintConfigPrettier from 'eslint-config-prettier/flat';

export default [
  {
    ignores: ['**/node_modules/**', 'career-ops/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // page.evaluate() runs this callback in Chromium, not in Node.
    files: ['10-20 Modules/01_jd-ready/jd-fetch.mjs'],
    languageOptions: {
      globals: {
        document: 'readonly',
      },
    },
  },
  eslintConfigPrettier,
];
