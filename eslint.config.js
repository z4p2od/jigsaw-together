import js from '@eslint/js';
import globals from 'globals';
import n from 'eslint-plugin-n';

const commonRules = {
  ...js.configs.recommended.rules,
  'no-unused-vars': [
    'warn',
    {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrors: 'none',
    },
  ],
};

/** @type {import('eslint').Linter.Config[]} */
export default [
  { ignores: ['node_modules/**', 'coverage/**', 'test/**', '.vercel/**'] },
  {
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      ...commonRules,
      'no-console': 'off',
    },
  },
  {
    files: ['api/**/*.js'],
    plugins: { n },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...commonRules,
      ...n.configs['recommended-module'].rules,
      'no-console': 'off',
      'n/no-unsupported-features/node-builtins': 'off',
    },
  },
  {
    files: ['lib/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: { ...commonRules, 'no-console': 'off' },
  },
];
