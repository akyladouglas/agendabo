import { computed, isRef, unref, type Ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import {
  appointmentListResultSchema,
  sharedAppointmentListResultSchema,
} from '@agendabo/contracts';
import { appointmentsApi } from '../../services/appointments';
import { qk } from '../../config/queryKeys';

/**
 * GET /appointments no período UTC [from, to) — o período vem do schedule-core.
 *
 * Compartilhamento (spec C.17/B.12, decisão D9): a fonte é a TERCEIRA dimensão da
 * query. `owner` nulo/ausente = agenda PRÓPRIA (parse `appointmentListResultSchema`
 * como sempre); `owner` = agenda EMPRESTADA — o payload é o subconjunto emprestado
 * (`sharedAppointmentListResultSchema`: sem `rawText`/`reviewReason`/
 * `notificationRules`, só `confirmed`) e o zod faz ausencia ESTRUTURAL: campo de
 * revisão do dono não sobrevive ao parse nem que a API erre. A chave `qk.appointments
 * (from, to, owner)` nunca mistura as fontes no cache.
 */

/** Resultado da listagem SEM dono (agenda própria) — shape de sempre. */
export type OwnAppointmentsResult = typeof appointmentListResultSchema._output;
/** Resultado da listagem COM dono (emprestada) — subconjunto sem campos de revisão. */
export type SharedAppointmentsResult = typeof sharedAppointmentListResultSchema._output;

/** true quando `owner` (ref ou valor) aponta para uma agenda emprestada.
 *  (utilitário exportado p/ testes futuros da borda; o queryFn usa `ownerRef`
 *  direto — mantido como documentação viva da discriminante) */
export function hasOwner(owner?: Ref<string | null> | string | null): boolean {
  return Boolean(unref(owner));
}

export function useAppointmentsQuery(
  from: Ref<string>,
  to: Ref<string>,
  owner?: Ref<string | null> | string | null,
) {
  const ownerRef = isRef(owner) ? owner : computed(() => owner ?? null);
  return useQuery({
    queryKey: computed(() => qk.appointments(from.value, to.value, ownerRef.value)),
    queryFn: async () => {
      const o = ownerRef.value;
      if (o) {
        // emprestada: parse discriminado — itens têm SUBCONJUNTO de campos
        return sharedAppointmentListResultSchema.parse(await appointmentsApi.list(from.value, to.value, o));
      }
      return appointmentListResultSchema.parse(await appointmentsApi.list(from.value, to.value));
    },
  });
}
