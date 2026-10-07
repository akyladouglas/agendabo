import { isValidDate, utcToZonedParts, zonedTimeToUtc } from '@agendabo/schedule-core';

/**
 * A RÃ‰GUA da Fase 4 (spec llm-avancado regra 6 / D1 do plano) â€” domÃ­nio PURO do bot.
 * O LLM jÃ¡ passou pelo safeParse do zod na borda (modules/ai); aqui a rÃ©gua decide o
 * VEREDITO do candidato extraÃ­do: aceitar, mandar pra revisÃ£o, ou re-perguntar.
 * O modelo nunca confirma nada â€” datas viram instantes SÃ“ aqui, com o offset validado
 * contra o tz real da conta (ADR-002: inconsistÃªncia de offset = falha).
 *
 * A polÃ­tica de cada veredito Ã© do caller (especulaÃ§Ã£o deliberada da regra 6):
 *  - criar:  fraco/suspeito â‡’ needs_review; sem_quando/falhou â‡’ fluxo guiado;
 *  - editar: QUALQUER veredito nÃ£o-aceito â‡’ re-pergunta; NUNCA needs_review (regra 20).
 */

/** Payload bruto da tool `extrair_agendamento` (strip do zod jÃ¡ aplicado na borda). */
export interface ExtracaoPayloadBruto {
  title: string;
  startsAt: string;
  durationMinutes?: number;
  confidence: number;
  dateEvidence?: string;
}

/** Payload bruto da tool `interpretar_pedido_edicao` (sÃ³ o quando novo importa aqui). */
export interface EdicaoPayloadBruto {
  acao: 'editar' | 'cancelar';
  confidence: number;
  novoInicio?: string;
  novaDuracaoMin?: number;
  deslocamentoMin?: number;
  evidence?: string;
}

export interface ExtracaoInput {
  minConfidence: number;
  now: Date;
  /** Offset do tz do usuÃ¡rio (minutos leste de UTC) â€” medido na borda (ADR-002). */
  offsetMinutes: number;
}

/** Candidato materializado pela rÃ©gua (datas em instantes UTC â€” nada de calendÃ¡rio aqui). */
export interface ExtracaoCandidato {
  title: string;
  startUtc: Date;
  endUtc: Date;
  dateEvidence?: string;
}

export type ExtracaoVeredito =
  /** confianÃ§a â‰¥ limiar, datas vÃ¡lidas e futuras â‡’ segue confirmado (atalho do criar). */
  | { verdict: 'aceito'; candidate: ExtracaoCandidato }
  /**
   * quando utilizÃ¡vel, mas o "dia" ainda Ã© calendÃ¡rio (sem hora) â‡’ preenche o que tem e
   * o fluxo pergunta sÃ³ o que falta (decisÃ£o #5 da spec). `day` Ã© calendÃ¡rio local do
   * usuÃ¡rio derivado do instante que a BORDA resolveu (o modelo nÃ£o faz calendÃ¡rio).
   */
  | { verdict: 'quando_parcial'; title: string; day: { year: number; month: number; day: number } }
  /** confianÃ§a baixa COM tÃ­tulo+inÃ­cio â‡’ candidato plausÃ­vel: needs_review no criar. */
  | { verdict: 'fraco'; candidate: ExtracaoCandidato; reviewReason: string }
  /** aceito-no-passado: plausÃ­vel mas nunca em silÃªncio â‡’ needs_review "suspeito". */
  | { verdict: 'suspeito'; candidate: ExtracaoCandidato; reviewReason: string }
  /** falou de quando mas nada utilizÃ¡vel (ilegÃ­vel/sem offset) â‡’ re-pergunta. */
  | { verdict: 'sem_quando' }
  /** payload incoerente (tÃ­tulo vazio) â‡’ cai no guiado no ponto do dado faltante. */
  | { verdict: 'invalido'; reason: 'sem_titulo' };

export type EdicaoVeredito =
  /** horÃ¡rio novo utilizÃ¡vel (novoStartUtc resolvido) OU delta a aplicar (applyShift). */
  | { verdict: 'ok'; novoStartUtc?: Date; novaDuracaoMin?: number; deslocamentoMin?: number }
  /** re-pergunta o horÃ¡rio novo; NUNCA persiste nada (spec regra 20). */
  | {
      verdict: 'reperguntar';
      reason: 'sem_quando' | 'offset_inconsistente' | 'confianca_baixa' | 'data_no_passado';
    };

const ISO_OFFSET_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}(?:\.\d{1,3})?))?(Z|[+-]\d{2}:\d{2})$/;
const DEFAULT_DURATION_MIN = 60; // default da borda (documentado no contrato do schema)

/** Offset (minutos leste de UTC) embutido num ISO-8601; null = sem offset utilizÃ¡vel. */
function offsetOf(iso: string): number | null {
  const m = ISO_OFFSET_RE.exec(iso);
  if (!m) return null;
  const tz = m[7]!;
  if (tz === 'Z') return 0;
  const sign = tz[0] === '-' ? -1 : 1;
  const [, , oh, om] = /^([+-])(\d{2}):(\d{2})$/.exec(tz) ?? [];
  if (oh === undefined || om === undefined) return null;
  // oh/om sÃ£o SEMPRE positivos no ISO-8601 (-03:00 â‡’ oh "03"); o sinal vem do prefixo.
  return sign * (Number(oh) * 60 + Number(om));
}

/** Momento puro: materializa o ISO com offset em instante + valida o offset contra o tz da conta. */
function resolveInstante(
  iso: string,
  offsetMinutes: number,
): { startUtc: Date; offsetOk: boolean } | null {
  const embedded = offsetOf(iso);
  if (embedded === null) return null; // sem offset â‡’ a borda nÃ£o sabe o tz (spec regra 3)
  const startUtc = new Date(iso);
  if (!isValidDate(startUtc)) return null;
  return { startUtc, offsetOk: embedded === offsetMinutes };
}

/**
 * RÃ©gua do CRIAR (coraÃ§Ã£o da spec). O safeParse do zod jÃ¡ garante regex do startsAt;
 * aqui entra a segunda barreira: offset â†” tz da conta, validade do instante e futuro.
 */
export function classificarExtracao(
  payload: ExtracaoPayloadBruto,
  input: ExtracaoInput,
): ExtracaoVeredito {
  const title = payload.title.trim();
  if (!title) return { verdict: 'invalido', reason: 'sem_titulo' };

  const instant = resolveInstante(payload.startsAt, input.offsetMinutes);
  if (!instant) {
    // "quando" mencionado mas ilegÃ­vel/sem offset â‡’ hipÃ³tese nenhuma p/ persistir:
    // re-pergunta (a conversa estÃ¡ viva â€” divergÃªncia de llm.md #2 documentada no ADR-010).
    return { verdict: 'sem_quando' };
  }
  if (!instant.offsetOk) {
    // offset do modelo ??  tz real da conta: data resolvida n??o ?? confi??vel (spec regra 3).
    // Veredit??o na cara do usu??rio ??? needs_review com a evid??ncia, nunca confirmado.
    return {
      verdict: 'fraco',
      candidate: materialize(title, instant.startUtc, payload),
      reviewReason: 'parse_falho',
    };
  }

  const confident = payload.confidence >= input.minConfidence;
  const candidate = materialize(title, instant.startUtc, payload);

  if (!confident) return { verdict: 'fraco', candidate, reviewReason: 'confianca_baixa' };
  if (instant.startUtc.getTime() < input.now.getTime()) {
    // aceito-no-passado: pode ser registro legÃ­timo, mas nunca em silÃªncio (spec regra 6).
    return { verdict: 'suspeito', candidate, reviewReason: 'data_no_passado' };
  }
  return { verdict: 'aceito', candidate };
}

function materialize(
  title: string,
  startUtc: Date,
  payload: ExtracaoPayloadBruto,
): ExtracaoCandidato {
  const dur = payload.durationMinutes ?? DEFAULT_DURATION_MIN;
  return {
    title,
    startUtc,
    endUtc: new Date(startUtc.getTime() + dur * 60_000),
    ...(payload.dateEvidence ? { dateEvidence: payload.dateEvidence } : {}),
  };
}

/**
 * RÃ©gua do QUANDO do EDITAR (mesma rÃ©gua, polÃ­tica outra â€” spec regras 6/10/20):
 * tudo que nÃ£o for `ok` vira RE-PERGUNTA no fluxo; nada Ã© persistido.
 */
export function classificarEdicao(
  payload: EdicaoPayloadBruto,
  input: ExtracaoInput,
): EdicaoVeredito {
  const confident = payload.confidence >= input.minConfidence;

  if (payload.novoInicio) {
    const instant = resolveInstante(payload.novoInicio, input.offsetMinutes);
    if (!instant) return { verdict: 'reperguntar', reason: 'offset_inconsistente' };
    if (!instant.offsetOk) return { verdict: 'reperguntar', reason: 'offset_inconsistente' };
    if (!confident) return { verdict: 'reperguntar', reason: 'confianca_baixa' };
    if (instant.startUtc.getTime() < input.now.getTime()) {
      return { verdict: 'reperguntar', reason: 'data_no_passado' };
    }
    return {
      verdict: 'ok',
      novoStartUtc: instant.startUtc,
      ...(payload.novaDuracaoMin ? { novaDuracaoMin: payload.novaDuracaoMin } : {}),
    };
  }
  if (payload.deslocamentoMin !== undefined) {
    // delta Ã© aritmÃ©tica determinÃ­stica (applyShift na candidata) â€” a confianÃ§a do
    // interpretador cobre a leitura ("adianta" vs "atrasa"), nÃ£o o cÃ¡lculo.
    if (!confident) return { verdict: 'reperguntar', reason: 'confianca_baixa' };
    return {
      verdict: 'ok',
      deslocamentoMin: payload.deslocamentoMin,
      ...(payload.novaDuracaoMin ? { novaDuracaoMin: payload.novaDuracaoMin } : {}),
    };
  }
  // sem horÃ¡rio novo na fala: quem chama decide (mover tÃ­tulo/notas nÃ£o precisa de
  // horÃ¡rio â€” o service trata antes; "muda pra sexta" sem hora chega aqui).
  return { verdict: 'reperguntar', reason: 'sem_quando' };
}

/**
 * "quando parcial" do criar: a BORDA (service) resolve o dia-only ("quinta") no calendario
 * do usuario e chama com o INSTANTE local daquele dia (ADR-002: calendario e da borda,
 * a régua e pura). A regua so deriva o dia no calendario local do usuario, para o fluxo
 * perguntar so a hora. Invalido = null (cai no guiado do zero).
 */
export function dayFromResolvedUtc(
  resolvedLocalInstant: Date,
  offsetMinutes: number,
): { year: number; month: number; day: number } | null {
  if (!isValidDate(resolvedLocalInstant)) return null;
  const { year, month, day } = utcToZonedParts(resolvedLocalInstant, offsetMinutes);
  return { year, month, day };
}

/** Conveniencia p/ testes: dia local a partir de partes (roundtrip do ADR-002). */
export function localDayToUtc(
  day: { year: number; month: number; day: number },
  offsetMinutes: number,
): Date {
  return zonedTimeToUtc({ ...day }, offsetMinutes);
}
