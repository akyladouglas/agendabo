import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { classifyIntentSchema, classifyIntentTool, type BotIntent } from '@agendabo/contracts';
import type { Env } from '../../config/env.validation';
import type {
  MessageCreateTool,
  MessagesCreateParams,
  MessagesCreateResult,
} from './anthropic-messages-client';
import { AnthropicClientProvider } from './anthropic-client.provider';

/** Estado resumido do fluxo do bot, injetado no prompt como contexto (nunca no banco por mensagem). */
export type IntentFlowContext =
  { inFlow: false } | { inFlow: true; step: string; conflictPending?: boolean };

/** Resultado discriminado da classificacao (ADR-003/ADR-008: falha nunca vira acao). */
export type IntentResult =
  | { ok: true; intent: BotIntent; confidence: number }
  | { ok: false; reason: 'parse' | 'low_confidence' | 'no_tool_use' };

const MAX_TOKENS = 256;

/** System prompt estavel (cache_control) — a data/contexto vivem no bloco volatile. */
const SYSTEM_PROMPT = [
  'Voce classifica a intencao de UMA mensagem do usuario de um bot de agenda no Telegram.',
  'Responda SEMPRE usando a ferramenta classify_intent; nunca invente outros campos.',
  '',
  'Intencoes:',
  '- criar: quer marcar/-agendar um compromisso novo (ex.: "quero marcar uma consulta").',
  '- consultar: quer VER/listar seus compromissos ("o que tenho hoje?", "o que tenho ' +
    '  semana que vem?") — somente leitura, nunca cria nada.',
  '- cancelar: quer cancelar/desistir de algo dito agora (ex.: "cancela", "deixa pra lá",',
  '  "melhor não", "para por enquanto") ou cancelar um compromisso.',
  '- continuar_fluxo: esta respondendo a pergunta atual do bot (da um titulo, escolhe um',
  '  dia/hora, responde sim/nas, da uma nota, confirma).',
  '- remarcar: apos um conflito, quer propor outro horario (ex.: "e as 16h?", "remarca").',
  '- substituir_atual: quer comecar um agendamento novo enquanto ja existe um fluxo aberto',
  '  (ex.: "nao, marca outra coisa").',
  '- fora_do_escopo: qualquer outra coisa (conversa fiada, pergunta fora de agenda).',
  '',
  'Regras:',
  '- Use o contexto informado (em_fluxo, etapa) para escolher entre continuar_fluxo, criar,',
  '  remarcar e substituir_atual. Sem contexto de fluxo, respostas soltas raramente sao',
  '  continuar_fluxo.',
  '- Na duvida, prefira confidence baixa (ex.: 0.3) a chutar: quem recebe pergunta quando a',
  '  confianca e baixa.',
  '- Voce NUNCA extrai data, hora ou titulo; apenas classifica a intencao.',
].join('\n');

/**
 * Classificacao de intencao do turno do bot (Fase 1, ADR-008): unica categoria de
 * LLM da fase. Tool calling + safeParse do zod + limiar de confianca; cascata
 * primario (haiku) -> escalada (sonnet) em falha de parse/timeout (llm.md #4/#7).
 */
@Injectable()
export class IntentClassifierService {
  private readonly logger = new Logger(IntentClassifierService.name);

  constructor(
    private readonly client: AnthropicClientProvider,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async classify(message: string, context?: IntentFlowContext): Promise<IntentResult> {
    const minConfidence = this.config.get('MIN_CONFIDENCE_TO_ACCEPT', { infer: true });
    const models = [
      this.config.get('LLM_MODEL_PRIMARY', { infer: true }),
      this.config.get('LLM_MODEL_ESCALATION', { infer: true }),
    ];

    let lastFailure: Extract<IntentResult, { ok: false }>['reason'] = 'no_tool_use';
    for (const [index, model] of models.entries()) {
      const escalation = index > 0;
      let response: MessagesCreateResult;
      try {
        response = await this.client.create(this.buildParams(model, message, context));
      } catch (err) {
        // timeout/erro de rede: unica tentativa extra e no modelo de escalada (llm.md #7).
        this.logger.warn(
          `LLM (${model}) falhou: ${String(err)}${escalation ? '' : ' — escalando'}`,
        );
        lastFailure = 'parse';
        continue;
      }

      const toolUse = response.content.find((b) => b.type === 'tool_use');
      if (!toolUse || toolUse.type !== 'tool_use') {
        lastFailure = 'no_tool_use';
        if (!escalation) continue;
        break;
      }

      const parsed = classifyIntentSchema.safeParse(toolUse.input);
      if (!parsed.success) {
        this.logger.warn(`Resposta do LLM (${model}) falhou no safeParse: ${parsed.error.message}`);
        lastFailure = 'parse';
        continue; // escala para tentar de novo no modelo maior
      }
      if (parsed.data.confidence < minConfidence) {
        // Confianca baixa NAO se resolve trocando de modelo: devolve pra máquina
        // de estados PERGUNTAR antes de qualquer transicao destrutiva (spec #13).
        return { ok: false, reason: 'low_confidence' };
      }
      return { ok: true, intent: parsed.data.intent, confidence: parsed.data.confidence };
    }
    return { ok: false, reason: lastFailure };
  }

  private buildParams(
    model: string,
    message: string,
    context?: IntentFlowContext,
  ): MessagesCreateParams {
    return {
      model,
      max_tokens: MAX_TOKENS,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: [
        {
          name: classifyIntentTool.name,
          description: classifyIntentTool.description,
          input_schema: classifyIntentTool.input_schema as MessageCreateTool['input_schema'],
        },
      ],
      tool_choice: { type: 'tool', name: classifyIntentTool.name },
      messages: [{ role: 'user', content: this.buildUserContent(message, context) }],
    };
  }

  private buildUserContent(message: string, context?: IntentFlowContext): string {
    const lines: string[] = [];
    if (context?.inFlow) {
      lines.push(`contexto: usuario esta no fluxo de agendamento (etapa: ${context.step}).`);
      if (context.conflictPending) lines.push('contexto: ha um conflito pendente de decisao.');
      lines.push(
        'contexto: dentro do fluxo, uma pergunta sobre a agenda ("o que tenho hoje?") e consultar.',
      );
    } else {
      lines.push('contexto: usuario esta fora do fluxo de agendamento.');
    }
    lines.push(`mensagem do usuario: """${message}"""`);
    return lines.join('\n');
  }
}
