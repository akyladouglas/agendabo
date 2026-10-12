import { useMutation } from '@tanstack/vue-query';
import { toast } from 'vue-sonner';
import { sharedInviteTokenSchema } from '@agendabo/contracts';
import { sharedAgendasApi } from '../../services/shared-agendas';

/**
 * POST /shared-agendas/decline (spec A.8): recusa explícita do convite —
 * vínculo `pending` vira `revoked`. 204 no sucesso; os sabores de token ruim
 * são o MESMO 410 genérico do aceite (A.5 — a página mostra o card único).
 * Sem invalidate: vínculo recusado não muda o seletor (só ativos aparecem) e
 * o perfil revalida quando for aberto de novo.
 */
export function useSharedDeclineMutation() {
  return useMutation({
    mutationFn: async (token: string) => {
      const body = sharedInviteTokenSchema.parse({ token });
      return sharedAgendasApi.decline(body);
    },
    onSuccess: () => {
      toast.success('Convite recusado.');
    },
  });
}
