import { z } from 'zod';
import { hourOfDaySchema, optionalText, timezoneSchema } from '../primitives';

/**
 * PATCH /me — edição do perfil pelo dono da conta (Fase 5, spec web regra 8).
 * Tudo opcional (patch); `name` colapsa '' -> undefined (limpar o nome).
 * E-mail/senha NÃO são editáveis por aqui (decisão 6 da spec).
 */
export const updateProfileInputSchema = z
  .object({
    /** Nome como o bot deve chamar o usuário (decisão 7). */
    name: optionalText(80),
    timezone: timezoneSchema.optional(),
    resumoDiarioHora: hourOfDaySchema.optional(),
    /** Ligar/desligar o resumo diário (Aberto #2 → (a) — flag no User). */
    resumoDiarioAtivo: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'envie ao menos um campo para atualizar',
  });
export type UpdateProfileInput = z.infer<typeof updateProfileInputSchema>;

/** Resposta do PATCH /me: shape de usuário da sessão (authStore atualiza direto). */
export const updateProfileResultSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  name: z.string().nullable(),
  timezone: timezoneSchema,
  resumoDiarioHora: hourOfDaySchema,
  resumoDiarioAtivo: z.boolean(),
});
export type UpdateProfileResult = z.infer<typeof updateProfileResultSchema>;
