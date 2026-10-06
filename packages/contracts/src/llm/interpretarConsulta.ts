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
  /** Pedido de lista de compromissos num intervalo. */
  z.object({
    tipo: z.literal('listar'),
    intervalo: intervaloSchema,
    confidence: z.number().min(0).max(1),
  }),
  /** Usuario nao estava perguntando sobre agenda (o bot segue outro fluxo). */
  z.object({
    tipo: z.literal('fora_do_escopo'),
    confidence: z.number().min(0).max(1),
  }),
]);
export type InterpretarConsultaOutput = z.infer<typeof interpretarConsultaSchema>;

/** Tool definition para function calling (mesmas regras da outra tool). */
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
      from: { type: 'string', description: 'Inicio do intervalo (YYYY-MM-DD ou ISO-8601)' },
      to: { type: 'string', description: 'Fim do intervalo (exclusivo)' },
      confidence: { type: 'number', description: 'Confianca da interpretacao, 0 a 1' },
    },
    required: ['tipo', 'confidence'],
  },
  /** Sem `additionalProperties: false` — ver nota em extrairAgendamentoTool. */
};
