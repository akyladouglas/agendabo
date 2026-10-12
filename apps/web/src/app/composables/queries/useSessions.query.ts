import { useQuery } from '@tanstack/vue-query';
import { authSessionsListResultSchema } from '@agendabo/contracts';
import { sessionsApi } from '../../services/sessions';
import { qk } from '../../config/queryKeys';

/** GET /auth/sessions — dispositivos com refresh token vivo (a atual é `current`). */
export function useSessionsQuery() {
  return useQuery({
    queryKey: qk.sessions,
    queryFn: async () => authSessionsListResultSchema.parse(await sessionsApi.list()),
  });
}
