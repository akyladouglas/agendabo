import { computed } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { sharedAgendaListSchema } from '@agendabo/contracts';
import { sharedAgendasApi } from '../../services/shared-agendas';
import { qk } from '../../config/queryKeys';
import { useAuthStore } from '../../store/authStore';

/**
 * GET /shared-agendas — vínculos que enviei + que recebi (spec D.21). A lista é
 * pequena (F.6: sem paginação). Consumidores: seletor de fonte da Agenda (só os
 * RECEBIDOS ATIVOS) e o card "Agendas compartilhadas" do perfil.
 *
 * O `queryFn` devolve um wrapper `{ data, raw }`: `data` é o payload VALIDADO
 * pelo contrato (strip — shape de sempre para todos os consumidores) e `raw` é a
 * resposta CRUA do MESMO fetch (zero requests extras). `rawData` existe por causa
 * do bug da fonte (spec B.12): o seletor da Agenda precisa do `ownerId` (uuid do
 * DONO) por vínculo — campo que o contrato não lista e que o parse de strip
 * destruiria se a cópia parseada fosse a única. Quando o `GET /shared-agendas`
 * passar a mandar `ownerId` nos recebidos, nada aqui muda: só a página lê.
 */
export function useSharedAgendasQuery() {
  const auth = useAuthStore();
  const query = useQuery({
    queryKey: qk.sharedAgendas,
    // M2 (review): o card do perfil e o seletor da Agenda são montados sem gate
    // — deslogado a query disparava 401 + refresh-churn. Só consulta logado.
    enabled: computed(() => auth.isLoggedIn),
    // Sessão expirada: retry só martela o refresh — não repetir (0 tentativas).
    retry: 0,
    queryFn: async () => {
      const raw = await sharedAgendasApi.list();
      return { data: sharedAgendaListSchema.parse(raw), raw: raw as unknown };
    },
  });
  return {
    ...query,
    data: computed(() => query.data.value?.data),
    /** Payload cru da mesma resposta (fonte: `ownerId` do dono na Agenda). */
    rawData: computed(() => query.data.value?.raw),
  };
}
