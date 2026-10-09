import { z } from "zod";
import { emailSchema, passwordSchema } from "../entities/user";
import {
  hourOfDaySchema,
  optionalText,
  telegramIdSchema,
  timezoneSchema,
} from "../primitives";

/** POST /auth/signup — cadastro (3.1). Um codigo de verificacao e enviado por email (3.1.1). */
export const signupInputSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  telegramId: telegramIdSchema,
  timezone: timezoneSchema.default("America/Sao_Paulo"),
  /** Nome como o bot deve chamar o usuário (decisão 7 da spec web — opcional→recomendado). */
  name: optionalText(80),
});
export type SignupInput = z.infer<typeof signupInputSchema>;

/** Resposta do signup: informa que a confirmacao por codigo comecou. */
export const signupResultSchema = z.object({
  email: emailSchema,
  codeExpiresInSeconds: z.number().int().positive(),
  /** false = conta criada mas o email NÃO foi entregue (ex.: Resend fora do ar):
   *  a UI orienta a usar "Reenviar código" (o código já está criado e vale 15min). */
  mailDelivered: z.boolean(),
  /** true = o email já tinha conta pendente de confirmação (voltou do /confirmar):
   *  em vez de conflito, geramos um código novo e seguimos para a confirmação. */
  pendingResumed: z.boolean().optional(),
});
export type SignupResult = z.infer<typeof signupResultSchema>;

/** POST /auth/verify-code — valida o codigo de 6 digitos. */
export const verifyCodeInputSchema = z.object({
  email: emailSchema,
  code: z.string().regex(/^\d{6}$/, "codigo deve ter 6 digitos"),
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

/**
 * POST /auth/forgot-password — "Esqueci a senha" (spec esqueci-a-senha).
 * Entrada e apenas o email; a resposta e SEMPRE 202 uniforme (anti-enumeration),
 * entao nao ha schema de sucesso.
 */
export const forgotPasswordInputSchema = z.object({
  email: emailSchema,
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordInputSchema>;

/**
 * POST /auth/reset-password — concluir o reset via magic link.
 * `token` e o token opaco do link (32 bytes hex, 64 chars); `password` e o
 * `passwordSchema` vigente (min. 8). A confirmacao "repita a senha" e validacao
 * do form, nao da API. Falha de posse = 410 generico `reset_token_invalid`
 * (corpo com `code`; nao ha schema de sucesso — 204 vazio).
 */
export const resetPasswordInputSchema = z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/, "token de redefinicao invalido"),
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordInputSchema>;

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
    /** null para contas criadas antes da Fase 5 (decisão 7). */
    name: z.string().nullable(),
    timezone: timezoneSchema,
    resumoDiarioHora: hourOfDaySchema,
    /** Flag do resumo diário (Aberto #2 → (a)). */
    resumoDiarioAtivo: z.boolean(),
    /** Fase 9 (observabilidade/ADR-0017): só controle de visibilidade de rota
     *  na web; a guarda de verdade das rotas admin é sempre o server. */
    isAdmin: z.boolean(),
  }),
});
export type LoginResult = z.infer<typeof loginResultSchema>;
