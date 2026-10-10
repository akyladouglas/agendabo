import { useQuery } from '@tanstack/vue-query';
import { adminUsersResultSchema, botEventsResultSchema, llmUsageResultSchema } from '@agendabo/contracts';
import { observabilityApi } from '../../services/observability';
import { qk } from '../../config/queryKeys';

/**
 * GET /observabilidade/me — SEM `retry`: é a consulta de permissão da rota.
 * 401/403/404 (não-admin sem rollout) responde na hora; a página mostra o
 * estado "acesso restrito" em vez de gastar retries.
 */
export function useObsMeQuery() {
  return useQuery({
    queryKey: qk.obsMe,
    queryFn: async () => observabilityApi.me(),
    retry: false,
    staleTime: 5 * 60_000,
  });
}

/**
 * GET /bot-events — filtros vêm do estado da página (nunca uuid digitado na
 * mão). `enabled` espera o papel resolver (`/observabilidade/me`): sem acesso
 * negado/permitido, a query NEM DISPARA (nada de chave especulativa no ar).
 */
export function useBotEventsQuery(
  params: () => Record<string, string | number | undefined>,
  enabled: () => boolean,
) {
  return useQuery({
    queryKey: () => qk.botEvents(params()),
    queryFn: async () => botEventsResultSchema.parse(await observabilityApi.listEvents(params())),
    // REATIVO: o papel (/me) resolve depois da montagem — o enabled precisa
    // acompanhar (passar o booleano do setup congela o valor de montagem).
    enabled,
  });
}

/** GET /llm-usage — agregação admin-only (custo nunca é do cliente). */
export function useLlmUsageQuery(
  params: () => Record<string, string | undefined>,
  enabled: () => boolean,
) {
  return useQuery({
    queryKey: () => qk.llmUsage(params()),
    queryFn: async () => llmUsageResultSchema.parse(await observabilityApi.llmUsage(params())),
    enabled,
  });
}

/** GET /admin/users — lista mínima p/ o filtro de eventos e o toggle de rollout. */
export function useAdminUsersQuery(enabled: () => boolean) {
  return useQuery({
    queryKey: qk.adminUsers,
    queryFn: async () => adminUsersResultSchema.parse(await observabilityApi.listUsers()),
    enabled,
  });
}
