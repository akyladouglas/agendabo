import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  interpretarEdicaoSchema,
  interpretarEdicaoTool,
  normalizeEdicaoToolUseInput,
  type InterpretarEdicaoOutput,
} from '@agendabo/contracts';
import type { Env } from '../../config/env.validation';
import type {
  MessageCreateTool,
  MessagesCreateParams,
  MessagesCreateResult,
} from './anthropic-messages-client';
import { AnthropicClientProvider } from './anthropic-client.provider';

/**
 * Resultado discriminado do EXTRATOR do editar/cancelar (Fase 4, spec regra 10).
 * O veredito do quando novo é da RÉGUA (`classificarEdicao`, domínio puro) — nunca
 * deste service e nunca do modelo (ADR-003). A LOCALIZAÇÃO do compromisso é 100%
 * determinística (`findMatchingAppointments`), este service só traduz a fala.
 */
export type EdicaoExtraction =
  | { ok: true; data: InterpretarEdicaoOutput; rawText: string }
  | { ok: false; reason: 'parse' | 'low_confidence' | 'no_tool_use' };

const MAX_TOKENS = 256;

/** System prompt estável (cache_control) — "hoje" vive no bloco volátil (llm.md #4). */
const SYSTEM_PROMPT = [
  'Voce interpreta um pedido de EDICAO ou CANCELAMENTO de um compromisso ja existente.',
  'Responda SEMPRE usando a ferramenta interpretar_pedido_edicao; nunca invente outros campos.',
  '',
  'Regras:',
  '- Use a data de hoje informada no prompt (no timezone do usuario) para resolver',
  '  datas relativas ("a de quinta", "a de amanha").',
  '- SEMPRE preencha `descricao` com as palavras do titulo que o usuario usou — a busca',
  '  do compromisso e feita por elas, nunca por voce.',
  '- "adianta 1 hora" => deslocamentoMin -60; "atrasa 30 minutos" => +30. NUNCA calcule',
  '  a nova data voce mesmo: devolva so o deslocamento.',
  '- novoInicio SOMENTE quando o usuario deu data E hora novas explicitas, em ISO-8601 com',
  '  offset do timezone dele (ex.: 2026-10-09T16:00:00-03:00).',
  '- alvoData: filtro aproximado do compromisso alvo; prefira `simbolo` p/ fala relativa.',
  '- acao "cancelar" para cancelar/apagar; "editar" para qualquer mudanca.',
  '- Voce NUNCA escolhe o compromisso nem confirma nada. Na duvida, confidence baixa.',
].join('\n');

/**
 * Extrator do EDITAR/CANCELAR pelo chat (Fase 4, spec regra 10/B): tool calling +
 * safeParse (+ `normalizeEdicaoToolUseInput` p/ payload plano) + limiar + cascata
 * primario → escalada (llm.md #3/#4/#7) — padrão dos outros interpretadores. A data de
 * hoje no tz do usuário vai no bloco volátil. Diferente do extrator do criar: confiança
 * baixa AQUI é falha (no editar NUNCA há needs_review — spec regra 20; o bot re-pergunta).
 */
@Injectable()
export class AppointmentEditInterpreterService {
  private readonly logger = new Logger(AppointmentEditInterpreterService.name);

  constructor(
    private readonly client: AnthropicClientProvider,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async interpretar(text: string, context: { todayLocal: string }): Promise<EdicaoExtraction> {
    const minConfidence = this.config.get('MIN_CONFIDENCE_TO_ACCEPT', { infer: true });
    const models = [
      this.config.get('LLM_MODEL_PRIMARY', { infer: true }),
      this.config.get('LLM_MODEL_ESCALATION', { infer: true }),
    ];

    let lastFailure: Extract<EdicaoExtraction, { ok: false }>['reason'] = 'no_tool_use';
    for (const [index, model] of models.entries()) {
      const escalation = index > 0;
      let response: MessagesCreateResult;
      try {
        response = await this.client.create(this.buildParams(model, text, context));
      } catch (err) {
        // timeout/erro de rede: única tentativa extra e no modelo de escalada (llm.md #7).
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

      const parsed = interpretarEdicaoSchema.safeParse(normalizeEdicaoToolUseInput(toolUse.input));
      if (!parsed.success) {
        this.logger.warn(`Resposta do LLM (${model}) falhou no safeParse: ${parsed.error.message}`);
        lastFailure = 'parse';
        continue; // escala para tentar de novo no modelo maior
      }
      if (parsed.data.confidence < minConfidence) {
        // No editar, confiança baixa NÃO vira fila de revisão (spec regra 20): o bot
        // re-pergunta. Trocar de modelo também não resolve (padrão llm.md #5).
        return { ok: false, reason: 'low_confidence' };
      }
      return { ok: true, data: parsed.data, rawText: text };
    }
    return { ok: false, reason: lastFailure };
  }

  private buildParams(
    model: string,
    text: string,
    context: { todayLocal: string },
  ): MessagesCreateParams {
    return {
      model,
      max_tokens: MAX_TOKENS,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: [
        {
          name: interpretarEdicaoTool.name,
          description: interpretarEdicaoTool.description,
          input_schema: interpretarEdicaoTool.input_schema as MessageCreateTool['input_schema'],
        },
      ],
      tool_choice: { type: 'tool', name: interpretarEdicaoTool.name },
      messages: [{ role: 'user', content: this.buildUserContent(text, context) }],
    };
  }

  private buildUserContent(text: string, context: { todayLocal: string }): string {
    const lines: string[] = [`data de hoje no timezone do usuario: ${context.todayLocal}`];
    lines.push(`fala do usuario: """${text}"""`);
    return lines.join('\n');
  }
}
