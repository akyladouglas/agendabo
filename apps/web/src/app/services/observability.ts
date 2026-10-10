import { http } from './api';

/**
 * Observabilidade (Fase 9 — página Admin): leitura de auditoria + rollout.
 * As rotas guardam no server (admin / flag de rollout); a web só mostra o que
 * a API confirma (`/observabilidade/me`).
 */
export const observabilityApi = {
  /** GET /observabilidade/me — isAdmin + rollout do chamador (fonte = banco). */
  me: () => http.get('/observabilidade/me').then((r) => r.data),
  /** GET /bot-events — filtros técnicos; nunca identidade digitada na query. */
  listEvents: (params: Record<string, string | number | undefined>) =>
    http.get('/bot-events', { params }).then((r) => r.data),
  /** GET /llm-usage — admin-only (o cliente nunca vê custo). */
  llmUsage: (params: Record<string, string | undefined>) =>
    http.get('/llm-usage', { params }).then((r) => r.data),
  /** GET /admin/users — lista mínima p/ o filtro de eventos (admin-only). */
  listUsers: () => http.get('/admin/users').then((r) => r.data),
  /** PATCH /admin/users/:id/observabilidade — liga/desliga o rollout (admin-only). */
  setRollout: (id: string, ativo: boolean) =>
    http
      .patch(`/admin/users/${id}/observabilidade`, { observabilidadeEventosAtivo: ativo })
      .then((r) => r.data),
};
