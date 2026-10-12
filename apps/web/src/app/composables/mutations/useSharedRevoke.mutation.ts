import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { toast } from 'vue-sonner';
import { AxiosError } from 'axios';
import { sharedAgendasApi } from '../../services/shared-agendas';
import { qk } from '../../config/queryKeys';

/**
 * POST /shared-agendas/:id/revoke — dono REVОGA / convidado SAI (spec A.9):
 * mesmo endpoint, efeito imediato. Erro esperado: 404 genérico (linha
 * inexistente ou de terceiros) — mapeado para texto claro; em sucesso a
 * agenda emprestada some do outro lado na próxima consulta.
 */
export function useSharedRevokeMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => sharedAgendasApi.revoke(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.sharedAgendas });
      toast.success('Compartilhamento encerrado.');
    },
    onError: (err: unknown) => {
      const status = (err as AxiosError | undefined)?.response?.status;
      if (status === 404) toast.error('Esse compartilhamento não existe mais.');
      else toast.error('Algo deu errado, tente de novo.');
    },
  });
}
