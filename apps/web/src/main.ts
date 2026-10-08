import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import { setupQuery } from './app/config/query';
import { setupPinia } from './app/store/pinia';
import { useThemeStore } from './app/store/themeStore';
import './styles/main.css';

async function bootstrap(): Promise<void> {
  const app = createApp(App);
  setupPinia(app);
  setupQuery(app);
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
