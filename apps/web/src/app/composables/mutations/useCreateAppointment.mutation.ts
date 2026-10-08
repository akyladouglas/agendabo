import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { toast } from 'vue-sonner';
import type { AppointmentDto, CreateAppointmentInput } from '@agendabo/contracts';
import { appointmentsApi } from '../../services/appointments';
import { qk } from '../../config/queryKeys';
import { conflictMessage } from '../../utils/conflict';

/**
 * POST /appointments (origem `web`). O response traz `droppedRules` (tipos de regra
 * com gatilho no passado) — quem chama decide o aviso (decisão 3 da spec web).
 * Conflito 409 NÃO toastifica: o form mostra a mensagem inline (critério Gherkin).
 */
export function useCreateAppointmentMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateAppointmentInput) =>
      (await appointmentsApi.create(input)) as AppointmentDto & {
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
