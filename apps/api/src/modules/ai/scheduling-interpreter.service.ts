import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  extrairAgendamentoSchema,
  extrairAgendamentoTool,
  type ExtrairAgendamentoOutput,
} from '@agendabo/contracts';
import type { Env } from '../../config/env.validation';
import type {
  MessageCreateTool,
  MessagesCreateParams,
  MessagesCreateResult,
} from './anthropic-messages-client';
import { AnthropicClientProvider } from './anthropic-client.provider';

/**
 * Resultado discriminado do EXTRATOR do criar (Fase 4, spec llm-avancado regra 5):
 * o LLM traduz a fala solta no payload bruto da tool; QUEM decide o veredito é a
 * RÉGUA (`classificarExtracao`, domínio puro), nunca este service e nunca o modelo
 * (ADR-003). `rawText` volta junto para o needs_review persistir a fala do usuário
 * (spec regra 7) sem o service ter que carregá-la de outro lugar.
 */
export type SchedulingExtraction =
  | { ok: true; data: ExtrairAgendamentoOutput; rawText: string }
  | { ok: false; reason: 'parse' | 'low_confidence' | 'no_tool_use' };

const MAX_TOKENS = 256;

/** System prompt estável (cache_control) — "hoje" vive no bloco volátil (llm.md #4). */
const SYSTEM_PROMPT = [
  'Voce extrai UM compromisso novo da fala do usuario para a ferramenta extrair_agendamento.',
  'Responda SEMPRE usando a ferramenta; nunca invente outros campos.',
  '',
  'Regras:',
  '- Use a data de hoje informada no prompt (no timezone do usuario) para resolver datas',
  '  relativas ("quinta", "semana que vem", "depois de amanha").',
  '- startsAt: ISO-8601 COM offset explicito do timezone do usuario (ex.: 2026-10-08T14:00:00-03:00).',
  '  NUNCA mande hora sem offset nem em UTC se o usuario falou no horario dele.',
  '- Se o usuario nao disse a HORA, use 09:00 no dia entendido e BAIXE a confidence (<= 0.5).',
  '- Se nao ha dia/hora na fala, use a data de hoje as 09:00 (com offset) e confidence <= 0.3.',
  '- durationMinutes apenas quando o usuario estimou duracao; senao omita.',
  '- dateEvidence: o trecho EXATO da fala que fundamentou a data (p/ auditoria).',
  '- Voce NUNCA decide se o compromisso e valido: so traduz. Na duvida, confidence baixa.',
].join('\n');

/**
 * Extrator do CRIAR em fala solta (Fase 4, spec regra 5/A1): tool calling + safeParse +
 * limiar + cascata primario (haiku) → escalada (sonnet) em falha de parse/timeout
 * (llm.md #3/#4/#7) — padrão fiel de ConsultaInterpreterService. A data de hoje no tz do
 * usuário vai no bloco volátil. O veredito (aceito/fraco/sem_quando) é da RÉGUA, que roda
 * no bot com este payload (aqui NÃO se aplica a régua: ela é domínio puro do bot).
 */
@Injectable()
export class SchedulingInterpreterService {
  private readonly logger = new Logger(SchedulingInterpreterService.name);

  constructor(
    private readonly client: AnthropicClientProvider,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async interpretar(text: string, context: { todayLocal: string }): Promise<SchedulingExtraction> {
    const minConfidence = this.config.get('MIN_CONFIDENCE_TO_ACCEPT', { infer: true });
    const models = [
      this.config.get('LLM_MODEL_PRIMARY', { infer: true }),
      this.config.get('LLM_MODEL_ESCALATION', { infer: true }),
    ];

    let lastFailure: Extract<SchedulingExtraction, { ok: false }>['reason'] = 'no_tool_use';
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

      const parsed = extrairAgendamentoSchema.safeParse(toolUse.input);
      if (!parsed.success) {
        this.logger.warn(`Resposta do LLM (${model}) falhou no safeParse: ${parsed.error.message}`);
        lastFailure = 'parse';
        continue; // escala para tentar de novo no modelo maior
      }
      if (parsed.data.confidence < minConfidence) {
        // A régua usa payloads de confiança baixa para o needs_review (spec regra 6):
        // o service NÃO descarta — o veredito é da régua. O limiar aqui só barra o
        // uso como "candidato forte" (log); por isso NÃO retornamos falha.
        this.logger.log(
          `extrator (${model}): confidence ${parsed.data.confidence} < ${minConfidence} — régua decide`,
        );
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
          name: extrairAgendamentoTool.name,
          description: extrairAgendamentoTool.description,
          input_schema: extrairAgendamentoTool.input_schema as MessageCreateTool['input_schema'],
        },
      ],
      tool_choice: { type: 'tool', name: extrairAgendamentoTool.name },
      messages: [{ role: 'user', content: this.buildUserContent(text, context) }],
    };
  }

  private buildUserContent(text: string, context: { todayLocal: string }): string {
    const lines: string[] = [`data de hoje no timezone do usuario: ${context.todayLocal}`];
    lines.push(`fala do usuario: """${text}"""`);
    return lines.join('\n');
  }
}
