import { z } from 'zod';
import { appointmentSchema } from '../entities/appointment';

/** GET /review — fila needs_review (3.3). */
export const reviewListResultSchema = z.object({
  items: z.array(
    appointmentSchema.extend({
      rawText: z.string(),
      reviewReason: z.string().nullable(),
    }),
  ),
});
export type ReviewListResult = z.infer<typeof reviewListResultSchema>;

/** POST /review/:id/confirm — usuario corrigiu data/hora/titulo e confirmou. */
export const reviewConfirmInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
  })
  .refine((v) => v.endsAt.getTime() > v.startsAt.getTime(), {
    message: 'endsAt deve ser depois de startsAt',
    path: ['endsAt'],
  });
export type ReviewConfirmInput = z.infer<typeof reviewConfirmInputSchema>;

/** POST /review/:id/dismiss — descarta o rascunho. */
export const reviewDismissResultSchema = z.object({ dismissed: z.literal(true) });
