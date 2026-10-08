import { http } from './api';

/** PATCH /me — edição do perfil (1 chamada por arquivo — vue.md). */
export const usersApi = {
  updateMe: (body: unknown) => http.patch('/me', body).then((r) => r.data),
};
