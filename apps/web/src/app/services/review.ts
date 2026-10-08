import { http } from './api';

/** Fila needs_review (Fase 4/5): GET + confirm + dismiss. */
export const reviewApi = {
  list: () => http.get('/review').then((r) => r.data),
  confirm: (id: string, body: unknown) =>
    http.post(`/review/${id}/confirm`, body).then((r) => r.data),
  dismiss: (id: string) => http.post(`/review/${id}/dismiss`).then((r) => r.data),
};
