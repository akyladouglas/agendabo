import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

/**
 * Aliases para o FONTE .ts dos packages (ADR-005): os packages compilam CJS para o
 * Nest; a web consome o fonte direto para evitar CJS no browser.
 * MANTER SINCRONIZADO com `paths` em tsconfig.app.json (gotcha 3).
 */
const pkgAlias = (pkg: string) => ({
  find: `@agendabo/${pkg}`,
  replacement: fileURLToPath(new URL(`../../packages/${pkg}/src/index.ts`, import.meta.url)),
});

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: [
      {
        find: '@',
        replacement: fileURLToPath(new URL('./src', import.meta.url)),
      },
      pkgAlias('contracts'),
      pkgAlias('schedule-core'),
    ],
  },
  server: {
    port: 5174,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
});
