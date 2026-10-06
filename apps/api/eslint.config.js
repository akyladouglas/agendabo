import js from '@eslint/js';
import prettier from 'eslint-plugin-prettier';
import tseslint from 'typescript-eslint';

/**
 * Arquitetura: SDKs de terceiros so dentro dos seus modulos (padrao financas).
 * `ignores` por objeto NAO filtra `rules` globais no flat config — por isso cada
 * regra restritiva vive num bloco com `files` proprio.
 */
const SRC = ['src/**/*.ts'];

export default tseslint.config(
  {
    // Pontas sincronizadas, build e configs: fora do lint.
    ignores: [
      'dist/**',
      'coverage/**',
      'eslint-report.json',
      'eslint.config.js',
      '.dependency-cruiser.cjs',
      'jest.config.js',
      'vitest.config.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Arquivos de config CommonJS (.cjs/.js): sem regras de modulo ESM/TS.
    files: ['**/*.cjs', '**/*.js'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-undef': 'off',
    },
  },
  {
    plugins: { prettier },
    rules: {
      'prettier/prettier': ['warn', { printWidth: 100, singleQuote: true, semi: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'warn',
    },
  },
  {
    files: SRC,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@anthropic-ai/sdk',
              message: 'Anthropic SDK so em src/modules/ai/. Use AnthropicMessagesClient.',
            },
          ],
          patterns: [
            {
              group: ['telegraf', 'telegraf/*'],
              message: 'Telegram so em src/shared/telegram/ e src/modules/bot/.',
            },
            {
              group: ['resend', 'resend/*'],
              message: 'Email so via MailService (src/modules/auth/mail.service.ts).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/modules/ai/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['src/shared/telegram/**/*.ts', 'src/modules/bot/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@anthropic-ai/sdk', 'resend', 'resend/*'],
              message: 'Fora da jurisdicao deste modulo (ver ai.module.ts / mail.service.ts).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/modules/auth/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['telegraf', 'telegraf/*', '@anthropic-ai/sdk'],
              message: 'Fora da jurisdicao deste modulo.',
            },
          ],
        },
      ],
    },
  },
);
