import { z } from 'zod';

/**
 * Saida da interpretacao de consultas de agenda em linguagem natural (fase 5, item 2.2):
 * "quais meus compromissos do dia X do mes Y de Z?", "hoje", "amanha", "semana que vem".
 */
export const intervaloSchema = z.object({
  /** Inicio ISO-8601 com offset. */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/, 'datetime ISO-8601'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/, 'datetime ISO-8601'),
});

export const interpretarConsultaSchema = z.discriminatedUnion('tipo', [
  /** Pedido de lista de compromissos num intervalo.
   *  Data: o LLM extrai o "quando"; a aritmetica de calendario (meia-noite local,
   *  semana civil, meio-aberto) e SEMPRE resolvida em schedule-core (ADR-004). */
  z.object({
    tipo: z.literal('listar'),
    intervalo: intervaloSchema.optional(),
    /**
     * Simbolo relativo quando a fala usa "hoje"/"amanha"/etc. — resolvido
     * deterministicamente em schedule-core (decisao #2 da spec da Fase 2).
     * Quando presente, `intervalo` e ignorado; quando ausente, usar `intervalo`.
     */
    simbolo: z
      .enum([
        'hoje',
        'amanha',
        'depois_de_amanha',
        'esta_semana',
        'semana_que_vem',
        'este_mes',
        'mes_que_vem',
        'este_ano',
        'ano_que_vem',
        'fim_de_semana',
      ])
      .optional(),
    confidence: z.number().min(0).max(1),
  }),
  /** Usuario nao estava perguntando sobre agenda (o bot segue outro fluxo). */
  z.object({
    tipo: z.literal('fora_do_escopo'),
    confidence: z.number().min(0).max(1),
  }),
]);
export type InterpretarConsultaOutput = z.infer<typeof interpretarConsultaSchema>;

/**
 * Tool definition para function calling (mesmas regras da outra tool).
 *
 * FLAT (from/to no topo) porque `intervalo` e `simbolo` sao opcionais no zod; a tool
 * NAO usa `additionalProperties: false` (strict do Anthropic quebraria com campos
 * opcionais — gotcha 4). O modelo pode mandar `{ from, to }` plano ou `intervalo`
 * aninhado; `normalizeToolUseInput` canoniza p/ o formato do zod ANTES do safeParse.
 */
export const interpretarConsultaTool = {
  name: 'interpretar_consulta_agenda',
  description:
    'Interpreta uma pergunta do usuario sobre seus compromissos e devolve o intervalo de datas pedido. ' +
    'Use a data de hoje informada no prompt para resolver "hoje", "amanha", "semana que vem".',
  input_schema: {
    type: 'object' as const,
    properties: {
      tipo: {
        type: 'string',
        enum: ['listar', 'fora_do_escopo'],
        description: 'listar = pergunta sobre compromissos; fora_do_escopo = qualquer outra coisa',
      },
      from: {
        type: 'string',
        description:
          'Inicio do intervalo (YYYY-MM-DD), apenas para datas explicitas; omita quando usar simbolo',
      },
      to: {
        type: 'string',
        description:
          'Fim do intervalo (EXCLUSIVO: "de 10 a 12" => to 13); omita quando usar simbolo',
      },
      simbolo: {
        type: 'string',
        enum: [
          'hoje',
          'amanha',
          'depois_de_amanha',
          'esta_semana',
          'semana_que_vem',
          'este_mes',
          'mes_que_vem',
          'este_ano',
          'ano_que_vem',
          'fim_de_semana',
        ],
        description:
          'Use para fala relativa (hoje, amanha, semana que vem, ...): a data e resolvida ' +
          'por regra deterministica, nao por voce. Prefira simbolo a calcular datas voce mesmo.',
      },
      confidence: { type: 'number', description: 'Confianca da interpretacao, 0 a 1' },
    },
    required: ['tipo', 'confidence'],
  },
  /** Sem `additionalProperties: false` — ver nota em extrairAgendamentoTool. */
};

/**
 * Canoniza a saida da tool p/ o formato do zod: aceita o payload PLANO
 * (`{ tipo, from, to, simbolo, confidence }`) que o modelo manda nesse contrato e o
 * ANINHADO (`intervalo: { from, to }`). `simbolo` tem prioridade (contrato do schema:
 * com simbolo presente, `intervalo` e ignorado). Campos extras passam (strip no zod).
 */
export function normalizeToolUseInput(input: unknown): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return input;
  const raw = input as Record<string, unknown>;
  if (raw.intervalo !== undefined && raw.intervalo !== null) return raw;
  if (typeof raw.from === 'string' && typeof raw.to === 'string') {
    const { from, to, ...rest } = raw;
    return { ...rest, intervalo: { from, to } };
  }
  return raw;
}
