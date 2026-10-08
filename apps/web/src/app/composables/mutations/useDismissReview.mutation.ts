import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { toast } from 'vue-sonner';
import { reviewApi } from '../../services/review';
import { qk } from '../../config/queryKeys';

/** POST /review/:id/dismiss — descartar em dois passos; some da fila e da agenda. */
export function useDismissReviewMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => reviewApi.dismiss(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.review });
      void qc.invalidateQueries({ queryKey: qk.appointmentsAll });
    },
    onError: () => toast.error('Algo deu errado, tente de novo.'),
  });
}
