import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { toast } from 'vue-sonner';
import { observabilityApi } from '../../services/observability';
import { qk } from '../../config/queryKeys';

/**
 * PATCH /admin/users/:id/observabilidade — liga/desliga o rollout por usuário.
 * Sucesso revalida a lista (a flag volta do server, nunca do optimistic state).
 */
export function useSetRolloutMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; ativo: boolean }) =>
      observabilityApi.setRollout(vars.id, vars.ativo),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.adminUsers });
      toast.success('Rollout atualizado.');
    },
    onError: () => toast.error('Algo deu errado, tente de novo.'),
  });
}
