import { useMutation } from '@tanstack/vue-query';
import type { RelocationOptionsInput } from '@agendabo/contracts';
import { relocationOptionsResultSchema } from '@agendabo/contracts';
import { appointmentsApi } from '../../services/appointments';

/**
 * POST /appointments/relocation-options (Etapa 0 — Reagendamento Assistido):
 * as jogadas são calculadas SERVER-SIDE (`planRelocation` no schedule-core,
 * D1) — a web só presentationa. Só lê, não invalida nada. O 409 (2+ conflitos
 * = "não cabe") NÃO toastifica: o form trata inline (padrão do check-conflict).
 */
export function useRelocationOptionsMutation() {
  return useMutation({
    mutationFn: async (input: RelocationOptionsInput) =>
      relocationOptionsResultSchema.parse(await appointmentsApi.relocationOptions(input)),
  });
}
