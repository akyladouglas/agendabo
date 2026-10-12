import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { LoginResult } from '@agendabo/contracts';
import { setTrackerUser } from '../config/errorTracker';
import { authApi, setAccessToken } from '../services/api';
import { router } from '@/router';

export interface SessionUser {
  id: string;
  email: string;
  /** Nome (decisão 7 da spec web); null = conta sem nome. */
  name: string | null;
  timezone: string;
  resumoDiarioHora: string;
  /** Resumo diário ligado/desligado (flag `resumoDiarioAtivo`). */
  resumoDiarioAtivo: boolean;
  /** Fase 9: visibilidade de rota admin na web (a guarda real é do server). */
  isAdmin: boolean;
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<SessionUser | null>(null);
  const isLoggedIn = computed(() => user.value !== null);

  async function login(email: string, password: string): Promise<void> {
    const result = (await authApi.login({ email, password })) as LoginResult;
    setAccessToken(result.accessToken);
    user.value = result.user as SessionUser;
  }

  async function logout(): Promise<void> {
    // logout explicito: a API SEMPRE retorna 200 (revoga tudo no banco); ainda
    // assim aguardamos ANTES de limpar/redirect para nao haver janela de
    // "logado" com cookie morto. Falha de rede nao trava o logout local.
    await authApi.logout().catch(() => undefined);
    forceLogout();
  }

  /**
   * Sessao morta/encerrada: limpa estado e redireciona SEM chamar a API
   * (D7 do plano sessao-24h — router singleton importado DIRETO, como o main.ts).
   * O circulo ESM store↔router é inofensivo: o router só executa os middlewares
   * (que importam esta store) em navegações, nunca na criação do singleton — e
   * `router` aqui é acessado só quando a função RODA (nunca no import do store).
   * O redirect é ASSÍNCRONO: `await` propaga para o logout() explícito (ordem
   * API→redirect testável) e vira fire-and-forget seguro no forceLogout() nu
   * (chamado pelo handler/interceptor, que não aguarda).
   * Toast fica no CHAMADOR (handler do main.ts): boot silencioso não toastifica.
   */
  async function forceLogout(): Promise<void> {
    setAccessToken(null);
    setUser(null);
    await router.replace('/login');
  }

  function setUser(u: SessionUser | null): void {
    user.value = u;
    // tracker: só o uuid interno (ADR-0016); logout/null = evento sem user
    setTrackerUser(u?.id ?? null);
  }

  return { user, isLoggedIn, login, logout, forceLogout, setUser };
});

/** Chamado no bootstrap, antes de app.use(router): restaura sessão via refresh cookie. */
export async function bootstrapSession(): Promise<void> {
  const { authApi, setAccessToken } = await import('../services/api');
  try {
    const data = await authApi.refreshRaw();
    setAccessToken(data.accessToken);
    const { useAuthStore } = await import('./authStore');
    useAuthStore().setUser(data.user as SessionUser);
  } catch {
    // sessao morta no boot (inclusive 401 session_expired): MESMO forceLogout
    // do runtime — store limpo e estado coerente antes do router instalar. Em
    // boot o redirect e no-op seguro (a guarda ja levaria a /login) e NAO ha
    // toast: o usuario ainda nao esta na area logada (evita toast duplo/fantasma).
    setAccessToken(null);
    const { useAuthStore } = await import('./authStore');
    useAuthStore().forceLogout();
  }
}
