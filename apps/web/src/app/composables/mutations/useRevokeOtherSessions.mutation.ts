import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { toast } from 'vue-sonner';
import { revokeOtherSessionsResultSchema } from '@agendabo/contracts';
import { sessionsApi } from '../../services/sessions';
import { qk } from '../../config/queryKeys';

/**
 * DELETE /auth/sessions — encerra todas as OUTRAS sessões (a atual sobrevive).
 * Toast de sucesso no onSuccess (padrão das mutations do repo); se não havia
 * nenhuma outra (revoked 0), avisa em tom neutro em vez de celebrar.
 */
export function useRevokeOtherSessionsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      revokeOtherSessionsResultSchema.parse(await sessionsApi.revokeOthers()),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: qk.sessions });
      if (data.revoked > 0) toast.success('Sessões encerradas.');
      else toast.info('Nenhuma outra sessão para encerrar.');
    },
    onError: () => toast.error('Algo deu errado, tente de novo.'),
  });
}
