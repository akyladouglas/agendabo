import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { LoginResult } from '@agendabo/contracts';
import { setTrackerUser } from '../config/errorTracker';
import { authApi, setAccessToken } from '../services/api';

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

  function logout(): void {
    void authApi.logout().catch(() => undefined);
    setAccessToken(null);
    user.value = null;
  }

  function setUser(u: SessionUser | null): void {
    user.value = u;
    // tracker: só o uuid interno (ADR-0016); logout/null = evento sem user
    setTrackerUser(u?.id ?? null);
  }

  return { user, isLoggedIn, login, logout, setUser };
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
    setAccessToken(null);
  }
}
