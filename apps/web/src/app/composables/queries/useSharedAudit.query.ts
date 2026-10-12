import { computed, type Ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { sharedAuditPageSchema } from '@agendabo/contracts';
import { sharedAgendasApi } from '../../services/shared-agendas';
import { qk } from '../../config/queryKeys';

/**
 * GET /shared-agendas/audit — "Histórico" de um vínculo (spec F.4): paginado por
 * cursor opaco. Uma página por chave (`qk.sharedAudit(linkId, cursor)`); o painel
 * acumula as páginas em estado local e "Carregar mais" avança o cursor do
 * `nextCursor` da última página consumida. 404 sem acesso ao vínculo cai no
 * estado de erro do painel. `enabled` reativo: o painel só consulta aberto.
 */
export function useSharedAuditQuery(
  linkId: () => string,
  cursor: Ref<string | null>,
  enabled?: Ref<boolean>,
) {
  return useQuery({
    queryKey: computed(() => qk.sharedAudit(linkId(), cursor.value)),
    queryFn: async () =>
      sharedAuditPageSchema.parse(
        await sharedAgendasApi.audit({
          sharedAgendaId: linkId(),
          ...(cursor.value ? { cursor: cursor.value } : {}),
        }),
      ),
    ...(enabled ? { enabled } : {}),
  });
}
