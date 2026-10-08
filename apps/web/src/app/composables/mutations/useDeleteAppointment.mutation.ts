import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { toast } from 'vue-sonner';
import { appointmentsApi } from '../../services/appointments';
import { qk } from '../../config/queryKeys';

export function useDeleteAppointmentMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => appointmentsApi.remove(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.appointmentsAll });
      void qc.invalidateQueries({ queryKey: qk.review });
    },
    onError: () => toast.error('Algo deu errado, tente de novo.'),
  });
}
