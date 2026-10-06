import { VueQueryPlugin } from '@tanstack/vue-query';
import type { App } from 'vue';

export function setupQuery(app: App): void {
  app.use(VueQueryPlugin, {
    queryClientConfig: {
      defaultOptions: {
        queries: {
          // Os dados mudam por fora (bot do Telegram agenda compromissos).
          refetchOnWindowFocus: true,
          refetchOnReconnect: true,
          staleTime: 30_000,
        },
      },
    },
  });
}
