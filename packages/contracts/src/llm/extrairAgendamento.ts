import { z } from 'zod';

/**
 * Saida da extracao de agendamento em linguagem natural (fase 3).
 * A API converte este objeto em tool JSON Schema (strict) e valida a resposta
 * do modelo com `safeParse` ANTES de qualquer uso. Parse falho OU
 * `confidence < MIN_CONFIDENCE_TO_ACCEPT` => compromisso nasce `needs_review`
 * (ADR-003: o LLM interpreta, nunca decide).
 *
 * IMPORTANTE: nao usar .strict() aqui (gotcha 4) — modelos as vezes mandam
 * campos extras e o zod em modo strip descarta silenciosamente.
 */
export const extrairAgendamentoSchema = z.object({
  /** Titulo curto do compromisso (ex.: "consulta oftalmologista"). */
  title: z.string().min(1).max(200),
  /** Inicio em ISO-8601 com offset explicito, ja no timezone do usuario. */
  startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/, 'datetime ISO-8601 com offset'),
  /** Duracao estimada em minutos; default da API = 60. */
  durationMinutes: z.number().int().min(5).max(1440).optional(),
  /** Confianca 0..1 da extracao dada pelo proprio modelo. */
  confidence: z.number().min(0).max(1),
  /** Trecho da fala que fundamentou a data (auditoria/debug da fila de revisao). */
  dateEvidence: z.string().max(300).optional(),
});
export type ExtrairAgendamentoOutput = z.infer<typeof extrairAgendamentoSchema>;

/**
 * Tool definition para function calling (escrita a mao, espelhando o zod acima;
 * padrao financas: sem minimum/maximum no JSON Schema, strict: true).
 */
export const extrairAgendamentoTool = {
  name: 'extrair_agendamento',
  description:
    'Extrai um compromisso em linguagem natural. Use quando o usuario quiser marcar/agendar algo. ' +
    'Sempre inclua confidence (0 a 1) sobre a interpretacao da data e do titulo.',
  input_schema: {
    type: 'object' as const,
    properties: {
      title: { type: 'string', description: 'Titulo curto do compromisso' },
      startsAt: {
        type: 'string',
        description: 'Inicio em ISO-8601 com offset, ex.: 2026-10-08T14:00:00-03:00',
      },
      durationMinutes: { type: 'integer', description: 'Duracao estimada em minutos' },
      confidence: { type: 'number', description: 'Confianca da extracao, 0 a 1' },
      dateEvidence: { type: 'string', description: 'Trecho da fala que fundamentou a data' },
    },
    required: ['title', 'startsAt', 'confidence'],
  },
  /**
   * Nota: mantido deliberadamente SEM `additionalProperties: false`. O modo strict do
   * Anthropic exige que todo campo top-level seja obrigatorio, o que quebraria os campos
   * opcionais (durationMinutes/dateEvidence). O contrato real e o zod (`extrairAgendamentoSchema`,
   * modo strip), validado com safeParse na API — ve ADR-003 e gotcha 4.
   */
};
