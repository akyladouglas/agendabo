import { useMutation } from '@tanstack/vue-query';
import { authApi } from '../../services/api';

/**
 * POST /auth/reset-password (spec esqueci-a-senha regra 13/14): 204 no sucesso
 * (sem login automático — a página redireciona para /login); o 410
 * `reset_token_invalid` genérico chega como erro da mutation e a página traduz
 * para o card "Link inválido ou expirado".
 */
export function useResetPasswordMutation() {
  return useMutation({
    mutationFn: (input: { token: string; password: string }) =>
      authApi.resetPassword(input),
  });
}
