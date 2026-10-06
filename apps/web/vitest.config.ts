import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

/**
 * Config de teste (Vitest) da web. A config de build fica em `vite.config.ts` —
 * separadas porque o Vitest 2 traz seu proprio vite 5, e a sobreposicao de tipos
 * na mesma imagem de config quebra o `vue-tsc -b` do build.
 */
const pkgAlias = (pkg: string) => ({
  find: `@agendabo/${pkg}`,
  replacement: fileURLToPath(new URL(`../../packages/${pkg}/src/index.ts`, import.meta.url)),
});

export default defineConfig({
  resolve: {
    alias: [
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      pkgAlias('contracts'),
      pkgAlias('schedule-core'),
    ],
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
  },
});
