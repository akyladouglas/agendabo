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
  // NUNCA deduplicar com ??= aqui: se a promise de bootstrap (sessão morta no boot)
  // for reusada depois de um login novo, o 401 pós-login "refresha" com o cookie
  // PRÉ-LOGIN e o next() do guard roda antes do token novo — login não navega.
  try {
    const { data } = await axios.post<{ accessToken: string }>(
      `${env.apiBaseUrl}/auth/refresh`,
      {},
      { withCredentials: true },
    );
    accessToken = data.accessToken;
    return data.accessToken;
  } catch {
    accessToken = null;
    return null;
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
    axios
      .post<{ accessToken: string; user: unknown }>(`${env.apiBaseUrl}/auth/refresh`, {}, {
        withCredentials: true,
      })
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
