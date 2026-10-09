import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  extrairLembreteSchema,
  extrairLembreteTool,
  normalizeLembreteToolUseInput,
  type NotificationRuleInput,
} from '@agendabo/contracts';
import type { Env } from '../../config/env.validation';
import { LlmCallContextService } from './llm-call-context';
import type {
  MessageCreateTool,
  MessagesCreateParams,
  MessagesCreateResult,
} from './anthropic-messages-client';
import { AnthropicClientProvider } from './anthropic-client.provider';

/**
 * Resultado discriminado da interpretação do esquema de lembrete (ADR-003: falha
 * nunca vira regra — o bot re-pergunta). `source` só interessa p/ log/teste.
 */
export type ReminderResult =
  | { ok: true; regras: NotificationRuleInput[]; source: 'atalho' | 'llm' }
  | { ok: false; reason: 'parse' | 'low_confidence' | 'no_tool_use' };

const MAX_TOKENS = 256;

/** System prompt estável (cache_control) — nada de data aqui (não depende de "hoje"). */
const SYSTEM_PROMPT = [
  'Voce interpreta o ESQUEMA DE LEMBRETE que o usuario descreve para um compromisso.',
  'Responda SEMPRE usando a ferramenta extrair_esquema_lembrete; nunca invente outros campos.',
  '',
  'Regras:',
  '- "sem lembrete"/"nao quero lembrete" => UMA regra none (sozinha no array).',
  '- "24 horas antes" => before_hours 24; "um dia antes" => before_days 1; "duas horas antes" => before_hours 2.',
  '- "3-2-1"/"contagem regressiva" => UMA regra countdown_3_2_1 (sem value): a expansao em 3/2/1 dias',
  '  e feita por regra deterministica, nunca por voce.',
  '- Combinacao livre ("3 dias antes e 1 hora antes", "3-2-1 e 1h antes") => UMA regra por parte.',
  '- Voce NUNCA escolhe horarios nem calcula instantes: so traduz a fala em regras.',
  '- Na duvida, prefira confidence baixa (ex.: 0.3) a chutar.',
].join('\n');

/**
 * Interpretação do esquema de lembrete falado no passo `lembrete` (Fase 3, spec
 * regra 3/4): atalhos determinísticos ANTES do LLM (D3 do plano — "não"/"24h antes"/
 * "3-2-1" não gastam LLM), depois tool calling + safeParse + limiar + cascata
 * haiku→sonnet (padrão fiel de IntentClassifierService/ConsultaInterpreterService).
 * O LLM nunca calcula instante — quem decide o quando é `computeTriggers` (ADR-004).
 */
@Injectable()
export class ReminderInterpreterService {
  private readonly logger = new Logger(ReminderInterpreterService.name);

  constructor(
    private readonly client: AnthropicClientProvider,
    private readonly config: ConfigService<Env, true>,
    private readonly llmCtx: LlmCallContextService,
  ) {}

  async interpretar(texto: string, observability?: { userId?: string }): Promise<ReminderResult> {
    const userId = observability?.userId;
    const shortcut = resolveReminderShortcut(texto);
    if (shortcut) return { ok: true, regras: shortcut, source: 'atalho' };

    const minConfidence = this.config.get('MIN_CONFIDENCE_TO_ACCEPT', { infer: true });
    const models = [
      this.config.get('LLM_MODEL_PRIMARY', { infer: true }),
      this.config.get('LLM_MODEL_ESCALATION', { infer: true }),
    ];

    let lastFailure: Extract<ReminderResult, { ok: false }>['reason'] = 'no_tool_use';
    for (const [index, model] of models.entries()) {
      const escalation = index > 0;
      let response: MessagesCreateResult;
      try {
        // llm_calls (Fase 9/D-P2): escopo lexico — run() abarge a chamada.
        response = await this.llmCtx.run({ userId, purpose: 'reminder_extraction' }, () =>
          this.client.create(this.buildParams(model, texto)),
        );
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

      const parsed = extrairLembreteSchema.safeParse(normalizeLembreteToolUseInput(toolUse.input));
      if (!parsed.success) {
        this.logger.warn(`Resposta do LLM (${model}) falhou no safeParse: ${parsed.error.message}`);
        lastFailure = 'parse';
        continue; // escala para tentar de novo no modelo maior
      }
      if (parsed.data.confidence < minConfidence) {
        // Confiança baixa NÃO se resolve trocando de modelo: o bot RE-PERGUNTA (spec 4).
        return { ok: false, reason: 'low_confidence' };
      }
      return { ok: true, regras: parsed.data.regras, source: 'llm' };
    }
    return { ok: false, reason: lastFailure };
  }

  private buildParams(model: string, texto: string): MessagesCreateParams {
    return {
      model,
      max_tokens: MAX_TOKENS,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: [
        {
          name: extrairLembreteTool.name,
          description: extrairLembreteTool.description,
          input_schema: extrairLembreteTool.input_schema as MessageCreateTool['input_schema'],
        },
      ],
      tool_choice: { type: 'tool', name: extrairLembreteTool.name },
      messages: [{ role: 'user', content: `fala do usuario: """${texto}"""` }],
    };
  }
}

/* ------------------------------------------------------------------ */
/* Atalhos determinísticos (spec regra 4 / D3 do plano — rodam ANTES do LLM)  */
/* ------------------------------------------------------------------ */

function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.!?,;:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "não"/"sem lembrete"/"pode deixar sem" => none; atalho dos botões => regra. */
const NONE_RE =
  /^(nao|n|no|sem|sem lembrete|sem nada|nenhum( lembrete)?|nao quero( lembrete)?|nao precisa( de lembrete)?|deixa sem( lembrete)?|pode deixar sem( lembrete)?|nao precisa lembrar( me)?|nao me lembra( reme)?)$/;
/** "24h antes" é o atalho do botão (1 dia); "Nh antes" falado é horas mesmo. */
const EXACT_24H_RE = /^24\s*h(?:oras?|rs?)?( antes)?$/;
const BEFORE_HOURS_RE =
  /^(?:me lembra r?em |lembrete de |avisa r?em )?(\d{1,3})\s*h(?:oras?|rs?)?( antes)?$/;
const BEFORE_DAYS_RE =
  /^(?:me lembra r?em |lembrete de |avisa r?em )?(\d{1,3}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\s*dias?( antes)?$/;
const COUNTDOWN_RE = /^(3\s*[-.2]\s*2\s*[-.2]\s*1|321|contagem( regressiva)?|tres dois um)$/;
/** "amanhã"/"um dia antes" falados soltos (atalho do botão "24h antes" é literal). */
const TOMORROW_RE = /^(amanha( antes)?|um dia antes|1 dia antes)$/;

const WORD_NUMBERS: Record<string, number> = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
};

function toNumber(token: string): number | null {
  if (/^\d+$/.test(token)) return Number(token);
  return WORD_NUMBERS[token] ?? null;
}

/**
 * Resolve a fala do passo `lembrete` SEM LLM quando ela é um atalho inequívoco:
 * "não"/"sem lembrete" → none (spec 4, precedente das notas); "24h antes";
 * "N dias antes"; "Nh antes"; "3-2-1"; e composição determinística "X e Y" quando
 * X e Y são parseáveis individualmente (spec: vírgula/"+" ficam com o LLM).
 * `null` = fala livre → o caller chama o LLM.
 */
export function resolveReminderShortcut(text: string): NotificationRuleInput[] | null {
  const t = normalize(text);
  if (!t) return null;

  if (NONE_RE.test(t)) return [{ type: 'none' }];
  if (EXACT_24H_RE.test(t) || TOMORROW_RE.test(t)) return [{ type: 'before_days', value: 1 }];
  if (COUNTDOWN_RE.test(t)) return [{ type: 'countdown_3_2_1' }];

  const single = parseSingleRule(t);
  if (single) return [single];

  // composição "X e Y" / "X , Y" (a regra do plano permite X,Y parseáveis; vírgula
  // sozinha também — os dois lados têm de sair regra, senão é caso LLM)
  const parts = t
    .split(/\s+e\s+|\s*\+\s*|,\s*/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length >= 2 && parts.length <= 10) {
    const rules = parts.map(parseSingleRule);
    if (rules.every((r): r is NotificationRuleInput => r !== null)) {
      return dedupeRules(rules);
    }
  }
  return null;
}

/** Uma regra falada individualmente (sem conjunção); null = não é atalho. */
function parseSingleRule(t: string): NotificationRuleInput | null {
  if (NONE_RE.test(t)) return null; // none sozinho é tratado antes; nunca compõe
  if (EXACT_24H_RE.test(t)) return { type: 'before_days', value: 1 };
  const days = BEFORE_DAYS_RE.exec(t);
  if (days) {
    const value = toNumber(days[1]!);
    if (value && value > 0 && value <= 365) return { type: 'before_days', value };
    return null;
  }
  const hours = BEFORE_HOURS_RE.exec(t);
  if (hours) {
    const value = toNumber(hours[1]!);
    if (value && value > 0 && value <= 365) return { type: 'before_hours', value };
    return null;
  }
  if (COUNTDOWN_RE.test(t)) return { type: 'countdown_3_2_1' };
  if (TOMORROW_RE.test(t)) return { type: 'before_days', value: 1 };
  return null;
}

/** Dedupe preservando ordem (duplicata exata colapsa — mesma semântica do outbox). */
function dedupeRules(rules: NotificationRuleInput[]): NotificationRuleInput[] {
  const seen = new Set<string>();
  const out: NotificationRuleInput[] = [];
  for (const r of rules) {
    const key = `${r.type}:${r.value ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}
