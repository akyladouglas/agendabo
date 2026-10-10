import { z } from 'zod';

/**
 * Contratos da Fase 9 — Observabilidade (spec observabilidade; ADR-0017).
 * `bot_events` e `llm_calls` sao tabelas de AUDITORIA: o que entra e validado
 * AQUI antes de gravar. Proibido por construcao: fala do usuario, titulo/nota
 * de compromisso, e-mail, telegramId cru (o hash e calculado no service).
 */

/** Espelha o enum Prisma `BotEventType`. */
export const BOT_EVENT_TYPES = [
  'flow_started',
  'flow_completed',
  'flow_aborted',
  'intent_classified',
  'llm_extraction',
  'conflict_dialog',
  'conflict_resolved',
  'needs_review',
  'cancelled',
  'edit_applied',
  'query_answered',
] as const;
export const botEventTypeSchema = z.enum(BOT_EVENT_TYPES);
export type BotEventTypeValue = z.infer<typeof botEventTypeSchema>;

/** Espelha o enum Prisma `BotEventOutcome`. */
export const BOT_EVENT_OUTCOMES = [
  'ok',
  'needs_review',
  'conflict',
  'error',
  'aborted',
  'parse_fail',
  'low_confidence',
] as const;
export const botEventOutcomeSchema = z.enum(BOT_EVENT_OUTCOMES);
export type BotEventOutcomeValue = z.infer<typeof botEventOutcomeSchema>;

/**
 * `stage`: etapa fina da maquina de fluxo (texto CONTROLADO PELO CODIGO, nunca
 * fala do usuario). Curto e sem caracter de controle.
 */
export const botEventStageSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9_.:-]+$/, 'stage deve ser um identificador (a-z0-9_.:-)');

/**
 * `metadata`: metadados estruturados por tipo de evento. `.strict()` em cada
 * variante (padrao R10: input de escrita rigido) — campo desconhecido e
 * provavel conteudo de conversa disfarçado, e o ADR-0017 nao deixa passar.
 */
const appointmentIdMeta = z.object({ appointmentId: z.string().uuid() }).strict();
const withCount = <T extends z.ZodRawShape>(extra: T) =>
  z.object({ ...extra, count: z.number().int().min(0).optional() }).strict();

/**
 * Intent do CLASSIFICADOR do bot que tem tipo proprio de evento. Mapear a
 * lista inteira obrigaria sincronizar dois enums a cada intent nova; o resto e
 * coberto por llm_extraction (outcome) + os eventos dos fluxos. O teste
 * `toda BOT_EVENT_INTENTS e aceita pelo zod` prende o contrato entre as duas.
 */
export const BOT_EVENT_INTENTS = ['consultar', 'criar', 'cancelar'] as const;
export type BotEventIntent = (typeof BOT_EVENT_INTENTS)[number];

export const botEventMetadataSchemas = {
  flow_started: z.object({}).strict(),
  flow_completed: appointmentIdMeta,
  flow_aborted: z
    .object({ reason: z.enum(['ttl', 'user_exit', 'new_flow', 'error']).optional() })
    .strict(),
  /**
   * `intent`: espelho dos valores de llm/classifyIntent que o registrador usa
   * (subconjunto — BOT_EVENT_INTENTS). Sync garantida pelo teste contracts.
   */
  intent_classified: z
    .object({
      intent: z.enum([
        'criar',
        'cancelar',
        'continuar_fluxo',
        'remarcar',
        'substituir_atual',
        'consultar',
        'editar_compromisso',
        'cancelar_compromisso',
        'fora_do_escopo',
      ]),
      confidence: z.number().min(0).max(1),
    })
    .strict(),
  llm_extraction: z
    .object({
      purpose: z.enum([
        'intent_classification',
        'scheduling_extraction',
        'reminder_extraction',
        'query_interpretation',
        'edit_interpretation',
        'escalation',
      ]),
      // outcome da EXTRAÇÃO (sub-conjunto do desfecho da chamada — o
      // escalated/error completo mora em llm_calls, tabela própria).
      outcome: z.enum(['ok', 'parse_fail', 'low_confidence']),
      confidence: z.number().min(0).max(1).optional(),
    })
    .strict(),
  conflict_dialog: appointmentIdMeta.extend({ conflictingIds: z.array(z.string().uuid()).max(20) }).strict(),
  conflict_resolved: withCount({ strategy: z.enum(['move_other', 'move_self']) }),
  needs_review: z
    .object({ reason: z.enum(['parse_fail', 'low_confidence', 'conflict_aborted']) })
    .strict(),
  cancelled: appointmentIdMeta.extend({ via: z.enum(['bot', 'web']).optional() }).strict(),
  edit_applied: appointmentIdMeta.extend({ fields: z.array(z.string().max(24)).max(10) }).strict(),
  query_answered: withCount({}),
} as const satisfies Record<BotEventTypeValue, z.ZodType>;

export function parseBotEventMetadata(type: BotEventTypeValue, metadata: unknown): unknown {
  return botEventMetadataSchemas[type].parse(metadata);
}

/** Linha de `bot_events` na leitura (GET /bot-events). Sem dado pessoal alem de userId. */
export const botEventDtoSchema = z.object({
  id: z.string().uuid(),
  type: botEventTypeSchema,
  stage: z.string().nullable(),
  outcome: botEventOutcomeSchema,
  metadata: z.unknown().nullable(),
  createdAt: z.coerce.date(),
  /** Presente apenas na visao do admin (a visao do rollout e so os proprios). */
  userId: z.string().uuid().optional(),
});
export type BotEventDto = z.infer<typeof botEventDtoSchema>;

/** GET /bot-events — filtros tecnicos; NUNCA identidade em query param (padrao do repo). */
export const botEventsQuerySchema = z
  .object({
    userId: z.string().uuid().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    type: botEventTypeSchema.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  // .strict (mesma politica da metadata): o browser manda o state inteiro do
  // form como query params (ex.: search="texto livre"); stripar em silencio
  // esconderia conteudo proibido chegando na rota de auditoria. 400 honesto.
  .strict();
export type BotEventsQuery = z.infer<typeof botEventsQuerySchema>;

export const botEventsResultSchema = z.object({
  items: z.array(botEventDtoSchema),
  total: z.number().int().min(0),
});
export type BotEventsResult = z.infer<typeof botEventsResultSchema>;

/** Espelha o enum Prisma `LlmCallPurpose` (6 valores: 5 services + escalada). */
export const LLM_CALL_PURPOSES = [
  'intent_classification',
  'scheduling_extraction',
  'reminder_extraction',
  'query_interpretation',
  'edit_interpretation',
  'escalation',
] as const;
export const llmCallPurposeSchema = z.enum(LLM_CALL_PURPOSES);
export type LlmCallPurposeValue = z.infer<typeof llmCallPurposeSchema>;

/** Espelha o enum Prisma `LlmCallOutcome`. */
export const LLM_CALL_OUTCOMES = ['ok', 'parse_fail', 'low_confidence', 'escalated', 'error'] as const;
export const llmCallOutcomeSchema = z.enum(LLM_CALL_OUTCOMES);
export type LlmCallOutcomeValue = z.infer<typeof llmCallOutcomeSchema>;

/** GET /llm-usage — agregacao admin-only (spec C4; custo nunca e do cliente). */
export const llmUsageQuerySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    groupBy: z.enum(['user', 'purpose']).default('purpose'),
  })
  .strict();
export type LlmUsageQuery = z.infer<typeof llmUsageQuerySchema>;

export const llmUsageBucketSchema = z.object({
  /** userId (groupBy=user) ou purpose (groupBy=purpose). */
  key: z.string(),
  calls: z.number().int().min(0),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  /** Estimativa declarada em micro-USD (ADR-0017); inteiro por contrato. */
  costUsdMicros: z.number().int().min(0),
  /** Chamadas sem tokens reportados (usage ausente) — custo parcial. */
  callsWithoutUsage: z.number().int().min(0),
});
export const llmUsageResultSchema = z.object({
  buckets: z.array(llmUsageBucketSchema),
});
export type LlmUsageResult = z.infer<typeof llmUsageResultSchema>;

/** PATCH /admin/users/:id/observabilidade — rollout on/off (spec B6). Nada mais. */
export const updateObservabilityRolloutInputSchema = z
  .object({ observabilidadeEventosAtivo: z.boolean() })
  .strict();
export type UpdateObservabilityRolloutInput = z.infer<
  typeof updateObservabilityRolloutInputSchema
>;

/**
 * GET /admin/users — lista mínima p/ a página Admin da web filtrar eventos por
 * usuário (a UI nunca manda uuid digitado na mão). Somente identificadores de
 * conta e flags; nenhum dado pessoal além de e-mail/nome.
 */
export const adminUserDtoSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  name: z.string().nullable(),
  isAdmin: z.boolean(),
  observabilidadeEventosAtivo: z.boolean(),
  createdAt: z.coerce.date(),
});
export type AdminUserDto = z.infer<typeof adminUserDtoSchema>;

export const adminUsersResultSchema = z.object({
  items: z.array(adminUserDtoSchema),
});
export type AdminUsersResult = z.infer<typeof adminUsersResultSchema>;
