import { http } from './api';

/**
 * Gestão de sessões (spec sessao-24h): GET lista as sessões ativas (a atual
 * marcada `current`); DELETE revoga todas as OUTRAS e mantém a atual.
 */
export const sessionsApi = {
  list: () => http.get('/auth/sessions').then((r) => r.data),
  revokeOthers: () => http.delete('/auth/sessions').then((r) => r.data),
};
