import { z } from 'zod';
import { hourOfDaySchema, isoDateSchema, telegramIdSchema, timezoneSchema } from '../primitives';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('email invalido')
  .max(254);

export const passwordSchema = z
  .string()
  .min(8, 'senha deve ter pelo menos 8 caracteres')
  .max(128);

/** Visao publica do usuario (nunca expor senhaHash / codigos). */
export const userSchema = z.object({
  id: z.string().uuid(),
  email: emailSchema,
  telegramId: telegramIdSchema.nullable(),
  emailConfirmedAt: isoDateSchema.nullable(),
  timezone: timezoneSchema,
  resumoDiarioHora: hourOfDaySchema,
  /** Nome como o bot chama o usuario (decisao 7 da spec web; null = sem nome). */
  name: z.string().nullable(),
  /** Resumo diario ligado/desligado (Aberto #2 -> (a)). */
  resumoDiarioAtivo: z.boolean(),
  /** Admin da plataforma (Fase 9 / ADR-0017; primeiro usuario do sistema). */
  isAdmin: z.boolean(),
  /** Rollout: ve os proprios eventos do bot so com flag ligada pelo admin. */
  observabilidadeEventosAtivo: z.boolean(),
});

export type UserDto = z.infer<typeof userSchema>;
export type Email = z.infer<typeof emailSchema>;
export type Password = z.infer<typeof passwordSchema>;
