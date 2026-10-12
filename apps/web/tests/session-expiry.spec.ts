import { describe, expect, it, vi } from 'vitest';

/**
 * O router singleton e mockado SEM importActual: o router real de fato e criado
 * na coleta deste arquivo, e `createWebHistory` com URL de teste atrasada de um
 * "dia" (relogio real em evolucao entre arquivos) corrompe o Date da ILP do
 * worker e faz testes de OUTROS arquivos verem "amanha" (visto em
 * appointment-form-end no run completo). O mock e so o objeto com `replace`.
 */
const state = vi.hoisted(() => ({
  replace: vi.fn<() => Promise<unknown>>(),
}));

vi.mock('../src/router', () => ({
  router: { get replace() { return state.replace; } },
}));

vi.mock('vue-sonner', () => ({
  toast: Object.assign(() => undefined, {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

import * as api from '../src/app/services/api';
import { useAuthStore } from '../src/app/store/authStore';
import { toast } from 'vue-sonner';
import { createPinia, setActivePinia } from 'pinia';
import type { AxiosError, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';

const USER = {
  id: 'u1',
  email: 'ana@email.com',
  name: 'Ana',
  timezone: 'UTC',
  resumoDiarioHora: '08:00',
  resumoDiarioAtivo: true,
  isAdmin: false,
};

function freshStore() {
  setActivePinia(createPinia());
  const auth = useAuthStore();
  auth.setUser(USER);
  api.setAccessToken('tok');
  return auth;
}

/** Extrai o rejeitador do interceptor de resposta do `http` (registro real). */
function rejectedInterceptor(): (e: AxiosError) => Promise<unknown> {
  const handlers = (
    api.http.interceptors.response as unknown as {
      handlers: Array<{ rejected?: (e: AxiosError) => Promise<unknown> }>;
    }
  ).handlers;
  const h = handlers.find((x) => x.rejected);
  if (!h?.rejected) throw new Error('interceptor de resposta nao encontrado');
  return h.rejected;
}

function unauthorizedOn(url: string): AxiosError {
  return Object.assign(new Error('http'), {
    isAxiosError: true,
    response: { status: 401 },
    config: { url } as InternalAxiosRequestConfig & AxiosRequestConfig,
  }) as AxiosError;
}

function refreshFails401() {
  return vi.spyOn(api.axiosRaw, 'post').mockRejectedValue(
    Object.assign(new Error('unauthorized'), { response: { status: 401 } }),
  );
}

describe('authStore.forceLogout (D7 do plano)', () => {
  it('limpa user + access token e redireciona para /login SEM chamar a API', async () => {
    const auth = freshStore();
    const logoutSpy = vi.spyOn(api.authApi, 'logout').mockResolvedValue(undefined);
    state.replace.mockReset().mockResolvedValue(undefined);

    await auth.forceLogout();

    expect(auth.user).toBeNull();
    expect(auth.isLoggedIn).toBe(false);
    expect(state.replace).toHaveBeenCalledWith('/login');
    expect(logoutSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe('api: refresh 401 dispara o handler de sessao expirada', () => {
  it('401 em rota de negocio → refreshOnce roda → refresh 401 → handler 1x', async () => {
    const handler = vi.fn();
    api.setSessionExpiredHandler(handler);
    api.setAccessToken('tok-velho');
    const postSpy = refreshFails401();

    // o que importa: a promise REJEITA (o 401 continua subindo p/ a query) e o
    // handler roda exatamente 1x — quem registra decide store/toast/redirect.
    await expect(rejectedInterceptor()(unauthorizedOn('/appointments'))).rejects.toBeTruthy();

    expect(postSpy).toHaveBeenCalled();
    expect(handler).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
    api.setSessionExpiredHandler(null);
  });

  it('sem handler registrado: nada explode extra, a promise so rejeita', async () => {
    api.setSessionExpiredHandler(null);
    refreshFails401();

    await expect(rejectedInterceptor()(unauthorizedOn('/appointments'))).rejects.toBeTruthy();
    vi.restoreAllMocks();
  });

  it('handler NAO dispara para 401 em rota /auth/ (refresh nao roda la)', async () => {
    const handler = vi.fn();
    api.setSessionExpiredHandler(handler);
    const postSpy = refreshFails401();

    await expect(rejectedInterceptor()(unauthorizedOn('/auth/login'))).rejects.toBeTruthy();

    expect(postSpy).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    api.setSessionExpiredHandler(null);
  });
});

describe('authStore.logout (logout explicito)', () => {
  it('aguarda POST /auth/logout ANTES de limpar estado e redirecionar', async () => {
    const auth = freshStore();
    state.replace.mockReset();

    const order: string[] = [];
    vi.spyOn(api.authApi, 'logout').mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push('api');
    });
    state.replace.mockImplementation(async () => {
      order.push('redirect');
    });

    await auth.logout();

    expect(order).toEqual(['api', 'redirect']);
    expect(auth.user).toBeNull();
    expect(state.replace).toHaveBeenCalledWith('/login');
    vi.restoreAllMocks();
  });

  it('redireciona mesmo se a API falhar (logout local nunca trava)', async () => {
    const auth = freshStore();
    state.replace.mockReset().mockResolvedValue(undefined);
    vi.spyOn(api.authApi, 'logout').mockRejectedValue(new Error('offline'));

    await auth.logout();

    expect(auth.user).toBeNull();
    expect(state.replace).toHaveBeenCalledWith('/login');
    vi.restoreAllMocks();
  });
});

describe('handler de expiracao registrado no main (contrato do bootstrap)', () => {
  it('limpa o store + toast da spec + redirect — exatamente o que o main.ts registra', async () => {
    // helper que o main.ts usa (mesma implementacao, amarrada pelo teste)
    const { registerSessionExpiredHandler } = await import('../src/app/composables/useAuthExpiry');
    const auth = freshStore();
    state.replace.mockReset().mockResolvedValue(undefined);
    registerSessionExpiredHandler();

    // dispara pelo caminho real: 401 → refresh 401 → handler
    refreshFails401();
    await expect(rejectedInterceptor()(unauthorizedOn('/appointments'))).rejects.toBeTruthy();
    // forceLogout do handler e fire-and-forget: aguarda o redirect resolver
    await new Promise((r) => setTimeout(r, 0));

    expect(auth.user).toBeNull();
    expect(toast.warning).toHaveBeenCalledWith('Sua sessão expirou. Entre novamente.');
    expect(state.replace).toHaveBeenCalledWith('/login');
    vi.restoreAllMocks();
    api.setSessionExpiredHandler(null);
  });
});
