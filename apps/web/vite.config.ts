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
    // instância única de vue/vee-validate no dev (evita otimizar duas versões
    // lado a lado — bug observado: useField de outra cópia ≠ reatividade do app)
    dedupe: ['vue', 'vee-validate', '@vee-validate/zod'],
    alias: [
      {
        find: '@',
        replacement: fileURLToPath(new URL('./src', import.meta.url)),
      },
      pkgAlias('contracts'),
      pkgAlias('schedule-core'),
    ],
  },
  optimizeDeps: {
    include: ['vee-validate', '@vee-validate/zod'],
  },
  server: {
    port: 5174,
    host: true, // expoe na LAN (teste de touch em celular — docs/mobile-touch-test.md)
    proxy: {
      // proxy de dev: API não usa prefixo /api; reescreve antes de ir ao proxy
      '/api': {
        // 127.0.0.1 (e nao 'localhost'): com `host: true` acessado de outro
        // dispositivo, 'localhost' no Windows resolve p/ ::1 e o proxy pode
        // nao achar a API em IPv6 — mobile touch test (docs/mobile-touch-test.md)
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/api/, ''),
      },
    },
  },
});
