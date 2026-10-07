import { z } from 'zod';

const REQUIRED = 'obrigatoria - veja .env.example';

/**
 * Contrato de env - espelha .env.example da raiz (apps/api/src/config/env.validation.ts).
 * Validado no boot; o processo morre cedo se faltar variavel.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  WEB_ORIGIN: z.string().url().default('http://localhost:5174'),

  DATABASE_URL: z.string().min(1, REQUIRED),
  REDIS_URL: z.string().min(1, REQUIRED),

  /** Fase 3: tentativas de envio do worker antes de `failed` (spec regras 12/14). */
  NOTIFY_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  /** Fase 3: atraso máximo tolerado no disparo; acima disso a linha vai a `failed`. */
  NOTIFY_STALE_MINUTES: z.coerce.number().int().positive().default(30),

  JWT_SECRET: z.string().min(16, REQUIRED),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),

  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM: z.string().min(1).optional(),

  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  LLM_MODEL_PRIMARY: z.string().default('claude-haiku-4-5-20251001'),
  LLM_MODEL_ESCALATION: z.string().default('claude-sonnet-5-5'),
  /** ADR-003: abaixo disso a extracao vira needs_review, nunca chute silencioso. */
  MIN_CONFIDENCE_TO_ACCEPT: z.coerce.number().min(0).max(1).default(0.7),
  /** Spec Fase 1: inatividade que descarta a sessao de conversa do bot (memoria). */
  BOT_SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(30),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Variaveis de ambiente invalidas:\n${issues}`);
  }
  return parsed.data;
}
