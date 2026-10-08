import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { toast } from 'vue-sonner';
import type { AppointmentDto, UpdateAppointmentInput } from '@agendabo/contracts';
import { appointmentsApi } from '../../services/appointments';
import { qk } from '../../config/queryKeys';
import { conflictMessage } from '../../utils/conflict';

export function useUpdateAppointmentMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: UpdateAppointmentInput & { id: string }) =>
      (await appointmentsApi.update(id, input)) as AppointmentDto & {
        droppedRules?: string[];
      },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.appointmentsAll });
      void qc.invalidateQueries({ queryKey: qk.review });
    },
    onError: (err) => {
      if (!conflictMessage(err)) toast.error('Algo deu errado, tente de novo.');
    },
  });
}
