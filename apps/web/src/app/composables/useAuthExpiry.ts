import { toast } from 'vue-sonner';
import { setSessionExpiredHandler } from '../services/api';
import { useAuthStore } from '../store/authStore';

/**
 * Registro do handler de sessão expirada (spec sessao-24h "Web"): chamado pelo
 * main.ts depois de instalar o pinia. Quando o refresh falha (401 session_expired
 * ou cookie morto), o api.ts chama isto → store limpo + redirect /login + toast.
 * O toast mora AQUI (e não no forceLogout) para o boot silencioso poder limpar
 * o estado sem toastificar (forçaLogout é o mesmo, sem toast).
 */
export function registerSessionExpiredHandler(): void {
  setSessionExpiredHandler(() => {
    // toast ANTES do store: se o pinia ainda nao existe (refresh do bootstrap
    // morrendo antes do setupPinia), o forceLogout lanca e o try/catch so
    // protege o STATE — o aviso ja saiu e o estado ja e limpo por construcao.
    toast.warning('Sua sessão expirou. Entre novamente.');
    try {
      useAuthStore().forceLogout();
    } catch {
      /* pinia nao instalado: sem store a limpar nem redirect a fazer */
    }
  });
}
