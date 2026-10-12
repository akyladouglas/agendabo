import { http } from './api';

/**
 * Compartilhamento de agenda (spec `.ia/specs/compartilhamento/`, plano
 * `compartilhamento-agenda-par`): os 5 endpoints do vínculo. O token do convite
 * vai SEMPRE no BODY (decisão D10 — nunca em URL além da query da própria tela);
 * `POST /shared-agendas` é 202 uniforme para QUALQUER entrada (anti-enumeration
 * F.1 — a UI de "Reenviar" é neutra, sem contador); aceite/recusa ruins caem no
 * 410 `{code:'shared_invite_invalid'}` genérico único (A.5).
 */
export const sharedAgendasApi = {
  /** GET /shared-agendas — `{sent, received}` (A.10: enviados só email; recebidos nome). */
  list: () => http.get('/shared-agendas').then((r) => r.data),
  /** POST /shared-agendas — convida por email. 202 `{}` SEMPRE (D5). */
  invite: (body: unknown) => http.post('/shared-agendas', body).then((r) => r.data),
  /** POST /shared-agendas/accept — 204 no sucesso (token opaco no body). */
  accept: (body: unknown) => http.post('/shared-agendas/accept', body).then((r) => r.status),
  /** POST /shared-agendas/decline — 204; mesmo sabor de erro do aceite. */
  decline: (body: unknown) => http.post('/shared-agendas/decline', body).then((r) => r.status),
  /** POST /shared-agendas/:id/revoke — 204 (dono revoga OU convidado sai, A.9). */
  revoke: (id: string) => http.post(`/shared-agendas/${id}/revoke`).then((r) => r.status),
  /** GET /shared-agendas/audit — histórico paginado por vínculo (F.4). */
  audit: (params: { sharedAgendaId: string; cursor?: string; limit?: number }) =>
    http.get('/shared-agendas/audit', { params }).then((r) => r.data),
};
