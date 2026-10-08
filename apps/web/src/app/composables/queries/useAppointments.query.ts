import { computed, type Ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { appointmentListResultSchema } from '@agendabo/contracts';
import { appointmentsApi } from '../../services/appointments';
import { qk } from '../../config/queryKeys';

/** GET /appointments no período UTC [from, to) — o período vem do schedule-core. */
export function useAppointmentsQuery(from: Ref<string>, to: Ref<string>) {
  return useQuery({
    queryKey: computed(() => qk.appointments(from.value, to.value)),
    queryFn: async () =>
      appointmentListResultSchema.parse(await appointmentsApi.list(from.value, to.value)),
  });
}
