import { z } from 'zod';
import { isoDateSchema, optionalText } from '../primitives';
import { notificationRuleInputSchema, notificationRuleSchema } from './notification-rule';

/** `confirmed` = criado com confianca; `needs_review` = LLM nao entendeu, espera correcao no web (3.3). */
export const appointmentStatusSchema = z.enum(['confirmed', 'needs_review']);
export type AppointmentStatus = z.infer<typeof appointmentStatusSchema>;

/** Por onde o compromisso entrou. */
export const appointmentOriginSchema = z.enum(['bot', 'web']);
export type AppointmentOrigin = z.infer<typeof appointmentOriginSchema>;

export const appointmentSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200),
  startsAt: isoDateSchema,
  endsAt: isoDateSchema,
  notes: z.string().max(2000).nullable(),
  status: appointmentStatusSchema,
  origin: appointmentOriginSchema,
  /** Regras persistidas (o GET devolve p/ a web editar os chips; ausente = n/d). */
  notificationRules: z.array(notificationRuleSchema).optional(),
  createdAt: isoDateSchema,
});
export type AppointmentDto = z.infer<typeof appointmentSchema>;

/** Compromisso em revisao: carrega o texto original dito pelo usuario no bot. */
export const reviewAppointmentSchema = appointmentSchema.extend({
  rawText: z.string().max(2000),
  reviewReason: z.string().max(500).nullable(),
});
export type ReviewAppointmentDto = z.infer<typeof reviewAppointmentSchema>;

/**
 * Invariante de intervalo: endsAt estritamente depois de startsAt.
 * Conflito e half-open [start, end) — regra deterministica em schedule-core (ADR-003).
 */
export const appointmentIntervalSchema = z
  .object({
    startsAt: isoDateSchema,
    endsAt: isoDateSchema,
  })
  .refine((v) => v.endsAt.getTime() > v.startsAt.getTime(), {
    message: 'endsAt deve ser depois de startsAt',
    path: ['endsAt'],
  });

/** Campos de criacao/edicao (sem refine); a forma refinada vive em `appointmentInputSchema`. */
const appointmentFields = z.object({
  title: z.string().trim().min(1, 'titulo e obrigatorio').max(200),
  startsAt: isoDateSchema,
  endsAt: isoDateSchema,
  notes: optionalText(2000),
  /** Regras de lembrete do compromisso; [] = sem lembrete. */
  notificationRules: z.array(notificationRuleInputSchema).max(10).default([]),
});

/** Payload para criar compromisso pela web ou confirmar um needs_review. */
export const appointmentInputSchema = appointmentFields.refine(
  (v) => v.endsAt.getTime() > v.startsAt.getTime(),
  { message: 'endsAt deve ser depois de startsAt', path: ['endsAt'] },
);
export type AppointmentInput = z.infer<typeof appointmentInputSchema>;

/** Edicao parcial: parte dos campos crus + refine opcional de intervalo. */
export const appointmentPatchSchema = appointmentFields
  .partial()
  .refine(
    (v) => !v.startsAt || !v.endsAt || v.endsAt.getTime() > v.startsAt.getTime(),
    { message: 'endsAt deve ser depois de startsAt', path: ['endsAt'] },
  );
export type AppointmentPatch = z.infer<typeof appointmentPatchSchema>;
