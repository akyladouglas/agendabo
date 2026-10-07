import { z } from 'zod';

/**
 * Saida da CLASSIFICACAO DE INTENCAO de um turno do bot (Fase 1, ADR-008).
 * O LLM so classifica a intencao do que o usuario disse; ele NUNCA extrai
 * data/hora/titulo nem decide conflito (isso e Fase 3 / schedule-core).
 * A intencao dirige qual transicao da maquina de estados roda; confianca
 * abaixo de MIN_CONFIDENCE_TO_ACCEPT => o bot pergunta, nunca executa
 * transicao destrutiva no chute (ADR-003/ADR-008).
 *
 * IMPORTANTE: nao usar .strict() aqui (gotcha 4) — o zod em modo strip
 * descarta silenciosamente campos extras que o modelo as vezes manda.
 */
export const INTENTS = [
  /** Usuario quer marcar um compromisso novo. */
  'criar',
  /** Cancelar/desistir: do fluxo aberto ("cancela", "deixa pra lá") ou de um compromisso. */
  'cancelar',
  /** Resposta que da continuidade ao passo atual do fluxo (da titulo, escolhe opcao...). */
  'continuar_fluxo',
  /** Em ramo de conflito: oferecer outro horario. */
  'remarcar',
  /** Novo agendamento com fluxo aberto => bot pergunta antes de descartar o atual. */
  'substituir_atual',
  /** Quer VER a agenda ("o que tenho hoje?", "semana que vem?") — so leitura, Fase 2. */
  'consultar',
  /**
   * Quer MUDAR um compromisso já criado ("muda a reunião pra sexta 16h", "adianta 1h").
   * Fase 4 (spec llm-avancado regra 9): NAO fundir com `remarcar` (ramo de conflito do
   * criar) nem com `cancelar` (desistir do fluxo aberto) — fundir destruiria a regra
   * "nunca descarta no chute" da Fase 1.
   */
  'editar_compromisso',
  /**
   * Quer CANCELAR/APAGAR um compromisso já criado ("cancela a consulta de quinta").
   * Fase 4: distinto de `cancelar` (= desistir do que esta EM ANDAMENTO no chat).
   */
  'cancelar_compromisso',
  /** Nao e sobre agenda (o bot responde padrao, sem criar nem alterar nada). */
  'fora_do_escopo',
] as const;

export const classifyIntentSchema = z.object({
  intent: z.enum(INTENTS),
  /** Confianca 0..1 da classificacao dada pelo proprio modelo (sempre obrigatoria). */
  confidence: z.number().min(0).max(1),
});
export type ClassifyIntentOutput = z.infer<typeof classifyIntentSchema>;
export type BotIntent = ClassifyIntentOutput['intent'];

/**
 * Tool definition para function calling (escrita a mao, espelhando o zod acima;
 * padrao financas: sem minimum/maximum no JSON Schema).
 */
export const classifyIntentTool = {
  name: 'classify_intent',
  description:
    'Classifica a intencao do usuario nesta mensagem do bot de agenda, dado o contexto ' +
    '(em qual etapa do fluxo de agendamento ele esta, se esta). Use contexto vazio como ' +
    '"fora do fluxo". Sempre inclua confidence (0 a 1); se nao tiver certeza, use um valor ' +
    'baixo em vez de chutar.',
  input_schema: {
    type: 'object' as const,
    properties: {
      intent: {
        type: 'string',
        enum: [...INTENTS],
        description:
          'criar = quer marcar algo novo; cancelar = quer cancelar/desistir do que esta em ' +
          'andamento; continuar_fluxo = resposta ao passo atual do fluxo; remarcar = oferecer ' +
          'outro horario apos conflito; substituir_atual = quer comecar um agendamento novo ' +
          'com fluxo ja aberto; consultar = quer ver/listar seus compromissos ("o que tenho ' +
          'hoje?", "semana que vem?"); editar_compromisso = quer mudar um compromisso ja ' +
          'criado ("muda a reuniao pra sexta 16h", "adianta 1 hora a reuniao"); ' +
          'cancelar_compromisso = quer cancelar/apagar um compromisso ja criado ("cancela a ' +
          'consulta de quinta"); fora_do_escopo = qualquer outra coisa',
      },
      confidence: { type: 'number', description: 'Confianca da classificacao, 0 a 1' },
    },
    required: ['intent', 'confidence'],
  },
  /**
   * Nota: mantido deliberadamente SEM `additionalProperties: false` — o strict do
   * Anthropic quebraria com campos extras do modelo. O contrato real e o zod
   * (`classifyIntentSchema`, modo strip), validado com safeParse na API (gotcha 4).
   */
};
