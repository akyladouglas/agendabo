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
  /**
   * Gotcha 5 em producao: api e bot sao servicos separados no Coolify com o MESMO
   * token. O polling so pode viver num processo — a API HTTP desliga o gateway com
   * BOT_GATEWAY_ENABLED=false; o servico bot roda sem a flag (default true).
   */
  BOT_GATEWAY_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v !== 'false'),

  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM: z.string().min(1).optional(),

  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  LLM_MODEL_PRIMARY: z.string().default('claude-haiku-4-5-20251001'),
  LLM_MODEL_ESCALATION: z.string().default('claude-sonnet-5-5'),
  /** ADR-003: abaixo disso a extracao vira needs_review, nunca chute silencioso. */
  MIN_CONFIDENCE_TO_ACCEPT: z.coerce.number().min(0).max(1).default(0.7),
  /** Spec Fase 1: inatividade que descarta a sessao de conversa do bot (memoria). */
  BOT_SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(30),

  /**
   * Fase 9 — Observabilidade (spec observabilidade; ADR-0016/0017).
   * Tracker: SDK Sentry apontando para o GlitchTip SaaS (ou qualquer destino
   * do protocolo). DSN ausente => processo liga sem tracker (testes/dev sem
   * rede) — mesma flexibilidade de TELEGRAM_BOT_TOKEN/ANTHROPIC_API_KEY.
   */
  SENTRY_DSN: z.string().min(1).optional(),
  /** Tracing OFF ate producao (decisao humana #7); ligar = mudar 1 env. */
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),
  SENTRY_ENVIRONMENT: z.string().min(1).default('development'),
  /** Identificador de release carimbado nas events (deploy; local = dev). */
  SENTRY_RELEASE: z.string().min(1).optional(),

  /**
   * Salt do HMAC do telegramIdHash em bot_events (D-P3 do plano): NAO reusar
   * JWT_SECRET — um segredo, um proposito. Obrigatorio: evento sem salt fraco
   * e correlacionavel por dicionario.
   */
  EVENTS_HASH_SECRET: z.string().min(16, REQUIRED),

  /**
   * Preco da estimativa de custo do LLM em MICRO-USD por milhao de tokens
   * (D-P8; ADR-0017). Obrigatorios de proposito: o sistema se recusa a estimar
   * custo sem preco declarado (nada de numero chutado no codigo). A unidade e
   * micro-USD de seta (1 USD = 1e6 micro): a Anthropic cobra centavos por mil
   * tokens, e o Int do zod nao deixa fracao — $1/Mtok vira 1_000_000.
   * Estimativa declarada — nao e billing da Anthropic (ADR-0017).
   */
  LLM_PRICE_INPUT_USD_PER_MTOK: z.coerce.number().int().positive(),
  LLM_PRICE_OUTPUT_USD_PER_MTOK: z.coerce.number().int().positive(),
});

export type Env = z.infer<typeof envSchema>;

/** Env validado a partir do process.env (o mesmo contrato do ConfigModule). */
export function readValidatedEnv(): Env {
  return validateEnv(process.env);
}

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
