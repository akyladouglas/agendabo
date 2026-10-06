import { z } from 'zod';

/**
 * Regras de lembrete parametrizaveis (1.2). O calculo dos instantes de disparo
 * e deterministico e mora em `schedule-core` (computeTriggers); aqui so o formato.
 *
 * - `none`: sem lembrete (unico item valido quando presente).
 * - `before_hours`: N horas antes (ex.: 24 => "24h antes"; 1 => "1h antes").
 * - `before_days`: N dias antes (1, 2, 3...).
 * - `countdown_3_2_1`: dispara 3, 2 e 1 dias antes (sem `value`).
 */
export const notificationRuleTypeSchema = z.enum([
  'none',
  'before_hours',
  'before_days',
  'countdown_3_2_1',
]);
export type NotificationRuleType = z.infer<typeof notificationRuleTypeSchema>;

export const notificationRuleInputSchema = z
  .object({
    type: notificationRuleTypeSchema,
    /** Obrigatorio para before_hours/before_days; ignorado nos demais. */
    value: z.number().int().positive().max(365).optional(),
  })
  .superRefine((rule, ctx) => {
    const needsValue = rule.type === 'before_hours' || rule.type === 'before_days';
    if (needsValue && rule.value === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `type=${rule.type} exige value (horas/dias antes)`,
        path: ['value'],
      });
    }
  });
export type NotificationRuleInput = z.infer<typeof notificationRuleInputSchema>;

export const notificationRuleSchema = z.object({
  id: z.string().uuid(),
  type: notificationRuleTypeSchema,
  value: z.number().int().nullable(),
});
export type NotificationRuleDto = z.infer<typeof notificationRuleSchema>;

export const notificationOutboxStatusSchema = z.enum(['pending', 'sent', 'failed']);
export type NotificationOutboxStatus = z.infer<typeof notificationOutboxStatusSchema>;
