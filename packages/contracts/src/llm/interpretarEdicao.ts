import { z } from 'zod';

/**
 * Saida da interpretacao de um pedido de EDICAO/CANCELAMENTO de compromisso pelo chat
 * (Fase 4, spec llm-avancado regra 10): "muda a reunião pra sexta 16h", "adianta 1 hora
 * a reunião", "cancela a consulta de quinta". O LLM so traduz a fala em DESCRICAO +
 * quando aproximado + delta; LOCALIZAR o compromisso e 100% deterministico
 * (`findMatchingAppointments` em schedule-core) e o novo horario passa pela MESMA
 * regua de confianca da criacao (regra 6).
 *
 * IMPORTANTE: nao usar .strict() aqui (gotcha 4) — o zod em modo strip descarta
 * silenciosamente campos extras que o modelo as vezes manda.
 */
export const interpretarEdicaoSchema = z.object({
  /** editar = mudar titulo/data/duracao; cancelar = apagar o compromisso. */
  acao: z.enum(['editar', 'cancelar']),
  /**
   * Palavras do titulo / descricao do compromisso a localizar ("a reunião",
   * "consulta no dentista"). SEMPRE a base da busca: localizar != extrair datas.
   */
  descricao: z.string().max(200).optional(),
  /**
   * Quando aproximado do compromisso alvo (simbolo OU datas explicitas, a la
   * interpretarConsulta) — vira FILTRO da busca, nunca decisão. A aritmetica de
   * calendario e do schedule-core (ADR-004).
   */
  alvoData: z
    .object({
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
      /** Inicio ISO-8601 com offset (ou YYYY-MM-DD) do periodo do alvo. */
      from: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/, 'datetime ISO-8601')
        .optional(),
      /** Fim EXCLUSIVO do periodo do alvo ("de quinta a sexta" => to sabado). */
      to: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/, 'datetime ISO-8601')
        .optional(),
    })
    .optional(),
  /** Novo inicio em ISO-8601 com offset explicito no tz do usuario (somente editar com
   *  horario novo). A borda valida o offset contra o tz da conta e aplica a regua da
   *  regra 6 — o modelo nunca confirma nada. */
  novoInicio: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/, 'datetime ISO-8601 com offset')
    .optional(),
  /** Nova duracao em minutos (somente editar); default da borda = manter a atual. */
  novaDuracaoMin: z.number().int().min(5).max(1440).optional(),
  /**
   * Deslocamento falado ("adianta 1 hora" => -60; "joga 30min pra mais tarde" => +30).
   * A NOVA data e `startsAt + delta` calculada em schedule-core (`applyShift`), nunca
   * pelo modelo (spec regra 10).
   */
  deslocamentoMin: z.number().int().min(-1440).max(1440).optional(),
  /** Trecho da fala que fundamentou a data/evidencia (auditoria da fila de revisao). */
  evidence: z.string().max(300).optional(),
  /** Confianca 0..1 da interpretacao dada pelo proprio modelo (sempre obrigatoria). */
  confidence: z.number().min(0).max(1),
});
export type InterpretarEdicaoOutput = z.infer<typeof interpretarEdicaoSchema>;

/**
 * Tool definition para function calling (escrita a mao, espelhando o zod acima;
 * padrao financas: sem minimum/maximum no JSON Schema).
 *
 * Mantida SEM `additionalProperties: false` (strict do Anthropic quebraria com os
 * campos opcionais — gotcha 4). O contrato real e o zod (`interpretarEdicaoSchema`,
 * modo strip), validado com safeParse na API. `alvoData` e o unico campo aninhado
 * (objeto de propriedades todas opcionais); o normalizador abaixo canoniza o payload
 * PLANO que o modelo as vezes manda.
 */
export const interpretarEdicaoTool = {
  name: 'interpretar_pedido_edicao',
  description:
    'Interpreta um pedido do usuario para EDITAR ou CANCELAR um compromisso ja existente. ' +
    'Use a data de hoje informada no prompt para resolver "hoje"/"amanha"/"quinta". ' +
    'SEMPRE preencha descricao com as palavras do titulo ditas pelo usuario (a busca e ' +
    'feita por elas, nao por voce). Voce NUNCA escolhe o compromisso nem calcula o novo ' +
    'horario final: para "adianta/atrasa N tempo" devolva apenas deslocamentoMin (negativo ' +
    '= mais cedo). Sempre inclua confidence (0 a 1); na duvida, valor baixo em vez de chutar.',
  input_schema: {
    type: 'object' as const,
    properties: {
      acao: {
        type: 'string',
        enum: ['editar', 'cancelar'],
        description: 'editar = mudar titulo/data/duracao; cancelar = cancelar/apagar',
      },
      descricao: {
        type: 'string',
        description:
          'Palavras do titulo do compromisso que o usuario usou ("a reuniao", "consulta no ' +
          'dentista"). Base da busca deterministica.',
      },
      alvoData: {
        type: 'object',
        description:
          'Quando aproximado do compromisso alvo ("a consulta de quinta"). Filtro da busca; ' +
          'prefira simbolo para fala relativa (hoje, amanha, semana_que_vem, ...).',
        properties: {
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
            description: 'Fala relativa: resolvida por regra deterministica, nunca por voce.',
          },
          from: {
            type: 'string',
            description: 'Inicio do periodo (YYYY-MM-DD ou ISO com offset), data explicita',
          },
          to: {
            type: 'string',
            description: 'Fim EXCLUSIVO do periodo ("de quinta a sexta" => sabado)',
          },
        },
      },
      novoInicio: {
        type: 'string',
        description:
          'Somente editar com horario novo: inicio em ISO-8601 com offset, ex.: ' +
          '2026-10-09T16:00:00-03:00. Omita para deslocamentos ("adianta 1h").',
      },
      novaDuracaoMin: {
        type: 'integer',
        description: 'Nova duracao em minutos, se o usuario mudou a duracao',
      },
      deslocamentoMin: {
        type: 'integer',
        description:
          '"adianta 1 hora" => -60; "joga 30 minutos pra mais tarde" => 30. Use no lugar de ' +
          'novoInicio; a nova data e calculada por regra, nao por voce.',
      },
      evidence: {
        type: 'string',
        description: 'Trecho da fala que fundamentou a data/interpretacao',
      },
      confidence: { type: 'number', description: 'Confianca da interpretacao, 0 a 1' },
    },
    required: ['acao', 'confidence'],
  },
  /** Sem `additionalProperties: false` — ver nota no schema. */
};

/**
 * Canoniza a saida da tool p/ o formato do zod: aceita `alvoData` aninhado (o contrato)
 * e tolera o payload PLANO (`simbolo`/`from`/`to` no topo) que o modelo as vezes manda.
 * Campos extras passam (strip no zod).
 */
export function normalizeEdicaoToolUseInput(input: unknown): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return input;
  const raw = input as Record<string, unknown>;
  if (raw.alvoData !== undefined && raw.alvoData !== null) return raw;
  const flat: Record<string, unknown> = {};
  for (const key of ['simbolo', 'from', 'to'] as const) {
    if (typeof raw[key] === 'string' && raw[key] !== '') flat[key] = raw[key];
    delete raw[key];
  }
  if (Object.keys(flat).length > 0) return { ...raw, alvoData: flat };
  return raw;
}
