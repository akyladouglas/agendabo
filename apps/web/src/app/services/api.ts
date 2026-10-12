import axios, { AxiosError } from 'axios';
import { env } from '../config/env';

/**
 * Cliente HTTP com refresh automático: access token só em memória (authStore);
 * refresh via cookie httpOnly com promise única deduplicada (padrão financas).
 */
export const http = axios.create({
  baseURL: env.apiBaseUrl,
  withCredentials: true,
});

let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/**
 * Instancia bruta (SEM interceptors) para rotas de auth que o interceptor de 401
 * nao pode tocar (refresh em si). Exportada para os testes espiarem o post do
 * refresh sem mockar o modulo axios inteiro.
 */
export const axiosRaw = axios.create({ withCredentials: true });

/**
 * Handler de sessao morta (spec sessao-24h "Web"): chamado quando o refresh
 * FALHA (qualquer 401) — quem registra e o main.ts via registerSessionExpiredHandler
 * (forceLogout + toast). Fica aqui (e nao na store) para services nao importarem
 * pinia/router: a borda inverte a dependencia (funcao registrada, nao import).
 */
let sessionExpiredHandler: (() => void) | null = null;

export function setSessionExpiredHandler(fn: (() => void) | null): void {
  sessionExpiredHandler = fn;
}

http.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

http.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as (typeof error.config & { _retried?: boolean }) | undefined;
    if (error.response?.status === 401 && original && !original._retried && !original.url?.includes('/auth/')) {
      original._retried = true;
      const token = await refreshOnce();
      if (token) return http(original);
    }
    throw error;
  },
);

async function refreshOnce(): Promise<string | null> {
  // DEDUPE por chamada: 3 queries que tomam 401 juntas = 1 POST /auth/refresh =
  // 1 rotação de cookie (revogar/rotacionar em série com racing derruba a sessão
  // válida). O dedupe DURA O TEMPO DO POST e nada mais: se a promise de bootstrap
  // (sessão morta no boot) fosse reusada depois de um login novo, o 401 pós-login
  // "refresharia" com o cookie PRÉ-LOGIN e o next() do guard rodaria antes do
  // token novo — login não navega (gotcha herdado do financas).
  inflightRefresh ??= doRefresh().finally(() => {
    inflightRefresh = null;
  });
  return inflightRefresh;
}

let inflightRefresh: Promise<string> | null = null;

async function doRefresh(): Promise<string> {
  try {
    const { data } = await axiosRaw.post<{ accessToken: string }>(
      `${env.apiBaseUrl}/auth/refresh`,
      {},
    );
    accessToken = data.accessToken;
    return data.accessToken;
  } catch {
    accessToken = null;
    // sessão morta "em runtime" (teto de 24h ou cookie sumiu): propaga a falha
    // para o handler registrado (store limpo + redirect + toast no chamador).
    // Sincronico e 1x por rotação: o dedupe do refreshOnce garante handler único
    // mesmo com N queries tomando 401 juntas.
    sessionExpiredHandler?.();
    throw new Error('refresh_failed');
  }
}

export const authApi = {
  signup: (body: unknown) => http.post('/auth/signup', body).then((r) => r.data),
  resendCode: (body: unknown) => http.post('/auth/resend-code', body).then((r) => r.data),
  verifyCode: (body: unknown) => http.post('/auth/verify-code', body).then((r) => r.data),
  login: (body: unknown) =>
    http
      .post<{ accessToken: string; user: unknown }>('/auth/login', body)
      .then((r) => r.data),
  /** POST /auth/refresh (chamado no bootstrap e pelo interceptor). */
  refreshRaw: () =>
    axiosRaw
      .post<{ accessToken: string; user: unknown }>(`${env.apiBaseUrl}/auth/refresh`, {})
      .then((r) => r.data),
  logout: () => http.post('/auth/logout').then((r) => r.data),
  /**
   * "Esqueci a senha" (spec esqueci-a-senha): a resposta é 202 uniforme para
   * QUALQUER e-mail — a UI mostra o mesmo estado neutro independentemente do resultado.
   */
  forgotPassword: (body: unknown) => http.post('/auth/forgot-password', body).then((r) => r.status),
  /** POST /auth/reset-password: 204 no sucesso; 410 `reset_token_invalid` genérico. */
  resetPassword: (body: unknown) => http.post('/auth/reset-password', body).then((r) => r.status),
};
