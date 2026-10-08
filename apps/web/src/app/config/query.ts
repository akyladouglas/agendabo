import { VueQueryPlugin } from '@tanstack/vue-query';
import type { App } from 'vue';

export function setupQuery(app: App): void {
  app.use(VueQueryPlugin, {
    queryClientConfig: {
      defaultOptions: {
        queries: {
          // Os dados mudam por fora (bot do Telegram agenda compromissos), mas
          // só na sessão do usuário → revalidar ao reconectar/ganhar foco, não
          // a cada montagem de página (senão a navegação re-busca tudo sempre).
          refetchOnWindowFocus: true,
          refetchOnReconnect: true,
          staleTime: 30_000,
          gcTime: 5 * 60_000,
        },
      },
    },
  });
}
