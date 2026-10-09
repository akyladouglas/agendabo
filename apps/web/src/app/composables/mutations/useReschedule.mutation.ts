import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { toast } from 'vue-sonner';
import type { RescheduleAppointmentInput, RescheduleResult } from '@agendabo/contracts';
import { appointmentsApi } from '../../services/appointments';
import { qk } from '../../config/queryKeys';
import { conflictMessage } from '../../utils/conflict';

/**
 * POST /appointments/reschedule (Etapa 0): tx única que move/cria resolvendo o
 * conflito. Sem optimistic update (a cache é a verdade — D-W4). Invalida
 * `appointmentsAll` + `review`; o toast "Reagendado para <data hora>" fica a
 * cargo de quem chama (só o modal tem o fuso do usuário para formatar).
 * 409 NÃO toastifica: o modal re-consulta as jogadas (client obsoleto — D4).
 */
export function useRescheduleMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RescheduleAppointmentInput): Promise<RescheduleResult> =>
      appointmentsApi.reschedule(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.appointmentsAll });
      void qc.invalidateQueries({ queryKey: qk.review });
    },
    onError: (err) => {
      if (!conflictMessage(err)) toast.error('Algo deu errado, tente de novo.');
    },
  });
}
