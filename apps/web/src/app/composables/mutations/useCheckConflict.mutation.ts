import { useMutation } from '@tanstack/vue-query';
import type { CheckConflictInput } from '@agendabo/contracts';
import { checkConflictResultSchema } from '@agendabo/contracts';
import { appointmentsApi } from '../../services/appointments';

/** POST /appointments/check-conflict — pré-visualização inline do form (não invalida nada). */
export function useCheckConflict() {
  return useMutation({
    mutationFn: async (input: CheckConflictInput) =>
      checkConflictResultSchema.parse(await appointmentsApi.checkConflict(input)),
  });
}
