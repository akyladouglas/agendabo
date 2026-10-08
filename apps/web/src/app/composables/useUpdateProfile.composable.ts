import { updateProfileResultSchema, type UpdateProfileInput } from '@agendabo/contracts';
import { usersApi } from '../services/users';
import { useAuthStore, type SessionUser } from '../store/authStore';

/**
 * PATCH /me (perfil): resposta validada pelo zod dos contracts e o authStore é
 * atualizado na hora — header/perfil refletem o novo valor imediatamente.
 * Falha LANÇA (quem chama toastifica); estado parcial nunca fica no store.
 */
export async function updateProfile(input: UpdateProfileInput): Promise<SessionUser> {
  const user = updateProfileResultSchema.parse(await usersApi.updateMe(input));
  const auth = useAuthStore();
  if (auth.user) auth.setUser({ ...auth.user, ...user });
  return user;
}
