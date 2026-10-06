import { defineConfig } from 'vitest/config';

/**
 * Vitest da api: dominio PURO (funções/services sem DI do Nest) — ver testing.md.
 * Services Nest com mock plano ficam no jest (`*.service.spec.ts`, jest.config.js),
 * entao sao explicitamente excluidos daqui.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    exclude: ['**/*.service.spec.ts', '**/node_modules/**', '**/dist/**'],
  },
});
