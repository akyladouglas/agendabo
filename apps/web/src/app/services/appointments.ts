import { http } from './api';

/** GET /appointments?from=&to= (datas ISO UTC — o período vem do schedule-core). */
export const appointmentsApi = {
  /**
   * `owner` opcional (spec compartilhamento B.12): ausente = agenda própria
   * (resposta de sempre); presente = agenda EMPRESTADA do dono (payload
   * `sharedAppointmentListResultSchema` — subconjunto sem rawText/reviewReason/
   * notificationRules, só confirmed; sem vínculo ativo = 403 uniforme).
   */
  list: (from: string, to: string, owner?: string | null) =>
    http
      .get('/appointments', {
        params: { from, to, ...(owner ? { owner } : {}) },
      })
      .then((r) => r.data),
  create: (body: unknown) => http.post('/appointments', body).then((r) => r.data),
  update: (id: string, body: unknown) =>
    http.patch(`/appointments/${id}`, body).then((r) => r.data),
  remove: (id: string) => http.delete(`/appointments/${id}`).then((r) => r.data),
  checkConflict: (body: unknown) =>
    http.post('/appointments/check-conflict', body).then((r) => r.data),
  /** Reagendamento Assistido (Etapa 0): jogadas lidas server-side (nada em query param). */
  relocationOptions: (body: unknown) =>
    http.post('/appointments/relocation-options', body).then((r) => r.data),
  reschedule: (body: unknown) => http.post('/appointments/reschedule', body).then((r) => r.data),
};
