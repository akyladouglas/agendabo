import { z } from 'zod';
import { emailSchema, passwordSchema } from '../entities/user';
import { hourOfDaySchema, telegramIdSchema, timezoneSchema } from '../primitives';

/** POST /auth/signup — cadastro (3.1). Um codigo de verificacao e enviado por email (3.1.1). */
export const signupInputSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  telegramId: telegramIdSchema,
  timezone: timezoneSchema.default('America/Sao_Paulo'),
});
export type SignupInput = z.infer<typeof signupInputSchema>;

/** Resposta do signup: informa que a confirmacao por codigo comecou. */
export const signupResultSchema = z.object({
  email: emailSchema,
  codeExpiresInSeconds: z.number().int().positive(),
});
export type SignupResult = z.infer<typeof signupResultSchema>;

/** POST /auth/verify-code — valida o codigo de 6 digitos. */
export const verifyCodeInputSchema = z.object({
  email: emailSchema,
  code: z
    .string()
    .regex(/^\d{6}$/, 'codigo deve ter 6 digitos'),
});
export type VerifyCodeInput = z.infer<typeof verifyCodeInputSchema>;

/** POST /auth/resend-code — limite de 3 reenvios por 30 min, persistido no banco (ADR-002). */
export const resendCodeInputSchema = z.object({
  email: emailSchema,
});
export type ResendCodeInput = z.infer<typeof resendCodeInputSchema>;

/** Resposta de resend/verify com quota: quantos reenvios faltam / quando liberar. */
export const resendQuotaSchema = z.object({
  reenviosRestantes: z.number().int().min(0).max(3),
  reenviosDisponiveisEmSegundos: z.number().int().min(0).nullable(),
});
export type ResendQuota = z.infer<typeof resendQuotaSchema>;

/** POST /auth/login — JWT dual: access em memoria + refresh cookie httpOnly (padrao financas). */
export const loginInputSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export const loginResultSchema = z.object({
  accessToken: z.string(),
  user: z.object({
    id: z.string().uuid(),
    email: emailSchema,
    timezone: timezoneSchema,
    resumoDiarioHora: hourOfDaySchema,
  }),
});
export type LoginResult = z.infer<typeof loginResultSchema>;
