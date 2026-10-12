import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import { setupQuery } from './app/config/query';
import { setupErrorTracker } from './app/config/errorTracker';
import { setupPinia } from './app/store/pinia';
import { useThemeStore } from './app/store/themeStore';
import { registerSessionExpiredHandler } from './app/composables/useAuthExpiry';
import './styles/main.css';

async function bootstrap(): Promise<void> {
  const app = createApp(App);
  setupPinia(app);
  setupQuery(app);
  // sessao 24h: refresh que falha em runtime (teto/cookie morto) limpa o store,
  // redireciona para /login e toastifica — registrado apos o pinia existir.
  registerSessionExpiredHandler();
  // tracker antes do mount: erros de boot/render sobem (Fase 9/ADR-0016)
  setupErrorTracker(app);
  // tema antes do router: evita flash claro no primeiro paint (default é escuro)
  useThemeStore().init();
  // bootstrap da sessao (refresh + me) ANTES de instalar o router:
  // os guards disparam no install do router (gotcha herdado do financas).
  const { bootstrapSession } = await import('./app/store/authStore');
  await bootstrapSession();
  app.use(router);
  app.mount('#app');
}

void bootstrap();
