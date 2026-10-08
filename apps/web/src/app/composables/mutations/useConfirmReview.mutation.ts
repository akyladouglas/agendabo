import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { toast } from 'vue-sonner';
import type { ReviewConfirmInput } from '@agendabo/contracts';
import { reviewApi } from '../../services/review';
import { qk } from '../../config/queryKeys';
import { conflictMessage } from '../../utils/conflict';

/**
 * POST /review/:id/confirm — aprovar 1-clique (valores atuais) OU corrigir (form).
 * Conflito 409 => o item CONTINUA na fila (a UI mostra o conflito, nada invalida).
 */
export function useConfirmReviewMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: ReviewConfirmInput & { id: string }) =>
      reviewApi.confirm(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.review });
      void qc.invalidateQueries({ queryKey: qk.appointmentsAll });
    },
    onError: (err) => {
      if (!conflictMessage(err)) toast.error('Algo deu errado, tente de novo.');
    },
  });
}
