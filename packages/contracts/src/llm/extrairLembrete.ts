import { z } from 'zod';
import { notificationRuleInputSchema } from '../entities/notification-rule';

/**
 * Saida da interpretacao do ESQUEMA DE LEMBRETE falado no fluxo de criar (Fase 3,
 * spec lembretes-e-resumo-diario regra 3): "3 dias antes e 1h antes", "3-2-1",
 * "sem lembrete". O LLM so traduz a fala em regras; QUEM decide os instantes de
 * disparo e `computeTriggers` (schedule-core), deterministicamente (ADR-004).
 *
 * IMPORTANTE: nao usar .strict() aqui (gotcha 4) — o zod em modo strip descarta
 * silenciosamente campos extras que o modelo as vezes manda.
 */
export const extrairLembreteSchema = z.object({
  /**
   * Multi-regra (decisao do humano #1): a fala pode produzir N regras independentes.
   * `none` so e valido sozinho — a validacao vive no `notificationRuleInputSchema`
   * + `superRefine` abaixo (mesma borda das regras persistidas).
   */
  regras: z.array(notificationRuleInputSchema).min(1).max(10).superRefine((rules, ctx) => {
    if (rules.some((r) => r.type === 'none') && rules.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'none so pode vir sozinho no array de regras',
      });
    }
  }),
  /** Confianca 0..1 dada pelo proprio modelo (sempre obrigatoria — ADR-003). */
  confidence: z.number().min(0).max(1),
});
export type ExtrairLembreteOutput = z.infer<typeof extrairLembreteSchema>;

/**
 * Tool definition para function calling (escrita a mao, espelhando o zod acima;
 * padrao financas: sem minimum/maximum no JSON Schema).
 *
 * FLAT (`rules` no topo) porque os itens da tool Anthropic precisam ser um objeto
 * JSON Schema; o zod mantem a forma de negocio (`regras`). O payload plano e
 * canonizado por `normalizeLembreteToolUseInput` ANTES do safeParse. Sem
 * `additionalProperties: false` — strict do Anthropic quebraria com campos
 * opcionais dos itens (gotcha 4).
 */
export const extrairLembreteTool = {
  name: 'extrair_esquema_lembrete',
  description:
    'Extrai o esquema de lembrete que o usuario descreveu para um compromisso: quantos ' +
    'horas/dias antes do inicio ele quer ser avisado. Combinacoes livres viram varias ' +
    'regras no array ("3 dias antes e 1h antes" => duas regras). Contagem "3-2-1" e UMA ' +
    'regra countdown_3_2_1 (a expansao 3/2/1 dias e feita por regra deterministica, nao ' +
    'por voce). Sem lembrete => UMA regra none. Sempre inclua confidence (0 a 1); na ' +
    'duvida, valor baixo em vez de chutar.',
  input_schema: {
    type: 'object' as const,
    properties: {
      regras: {
        type: 'array',
        description:
          'Regras de lembrete extraidas da fala (1..10). none sozinho quando o usuario ' +
          'nao quer lembrete.',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['none', 'before_hours', 'before_days', 'countdown_3_2_1'],
              description:
                'before_hours = N horas antes; before_days = N dias antes; ' +
                'countdown_3_2_1 = contagem 3-2-1 (3, 2 e 1 dias antes); none = sem lembrete',
            },
            value: {
              type: 'number',
              description:
                'Inteiro positivo: horas (before_hours) ou dias (before_days). ' +
                'Omita para none e countdown_3_2_1.',
            },
          },
          required: ['type'],
        },
      },
      confidence: { type: 'number', description: 'Confianca da interpretacao, 0 a 1' },
    },
    required: ['regras', 'confidence'],
  },
  /** Sem `additionalProperties: false` — ver nota no schema. */
};

/**
 * Canoniza a saida da tool p/ o formato do zod: aceita o payload com `regras`
 * (o contrato) e tolera `rules`/`rules_regras` que o modelo as vezes escreve por
 * conta propria. Campos extras passam (strip no zod).
 */
export function normalizeLembreteToolUseInput(input: unknown): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return input;
  const raw = input as Record<string, unknown>;
  if (Array.isArray(raw.regras)) return raw;
  if (Array.isArray(raw.rules)) {
    const { rules, ...rest } = raw;
    return { ...rest, regras: rules };
  }
  return raw;
}

