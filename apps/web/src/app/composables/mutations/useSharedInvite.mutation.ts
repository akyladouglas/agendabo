import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { toast } from 'vue-sonner';
import { sharedInviteInputSchema } from '@agendabo/contracts';
import { sharedAgendasApi } from '../../services/shared-agendas';
import { qk } from '../../config/queryKeys';

/**
 * POST /shared-agendas — convidar/reenviar (spec A.2/A.4). A API responde
 * 202 `{}` para QUALQUER entrada (anti-enumeration F.1/D5: quota estourada,
 * email inexistente, autoconvite — tudo idêntico), então o toast é SEMPRE o
 * mesmo texto neutro e NÃO há contador de reenvio na UI (decisão D.21).
 * O reenvio real (novo token) só é visível como um `inviteSentAt` novo quando a
 * lista revalida — por isso o invalidate.
 */
export function useSharedInviteMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: unknown) => {
      const body = sharedInviteInputSchema.parse(input);
      return sharedAgendasApi.invite(body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.sharedAgendas });
      toast.success('Convite enviado. Se o e-mail não corresponder a uma conta ativa, nada acontece.');
    },
    onError: () => toast.error('Algo deu errado, tente de novo.'),
  });
}
