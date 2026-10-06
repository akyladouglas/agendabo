import { z } from 'zod';
import { appointmentPatchSchema, appointmentInputSchema, appointmentSchema } from '../entities/appointment';
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
