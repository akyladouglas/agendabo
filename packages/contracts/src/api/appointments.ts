import { z } from 'zod';
import {
  appointmentCreateFieldsSchema,
  appointmentPatchSchema,
  appointmentInputSchema,
  appointmentSchema,
} from '../entities/appointment';
import { isoDateSchema } from '../primitives';

/** GET /appointments?from=&to= — listagem para o calendario (timezone resolvido na API). */
export const listAppointmentsQuerySchema = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
  })
  .refine((v) => v.to.getTime() >= v.from.getTime(), {
    message: 'to deve ser depois de from',
    path: ['to'],
  });
export type ListAppointmentsQuery = z.infer<typeof listAppointmentsQuerySchema>;

export const appointmentListResultSchema = z.object({
  items: z.array(appointmentSchema),
});
export type AppointmentListResult = z.infer<typeof appointmentListResultSchema>;

/** POST /appointments — cria pela web (origem `web`). */
export const createAppointmentInputSchema = appointmentInputSchema;
export type CreateAppointmentInput = z.infer<typeof createAppointmentInputSchema>;

/** PATCH /appointments/:id — edicao parcial. */
export const updateAppointmentInputSchema = appointmentPatchSchema;
export type UpdateAppointmentInput = z.infer<typeof updateAppointmentInputSchema>;

/** POST /appointments/check-conflict — pre-visualizacao de conflito no form web. */
export const checkConflictInputSchema = z
  .object({
    startsAt: isoDateSchema,
    endsAt: isoDateSchema,
    /** Ignora este compromisso (edicao). */
    ignoreId: z.string().uuid().optional(),
  })
  .refine((v) => v.endsAt.getTime() > v.startsAt.getTime(), {
    message: 'endsAt deve ser depois de startsAt',
    path: ['endsAt'],
  });
export type CheckConflictInput = z.infer<typeof checkConflictInputSchema>;

export const checkConflictResultSchema = z.object({
  conflict: z.boolean(),
  /** Compromisso que choca (titulo + horario ja respondidos ao usuario, 1.1). */
  with: appointmentSchema.nullable(),
});
export type CheckConflictResult = z.infer<typeof checkConflictResultSchema>;

/**
 * Reagendamento Assistido (Fase 8, Etapa 0 — spec
 * `.ia/specs/agenda/reagendamento-assistido.spec.md`, ADR-0015): sobreposicao e
 * invariante do produto; conflito vira jogada de UM lance (mover o outro OU o
 * movido) ou nao salva. `force` nao entra em input nenhum.
 */

/** POST /appointments/relocation-options — mesma semantica de candidato do check-conflict. */
export const relocationOptionsInputSchema = z
  .object({
    startsAt: isoDateSchema,
    endsAt: isoDateSchema,
    /** Compromisso em edicao (o que esta sendo movido); ausente = criacao. */
    movedId: z.string().uuid().optional(),
  })
  // R10 (review 2026-10-09): .strict() na borda — chave desconhecida NUNCA passa
  // despercebida (o default do zod e strip; um `force` retrabalhado aqui seria
  // silenciosamente engolido — ADR-0015 nao aceita retrocesso suave).
  .strict()
  .refine((v) => v.endsAt.getTime() > v.startsAt.getTime(), {
    message: 'endsAt deve ser depois de startsAt',
    path: ['endsAt'],
  });
export type RelocationOptionsInput = z.infer<typeof relocationOptionsInputSchema>;

/** Opcao serializada (outro como appointment completo + para onde ele ira). */
export const relocationOptionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('move-other'),
    other: appointmentSchema,
    newStart: isoDateSchema,
    newEnd: isoDateSchema,
  }),
  z.object({
    kind: z.literal('move-self'),
    newStart: isoDateSchema,
    newEnd: isoDateSchema,
  }),
]);
export type RelocationOptionDto = z.infer<typeof relocationOptionSchema>;

export const relocationOptionsResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ok') }),
  z.object({ kind: z.literal('options'), options: z.array(relocationOptionSchema) }),
]);
export type RelocationOptionsResult = z.infer<typeof relocationOptionsResultSchema>;

/**
 * POST /appointments/reschedule — duas variantes (D-W5): `move` move um
 * compromisso existente para o candidato, `create` cria um novo já resolvendo o
 * conflito. `otherId` presente = o existente indicado é deslocado para o slot
 * da jogada move-other no MESMO request (tx única — zero janela de
 * sobreposição). O server RECOMPUTA a jogada (D4): nunca grava horário
 * sugerido por client obsoleto.
 */
export const rescheduleMoveInputSchema = z
  .object({
    mode: z.literal('move'),
    movedId: z.string().uuid(),
    otherId: z.string().uuid().optional(),
    newStart: isoDateSchema,
    newEnd: isoDateSchema,
    /**
     * O slot que a UI MOSTROU para o `otherId` quando o usuário clicou. O
     * server recomputa a jogada (D4) e recusa se o horário da jogada MUDOU
     * (client obsoleto): a recusa protege o clique do usuário.
     */
    otherStart: isoDateSchema.optional(),
    otherEnd: isoDateSchema.optional(),
  })
  // R10 (review 2026-10-09): ver relocationOptionsInputSchema — borda strict.
  .strict()
  .refine((v) => v.newEnd.getTime() > v.newStart.getTime(), {
    message: 'newEnd deve ser depois de newStart',
    path: ['newEnd'],
  })
  .refine((v) => !v.otherId || v.otherId !== v.movedId, {
    message: 'otherId deve ser diferente de movedId',
    path: ['otherId'],
  })
  .refine((v) => !v.otherStart || !v.otherEnd || v.otherEnd.getTime() > v.otherStart.getTime(), {
    message: 'otherEnd deve ser depois de otherStart',
    path: ['otherEnd'],
  });
export type RescheduleMoveInput = z.infer<typeof rescheduleMoveInputSchema>;

export const rescheduleCreateInputSchema = z
  .object({
    mode: z.literal('create'),
    /** Payload de criação completo (campos de `appointmentInputSchema`). */
    create: appointmentCreateFieldsSchema,
    otherId: z.string().uuid().optional(),
  })
  // R10 (review 2026-10-09): borda strict — ver relocationOptionsInputSchema.
  .strict()
  .refine((v) => v.create.endsAt.getTime() > v.create.startsAt.getTime(), {
    message: 'endsAt deve ser depois de startsAt',
    path: ['create', 'endsAt'],
  });
export type RescheduleCreateInput = z.infer<typeof rescheduleCreateInputSchema>;

/** Parse na superfície (controller): qual variante veio decide o resto. */
export const rescheduleAppointmentInputSchema = z.union([
  rescheduleMoveInputSchema,
  rescheduleCreateInputSchema,
]);
export type RescheduleAppointmentInput = z.infer<typeof rescheduleAppointmentInputSchema>;

export const rescheduleResultSchema = z.object({
  moved: appointmentSchema,
  other: appointmentSchema.nullable(),
  /** Tipos de regra com gatilho no passado descartados (ADR-011). */
  droppedRules: z.array(z.string()),
});
export type RescheduleResult = z.infer<typeof rescheduleResultSchema>;
