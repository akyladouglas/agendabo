import { useMutation } from '@tanstack/vue-query';
import { authApi } from '../../services/api';

/**
 * POST /auth/forgot-password (spec esqueci-a-senha regra 12): a resposta é 202
 * uniforme para QUALQUER e-mail (anti-enumeration); a página mostra o estado
 * neutro fixo independentemente do resultado, então a mutation só expõe o fetch.
 */
export function useForgotPasswordMutation() {
  return useMutation({
    mutationFn: (input: { email: string }) => authApi.forgotPassword(input),
  });
}
