import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { toast } from 'vue-sonner';
import { sharedInviteTokenSchema } from '@agendabo/contracts';
import { sharedAgendasApi } from '../../services/shared-agendas';
import { qk } from '../../config/queryKeys';

/**
 * POST /shared-agendas/accept (spec A.7/D.22): o token opaco vai no BODY
 * (decisão D10 — nunca em URL além da query da própria tela). Sucesso = 204 →
 * invalida `qk.sharedAgendas` (o seletor de fonte e o perfil ligam no novo
 * vínculo). Token ruim/expirado/para-outro-destinatário = 410
 * `{code:'shared_invite_invalid'}` — TODOS os sabores caem no MESMO card
 * genérico da página (A.5): este mutation só repassa o erro, sem toast aqui
 * (a página decide o card único).
 */
export function useSharedAcceptMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (token: string) => {
      const body = sharedInviteTokenSchema.parse({ token });
      return sharedAgendasApi.accept(body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.sharedAgendas });
      toast.success('Convite aceito — a agenda já aparece no seletor de fonte.');
    },
  });
}
