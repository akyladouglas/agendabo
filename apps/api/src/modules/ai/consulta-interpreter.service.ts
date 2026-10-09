import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  interpretarConsultaSchema,
  interpretarConsultaTool,
  normalizeToolUseInput,
  type InterpretarConsultaOutput,
} from '@agendabo/contracts';
import type { Env } from '../../config/env.validation';
import { LlmCallContextService } from './llm-call-context';
import type {
  MessageCreateTool,
  MessagesCreateParams,
  MessagesCreateResult,
} from './anthropic-messages-client';
import { AnthropicClientProvider } from './anthropic-client.provider';

/** Simbolos relativos que o contrato llm aceita (resolvidos em schedule-core). */
type ListarOutput = Extract<InterpretarConsultaOutput, { tipo: 'listar' }>;
type SimboloConsulta = NonNullable<ListarOutput['simbolo']>;

/**
 * Periodo pedido por uma consulta de agenda (Fase 2, decisao #2 da spec):
 * `simbolo` (resolvido deterministicamente em schedule-core) OU `intervalo`
 * (datas explicitas em calendario local do usuario — o LLM so extrai, a
 * aritmetica e do schedule-core; ADR-003/004 aplicado a leitura).
 */
export type ConsultaPeriodo =
  | { ok: true; simbolo: SimboloConsulta; confidence: number }
  | { ok: true; intervalo: { from: string; to: string }; confidence: number }
  | { ok: false; reason: 'parse' | 'low_confidence' | 'no_tool_use' | 'fora_do_escopo' };

const MAX_TOKENS = 256;

/** System prompt estavel (cache_control) — a data de hoje vive no bloco volatile. */
const SYSTEM_PROMPT = [
  'Voce interpreta a PERGUNDA que o usuario faz sobre a propria agenda em um bot de agenda.',
  'Responda SEMPRE usando a ferramenta interpretar_consulta_agenda; nunca invente outros campos.',
  '',
  'Regras:',
  '- tipo "listar" quando o usuario quer ver/listar seus compromissos em um periodo;',
  '  tipo "fora_do_escopo" em qualquer outra coisa.',
  '- PREFERA o campo simbolo para fala relativa (hoje, amanha, semana que vem, mes que vem, ...):',
  '  a data e resolvida por regra deterministica, nao por voce. NUNCA calcule a data de um',
  '  simbolo por sua conta.',
  '- Use "intervalo" (from/to, datas YYYY-MM-DD em calendario local, SEM horario) apenas quando',
  '  o usuario disser dia/mes/ano explicito ("dia 10", "de 10 a 12", "15 de novembro").',
  '  O "to" e o fim EXCLUSIVO: "de 10 a 12" => from 10, to 13. Ancore o mes/ano faltante na',
  '  data de hoje informada no prompt.',
  '- Sem periodo claro na fala (ex.: "meus compromissos"), deixe simbolo e intervalo em branco',
  '  e use confidence baixa: quem recebe vai perguntar o periodo.',
  '- Na duvida, prefira confidence baixa (ex.: 0.3) a chutar.',
].join('\n');

/**
 * Interpretacao do PERIODO de uma consulta de agenda (Fase 2, spec #4): padrao fiel do
 * IntentClassifierService — tool calling + safeParse + limiar + cascata primario (haiku)
 * -> escalada (sonnet) em falha de parse/timeout (llm.md #3/#4/#7). A data de hoje no
 * timezone do usuario vai no bloco volatile (llm.md #4).
 */
@Injectable()
export class ConsultaInterpreterService {
  private readonly logger = new Logger(ConsultaInterpreterService.name);

  constructor(
    private readonly client: AnthropicClientProvider,
    private readonly config: ConfigService<Env, true>,
    private readonly llmCtx: LlmCallContextService,
  ) {}

  async interpret(
    text: string,
    context: { todayLocal: string; inFlowStep?: string },
    observability?: { userId?: string },
  ): Promise<ConsultaPeriodo> {
    const userId = observability?.userId;
    const minConfidence = this.config.get('MIN_CONFIDENCE_TO_ACCEPT', { infer: true });
    const models = [
      this.config.get('LLM_MODEL_PRIMARY', { infer: true }),
      this.config.get('LLM_MODEL_ESCALATION', { infer: true }),
    ];

    let lastFailure: Extract<ConsultaPeriodo, { ok: false }>['reason'] = 'no_tool_use';
    for (const [index, model] of models.entries()) {
      const escalation = index > 0;
      let response: MessagesCreateResult;
      try {
        // llm_calls (Fase 9/D-P2): escopo lexico — run() abarge a chamada.
        response = await this.llmCtx.run({ userId, purpose: 'query_interpretation' }, () =>
          this.client.create(this.buildParams(model, text, context)),
        );
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

      const parsed = interpretarConsultaSchema.safeParse(normalizeToolUseInput(toolUse.input));
      if (!parsed.success) {
        this.logger.warn(`Resposta do LLM (${model}) falhou no safeParse: ${parsed.error.message}`);
        lastFailure = 'parse';
        continue; // escala para tentar de novo no modelo maior
      }
      if (parsed.data.confidence < minConfidence) {
        // Confianca baixa NAO se resolve trocando de modelo: devolve para o bot
        // PERGUNTAR o periodo antes de consultar (spec #5, ADR-003).
        return { ok: false, reason: 'low_confidence' };
      }
      if (parsed.data.tipo === 'fora_do_escopo') {
        return { ok: false, reason: 'fora_do_escopo' };
      }
      if (parsed.data.simbolo) {
        // simbolo presente => intervalo e ignorado (contrato do contracts/llm).
        return { ok: true, simbolo: parsed.data.simbolo, confidence: parsed.data.confidence };
      }
      if (parsed.data.intervalo) {
        return {
          ok: true,
          intervalo: parsed.data.intervalo,
          confidence: parsed.data.confidence,
        };
      }
      // "listar" sem simbolo nem intervalo: periodo nao extraido — o bot pergunta.
      return { ok: false, reason: 'parse' };
    }
    return { ok: false, reason: lastFailure };
  }

  private buildParams(
    model: string,
    text: string,
    context: { todayLocal: string; inFlowStep?: string },
  ): MessagesCreateParams {
    return {
      model,
      max_tokens: MAX_TOKENS,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: [
        {
          name: interpretarConsultaTool.name,
          description: interpretarConsultaTool.description,
          input_schema: interpretarConsultaTool.input_schema as MessageCreateTool['input_schema'],
        },
      ],
      tool_choice: { type: 'tool', name: interpretarConsultaTool.name },
      messages: [{ role: 'user', content: this.buildUserContent(text, context) }],
    };
  }

  private buildUserContent(
    text: string,
    context: { todayLocal: string; inFlowStep?: string },
  ): string {
    const lines: string[] = [`data de hoje no timezone do usuario: ${context.todayLocal}`];
    if (context.inFlowStep) {
      lines.push(`contexto: usuario esta em meio a um agendamento (etapa: ${context.inFlowStep}).`);
    }
    lines.push(`pergunta do usuario: """${text}"""`);
    return lines.join('\n');
  }
}
