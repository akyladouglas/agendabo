import {
  isValidDate,
  utcToZonedParts,
  zonedTimeToUtc,
} from "@agendabo/schedule-core";

/**
 * A RÉGUA da Fase 4 (spec llm-avancado regra 6 / D1 do plano) — domínio PURO do bot.
 * O LLM já passou pelo safeParse do zod na borda (modules/ai); aqui a régua decide o
 * VEREDITO do candidato extraído: aceitar, mandar pra revisão, ou re-perguntar.
 * O modelo nunca confirma nada — datas viram instantes SÓ aqui, com o offset validado
 * contra o tz real da conta (ADR-002: inconsistência de offset = falha).
 *
 * A política de cada veredito é do caller (especulação deliberada da regra 6):
 *  - criar:  fraco/suspeito ⇒ needs_review; sem_quando/falhou ⇒ fluxo guiado;
 *  - editar: QUALQUER veredito não-aceito ⇒ re-pergunta; NUNCA needs_review (regra 20).
 */

/** Payload bruto da tool `extrair_agendamento` (strip do zod já aplicado na borda). */
export interface ExtracaoPayloadBruto {
  title: string;
  startsAt: string;
  /** Fim dito pelo usuario ("ate 17h segunda") — a régua NUNCA calcula, só valida/materializa. */
  endsAt?: string;
  durationMinutes?: number;
  confidence: number;
  dateEvidence?: string;
}

/** Payload bruto da tool `interpretar_pedido_edicao` (só o quando novo importa aqui). */
export interface EdicaoPayloadBruto {
  acao: "editar" | "cancelar";
  confidence: number;
  novoInicio?: string;
  novaDuracaoMin?: number;
  deslocamentoMin?: number;
  evidence?: string;
}

export interface ExtracaoInput {
  minConfidence: number;
  now: Date;
  /** Offset do tz do usuário (minutos leste de UTC) — medido na borda (ADR-002). */
  offsetMinutes: number;
}

/** Candidato materializado pela régua (datas em instantes UTC — nada de calendário aqui). */
export interface ExtracaoCandidato {
  title: string;
  startUtc: Date;
  endUtc: Date;
  dateEvidence?: string;
}

export type ExtracaoVeredito =
  /** confiança ≥ limiar, datas válidas e futuras ⇒ segue confirmado (atalho do criar). */
  | { verdict: "aceito"; candidate: ExtracaoCandidato }
  /**
   * quando utilizável, mas o "dia" ainda é calendário (sem hora) ⇒ preenche o que tem e
   * o fluxo pergunta só o que falta (decisão #5 da spec). `day` é calendário local do
   * usuário derivado do instante que a BORDA resolveu (o modelo não faz calendário).
   */
  | {
      verdict: "quando_parcial";
      title: string;
      day: { year: number; month: number; day: number };
    }
  /** confiança baixa COM título+início ⇒ candidato plausível: needs_review no criar. */
  | { verdict: "fraco"; candidate: ExtracaoCandidato; reviewReason: string }
  /** aceito-no-passado: plausível mas nunca em silêncio ⇒ needs_review "suspeito". */
  | { verdict: "suspeito"; candidate: ExtracaoCandidato; reviewReason: string }
  /** falou de quando mas nada utilizável (ilegível/sem offset) ⇒ re-pergunta. */
  | { verdict: "sem_quando" }
  /**
   * início utilizável, fim dito é ilegível/≤ início ⇒ re-pergunta o fim no ponto
   * faltante, NUNCA needs_review — regra A2 da spec fluxo-criacao-robusto (ADR-010:
   * fim ilegitimo na criação é re-pergunta, nunca hipótese persistida). O candidate
   * carrega o início bom (sem endUtc) para o fluxo reaproveitar (C1).
   */
  | {
      verdict: "fim_invalido";
      candidate: { title: string; startUtc: Date; dateEvidence?: string };
    }
  /** payload incoerente (título vazio) ⇒ cai no guiado no ponto do dado faltante. */
  | { verdict: "invalido"; reason: "sem_titulo" };

export type EdicaoVeredito =
  /** horário novo utilizável (novoStartUtc resolvido) OU delta a aplicar (applyShift). */
  | {
      verdict: "ok";
      novoStartUtc?: Date;
      novaDuracaoMin?: number;
      deslocamentoMin?: number;
    }
  /** re-pergunta o horário novo; NUNCA persiste nada (spec regra 20). */
  | {
      verdict: "reperguntar";
      reason:
        | "sem_quando"
        | "offset_inconsistente"
        | "confianca_baixa"
        | "data_no_passado";
    };

const ISO_OFFSET_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}(?:\.\d{1,3})?))?(Z|[+-]\d{2}:\d{2})$/;
const DEFAULT_DURATION_MIN = 60; // default da borda (documentado no contrato do schema)

/** Offset (minutos leste de UTC) embutido num ISO-8601; null = sem offset utilizável. */
function offsetOf(iso: string): number | null {
  const m = ISO_OFFSET_RE.exec(iso);
  if (!m) return null;
  const tz = m[7]!;
  if (tz === "Z") return 0;
  const sign = tz[0] === "-" ? -1 : 1;
  const [, , oh, om] = /^([+-])(\d{2}):(\d{2})$/.exec(tz) ?? [];
  if (oh === undefined || om === undefined) return null;
  // oh/om são SEMPRE positivos no ISO-8601 (-03:00 ⇒ oh "03"); o sinal vem do prefixo.
  return sign * (Number(oh) * 60 + Number(om));
}

/** Momento puro: materializa o ISO com offset em instante + valida o offset contra o tz da conta. */
function resolveInstante(
  iso: string,
  offsetMinutes: number,
): { startUtc: Date; offsetOk: boolean } | null {
  const embedded = offsetOf(iso);
  if (embedded === null) return null; // sem offset ⇒ a borda não sabe o tz (spec regra 3)
  const startUtc = new Date(iso);
  if (!isValidDate(startUtc)) return null;
  return { startUtc, offsetOk: embedded === offsetMinutes };
}

/**
 * Régua do CRIAR (coração da spec). O safeParse do zod já garante regex do startsAt;
 * aqui entra a segunda barreira: offset ↔ tz da conta, validade do instante e futuro.
 *
 * Precedência com `endsAt` (spec fluxo-criacao-robusto A2/A3 — ordem dos gates):
 *   titulo → resolveInstante(startsAt) [sem_quando] → offsetOk(startsAt) [fraco
 *   parse_falho] → resolveInstante(endsAt) [fraco parse_falho] → confident [fraco]
 *   → startUtc futuro [suspeito] → endsAt ilegível ou ≤ início [fim_invalido] → aceito.
 * (Nota: endsAt ilegível só chega depois do início ok; endsAt com offset divergente
 * é fraco mesmo com confiança alta.)
 */
export function classificarExtracao(
  payload: ExtracaoPayloadBruto,
  input: ExtracaoInput,
): ExtracaoVeredito {
  const title = payload.title.trim();
  if (!title) return { verdict: "invalido", reason: "sem_titulo" };

  const instant = resolveInstante(payload.startsAt, input.offsetMinutes);
  if (!instant) {
    // "quando" mencionado mas ilegível/sem offset ⇒ hipótese nenhuma p/ persistir:
    // re-pergunta (a conversa está viva — divergência de llm.md #2 documentada no ADR-010).
    return { verdict: "sem_quando" };
  }
  if (!instant.offsetOk) {
    // offset do modelo ≠  tz real da conta: data resolvida não é confiável (spec regra 3).
    // Veredito na cara do usuário → needs_review com a evidência, nunca confirmado.
    return {
      verdict: "fraco",
      candidate: materialize(
        title,
        instant.startUtc,
        payload,
        input.offsetMinutes,
      ),
      reviewReason: "parse_falho",
    };
  }

  // endsAt com offset divergente do tz da conta: mesma regra do startsAt (spec A2) —
  // fraco/parse_falho mesmo com confiança alta, candidate materializado COM o endUtc.
  if (payload.endsAt !== undefined) {
    const endInstant = resolveInstante(payload.endsAt, input.offsetMinutes);
    if (endInstant && !endInstant.offsetOk) {
      return {
        verdict: "fraco",
        candidate: materialize(
          title,
          instant.startUtc,
          payload,
          input.offsetMinutes,
        ),
        reviewReason: "parse_falho",
      };
    }
  }

  const confident = payload.confidence >= input.minConfidence;
  const candidate = materialize(
    title,
    instant.startUtc,
    payload,
    input.offsetMinutes,
  );

  if (!confident)
    return { verdict: "fraco", candidate, reviewReason: "confianca_baixa" };
  if (instant.startUtc.getTime() < input.now.getTime()) {
    // aceito-no-passado: pode ser registro legítimo, mas nunca em silêncio (spec regra 6).
    return { verdict: "suspeito", candidate, reviewReason: "data_no_passado" };
  }

  // fim dito pelo usuário (A2): ilegível/sem offset OU ≤ início ⇒ re-pergunta o fim no
  // ponto faltante com o início preservado — NUNCA needs_review por isso (ADR-010).
  // Multi-dia é natural: nenhum cap de duração p/ endsAt explícito (A2).
  if (payload.endsAt !== undefined) {
    const endInstant = resolveInstante(payload.endsAt, input.offsetMinutes);
    if (
      !endInstant ||
      endInstant.startUtc.getTime() <= instant.startUtc.getTime()
    ) {
      return {
        verdict: "fim_invalido",
        candidate: {
          title,
          startUtc: instant.startUtc,
          ...(payload.dateEvidence
            ? { dateEvidence: payload.dateEvidence }
            : {}),
        },
      };
    }
  }
  return { verdict: "aceito", candidate };
}

function materialize(
  title: string,
  startUtc: Date,
  payload: ExtracaoPayloadBruto,
  offsetMinutes: number,
): ExtracaoCandidato {
  // Precedência do fim (spec fluxo-criacao-robusto A3): endsAt materializável
  // (instante válido, independente do offset bater) > durationMinutes > default 60.
  // endsAt válido + durationMinutes inconsistente ⇒ a duração é ignorada (o fim dito
  // pelo usuário é a verdade). endsAt ilegível/sem offset materializa pelo fallback
  // (a régua decide o veredito em outro gate; aqui só instantiza o intervalo).
  const endInstant =
    payload.endsAt !== undefined
      ? resolveInstante(payload.endsAt, offsetMinutes)
      : null;
  const endUtc = endInstant
    ? endInstant.startUtc
    : new Date(
        startUtc.getTime() +
          (payload.durationMinutes ?? DEFAULT_DURATION_MIN) * 60_000,
      );
  return {
    title,
    startUtc,
    endUtc,
    ...(payload.dateEvidence ? { dateEvidence: payload.dateEvidence } : {}),
  };
}

/**
 * Régua do QUANDO do EDITAR (mesma régua, política outra — spec regras 6/10/20):
 * tudo que não for `ok` vira RE-PERGUNTA no fluxo; nada é persistido.
 */
export function classificarEdicao(
  payload: EdicaoPayloadBruto,
  input: ExtracaoInput,
): EdicaoVeredito {
  const confident = payload.confidence >= input.minConfidence;

  if (payload.novoInicio) {
    const instant = resolveInstante(payload.novoInicio, input.offsetMinutes);
    if (!instant)
      return { verdict: "reperguntar", reason: "offset_inconsistente" };
    if (!instant.offsetOk)
      return { verdict: "reperguntar", reason: "offset_inconsistente" };
    if (!confident)
      return { verdict: "reperguntar", reason: "confianca_baixa" };
    if (instant.startUtc.getTime() < input.now.getTime()) {
      return { verdict: "reperguntar", reason: "data_no_passado" };
    }
    return {
      verdict: "ok",
      novoStartUtc: instant.startUtc,
      ...(payload.novaDuracaoMin
        ? { novaDuracaoMin: payload.novaDuracaoMin }
        : {}),
    };
  }
  if (payload.deslocamentoMin !== undefined) {
    // delta é aritmética determinística (applyShift na candidata) — a confiança do
    // interpretador cobre a leitura ("adianta" vs "atrasa"), não o cálculo.
    if (!confident)
      return { verdict: "reperguntar", reason: "confianca_baixa" };
    return {
      verdict: "ok",
      deslocamentoMin: payload.deslocamentoMin,
      ...(payload.novaDuracaoMin
        ? { novaDuracaoMin: payload.novaDuracaoMin }
        : {}),
    };
  }
  // sem horário novo na fala: quem chama decide (mover título/notas não precisa de
  // horário — o service trata antes; "muda pra sexta" sem hora chega aqui).
  return { verdict: "reperguntar", reason: "sem_quando" };
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
  const { year, month, day } = utcToZonedParts(
    resolvedLocalInstant,
    offsetMinutes,
  );
  return { year, month, day };
}

/** Conveniencia p/ testes: dia local a partir de partes (roundtrip do ADR-002). */
export function localDayToUtc(
  day: { year: number; month: number; day: number },
  offsetMinutes: number,
): Date {
  return zonedTimeToUtc({ ...day }, offsetMinutes);
}
