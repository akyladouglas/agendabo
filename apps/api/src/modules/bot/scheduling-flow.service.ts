import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  applyShift,
  findMatchingAppointments,
  isValidDate,
  zonedTimeToUtc,
  type AppointmentLike,
} from '@agendabo/schedule-core';
import { z } from 'zod';
import {
  AppointmentConflictError,
  AppointmentsService,
} from '../appointments/appointments.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { TelegramClientService } from '../../shared/telegram/telegram-client.service';
import type { Env } from '../../config/env.validation';
import { BotAccessService, type BotUser } from './bot-access.service';
import { BOT_MESSAGES, escapeHtml, givesUpQuery, parseYesNo } from './messages';
import { IntentClassifierService, type IntentFlowContext } from '../ai/intent-classifier.service';
import {
  ReminderInterpreterService,
  resolveReminderShortcut,
} from '../ai/reminder-interpreter.service';
import { SchedulingInterpreterService } from '../ai/scheduling-interpreter.service';
import { AppointmentEditInterpreterService } from '../ai/appointment-edit-interpreter.service';
import {
  AgendaQueryService,
  AGENDA_QUERY_MAX_PERIOD_PROMPTS,
  type AgendaQueryResult,
} from './agenda-query.service';
import { resolveIntervaloRange, resolveSimboloRange, type SimboloConsulta } from './agenda-query';
import {
  SchedulingFlowMachine,
  type BotReply,
  type EditCandidateLike,
  type ExtractedClassified,
  type FlowSession,
  type HandleTurnInput,
  type ReminderClassified,
} from './scheduling-flow.machine';
import {
  classificarEdicao,
  classificarExtracao,
  dayFromResolvedUtc,
  type EdicaoPayloadBruto,
  type ExtracaoPayloadBruto,
} from './extraction-ruler';

/** Borda zod dos callbacks de teclado (callback_data nao e confiavel por natureza). */
const dayChoiceSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
});
const hourPickSchema = z.string().regex(/^([01]\d|2[0-3]):00$/);

/** Offset fixo do tz do usuario (minutos leste de UTC) — tz na borda (ADR-002). */
export function tzOffsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/**
 * Servico do fluxo de agendamento do bot (Fase 1). DONO do estado por chat (Map +
 * TTL, llm.md #5) e das bordas: LLM (classificacao de intencao), Telegram (envio/
 * teclado) e banco (create via AppointmentsService — D7 do plano). A regra em si
 * mora em SchedulingFlowMachine (dominio puro); o handler e fino.
 */
@Injectable()
export class SchedulingFlowService {
  private readonly logger = new Logger(SchedulingFlowService.name);
  private readonly sessions = new Map<string, FlowSession>();
  /** Turnos de abertura de edição: a próxima fala é DADO do passo (não re-classificar). */
  private readonly consumedTurns = new Map<string, boolean>();
  /**
   * Estado do turno de consulta (Fase 2): `true` = a última mensagem do bot foi a
   * pergunta de período; `count` = quantas vezes perguntamos (máx 2 — spec #14).
   * TTL: a mesma janela de `BOT_SESSION_TTL_MINUTES` do fluxo (llm.md #5).
   */
  private readonly pendingQueries = new Map<
    string,
    { awaitingPeriod: boolean; count: number; lastActivityAt: number }
  >();
  private readonly machine: SchedulingFlowMachine;
  private readonly ttlMs: number;
  private readonly minConfidence: number;

  constructor(
    private readonly access: BotAccessService,
    private readonly classifier: IntentClassifierService,
    private readonly appointments: AppointmentsService,
    private readonly telegram: TelegramClientService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly agendaQuery: AgendaQueryService,
    private readonly reminderInterpreter: ReminderInterpreterService,
    private readonly schedulingInterpreter: SchedulingInterpreterService,
    private readonly editInterpreter: AppointmentEditInterpreterService,
  ) {
    this.ttlMs = this.config.get('BOT_SESSION_TTL_MINUTES', { infer: true }) * 60_000; // decisao D2 do plano (30 min)
    this.minConfidence = this.config.get('MIN_CONFIDENCE_TO_ACCEPT', { infer: true });
    this.machine = new SchedulingFlowMachine(this.ttlMs, this.minConfidence);
  }

  /** Regra 1 da spec: gate de conta ANTES de qualquer fluxo; tentativa logada. */
  async handleText(telegramId: string, text: string): Promise<void> {
    let user: BotUser;
    try {
      user = await this.access.requireConfirmedUser(telegramId);
    } catch (err) {
      if (err instanceof ForbiddenException) {
        this.logger.log(
          `bot: telegramId ${telegramId} sem cadastro — orientacao de cadastro enviada`,
        );
        await this.telegram.sendMessage(telegramId, BOT_MESSAGES.cadastroNecessario);
        return;
      }
      throw err;
    }
    await this.turn(user, { text });
  }

  /** Botao de dia do teclado guiado (passo deterministico, sem LLM). */
  async handleDayPick(telegramId: string, raw: unknown): Promise<void> {
    const day = dayChoiceSchema.parse(raw);
    let user: BotUser;
    try {
      user = await this.access.requireConfirmedUser(telegramId);
    } catch (err) {
      if (err instanceof ForbiddenException) {
        await this.telegram.sendMessage(telegramId, BOT_MESSAGES.cadastroNecessario);
        return;
      }
      throw err;
    }
    await this.turn(user, { dayChoice: day, text: '' });
  }

  /** Teclado de horas cheias (passo deterministico, sem LLM). */
  async handleTimePick(telegramId: string, raw: string): Promise<void> {
    const time = hourPickSchema.parse(raw);
    let user: BotUser;
    try {
      user = await this.access.requireConfirmedUser(telegramId);
    } catch (err) {
      if (err instanceof ForbiddenException) {
        await this.telegram.sendMessage(telegramId, BOT_MESSAGES.cadastroNecessario);
        return;
      }
      throw err;
    }
    await this.turn(user, { timeChoice: time, text: time });
  }

  /** Abre o fluxo de agendamento no guiado clássico (pergunta o título primeiro). */
  private openFlow(user: BotUser, now: Date): void {
    const fresh = this.machine.newSession(now);
    this.sessions.set(user.telegramId, fresh);
    void this.send(user.telegramId, this.machine.startReplies(user.name));
  }

  /** Relógio da borda (testes substituem este método p/ determinismo). */
  private now(): Date {
    return new Date();
  }

  /** Um turno: estado -> bordas (LLM/banco) -> maquina -> respostas/persistencia. */
  async turn(
    user: BotUser,
    partial: { text?: string; dayChoice?: HandleTurnInput['dayChoice']; timeChoice?: string },
  ): Promise<void> {
    const now = this.now();
    const offsetMinutes = tzOffsetMinutes(user.timezone, now);
    const existing = await this.existingConfirmedFuture(user.id, now);

    let session = this.sessions.get(user.telegramId);
    if (session && this.machine.isExpired(session, now)) {
      this.logger.log(
        `bot: sessao de ${user.telegramId} expirou (TTL ${this.ttlMs}ms) — descartada`,
      );
      this.sessions.delete(user.telegramId);
      session = undefined;
    }

    // Fora do fluxo: LLM classifica a intencao do turno (ADR-008) e o roteia.
    if (!session) {
      if (partial.dayChoice || partial.timeChoice) {
        await this.telegram.sendMessage(user.telegramId, BOT_MESSAGES.fallback);
        return;
      }
      await this.offFlowTurn(user, partial.text ?? '', now);
      return;
    }

    const conflictPending = session.step === 'conflito';
    const context: IntentFlowContext = { inFlow: true, step: session.step, conflictPending };
    // Passo deterministico (teclado) nao precisa do LLM; o que o usuario FALA sim.
    const deterministic = Boolean(partial.dayChoice || partial.timeChoice);
    // Passo `lembrete` (Fase 3): a fala é DADO do passo — o interpretador de lembrete
    // é a ÚNICA chamada de LLM deste turno (a classificação de intenção é substituída
    // por ele; desistência "deixa pra lá" continua determinística na máquina).
    const reminder =
      !deterministic && session.step === 'lembrete'
        ? await this.interpretReminder(partial.text ?? '')
        : undefined;
    // Portão do atalho (Fase 4): a 1ª fala solta do criar é extração livre + régua
    // (spec regra 8). O portão é a máquina: `criar_aberto` OU `titulo` intocado (só
    // quando a fala chegou vazia de processamento — teclado/nada vira texto do passo).
    const openCreate =
      !deterministic &&
      Boolean(partial.text && partial.text.trim()) &&
      (session.step === 'criar_aberto' || (session.step === 'titulo' && !session.candidate.title));
    // Fala livre em criar_aberto/titulo (Fase 4): extração livre + régua (regra 8).
    const extracted = openCreate
      ? await this.runExtraction(partial.text ?? '', user, offsetMinutes, now)
      : undefined;
    // Fala livre nos passos de edição QUANDO o passo espera re-interpretação:
    // localização pendente (sem alvo) ou mudança de horário em `edit_propor`
    // (1 chamada LLM/turno). `edit_descricao` COM alvo é a confirmação de cancelar
    // (DADO); `escolher_candidata` é escolha numérica (DADO).
    const editStep = session.step === 'edit_descricao' || session.step === 'edit_propor';
    const hasTarget = Boolean(session.candidate.edit?.appointmentId);
    const editFree =
      !deterministic &&
      editStep &&
      (session.step === 'edit_propor' ||
        // alvo achado em edit_descricao: a fala é a MUDANÇA (modo change), não re-localização
        (session.step === 'edit_descricao' && hasTarget && session.editMode !== 'cancel') ||
        (!hasTarget && (session.candidate.edit?.candidates?.length ?? 0) === 0)) &&
      Boolean(partial.text && partial.text.trim()) &&
      !reminder &&
      !extracted;
    const editMode: 'target' | 'change' = hasTarget ? 'change' : 'target';
    const editVerdict = editFree
      ? await this.runEditInterpret(
          partial.text ?? '',
          session,
          existing,
          user,
          offsetMinutes,
          now,
          editMode,
        )
      : undefined;
    const justOpenedEdit = this.consumedTurns.get(user.telegramId) === true;
    this.consumedTurns.delete(user.telegramId);
    const classified =
      reminder || deterministic || extracted || editVerdict || justOpenedEdit
        ? undefined
        : await this.classifier.classify(partial.text ?? '', context);

    // Consulta de agenda com o fluxo de criar ABERTO (Fase 2, decisão #5): responde
    // a consulta e volta ao mesmo passo — o estado do candidato fica intacto e o
    // passo é re-perguntado ao final. Desistência/cancelar continuam com prioridade.
    if (!deterministic && classified?.ok && classified.intent === 'consultar') {
      const result = await this.runAgendaQuery(
        user,
        partial.text ?? '',
        offsetMinutes,
        now,
        session.step,
      );
      await this.telegram.sendMessage(user.telegramId, result.replies[0] ?? '');
      // volta à pergunta do passo atual, sem reclassificar (1 chamada LLM/turno).
      if (session.step === 'criar_aberto') {
        await this.replayCreateGate(
          user,
          session,
          partial.text ?? '',
          existing,
          offsetMinutes,
          now,
        );
      } else {
        await this.replayCurrentStep(user, session, offsetMinutes, now);
      }
      return;
    }

    const outcome = await this.machine.handleTurn({
      session,
      user,
      text: partial.text ?? '',
      classified,
      reminder,
      extracted,
      editLocation: editVerdict?.location,
      editPicked: editVerdict?.picked,
      editChange: editVerdict?.change,
      existing,
      offsetMinutes,
      now,
      dayChoice: partial.dayChoice,
      timeChoice: partial.timeChoice,
    });

    if (outcome.done) this.sessions.delete(user.telegramId);
    await this.send(user.telegramId, outcome.replies);

    if (outcome.create) {
      await this.persist(user, outcome.create);
    }
    // ações de escrita pedidas pela máquina (Fase 4: needs_review / editar / cancelar)
    if (outcome.needsReview) await this.persistNeedsReview(user, session, outcome.needsReview);
    if (outcome.update) await this.applyUpdate(user, outcome.update);
    if (outcome.cancelAppointment) {
      await this.applyCancelAppointment(user, outcome.cancelAppointment.appointmentId);
    }
  }

  /**
   * Borda do passo `lembrete` (spec regra 4): o atalho determinístico roda ANTES do
   * LLM (D3 do plano — "não"/"24h antes"/"3-2-1" não gastam LLM); fala livre vai ao
   * interpretador. A máquina só consome o veredito (padrão do `classified`).
   */
  private async interpretReminder(text: string): Promise<ReminderClassified> {
    const shortcut = resolveReminderShortcut(text);
    if (shortcut) return { ok: true, regras: shortcut };
    const result = await this.reminderInterpreter.interpretar(text);
    if (result.ok) return { ok: true, regras: result.regras };
    return { ok: false, reason: result.reason };
  }

  /** Data de hoje no tz do usuário — bloco volátil do prompt (llm.md #4). */
  private todayLocal(user: BotUser, now: Date): string {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: user.timezone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(now);
  }

  /**
   * Borda do atalho do CRIAR (Fase 4, spec regra 5/6): extrator LLM → RÉGUA pura →
   * veredito que a máquina consome. O modelo não faz calendário: um ISO sem hora com o
   * offset da conta é "dia entendido, hora faltando" (quando_parcial) — a régua só
   * deriva o dia do instante que a borda materializou (ADR-002).
   */
  private async runExtraction(
    text: string,
    user: BotUser,
    offsetMinutes: number,
    now: Date,
  ): Promise<ExtractedClassified> {
    const result = await this.schedulingInterpreter.interpretar(text, {
      todayLocal: this.todayLocal(user, now),
    });
    if (!result.ok) {
      return { kind: 'falhou', reason: result.reason, titleHint: text.trim().slice(0, 200) };
    }
    const data = result.data;
    const dayOnly = /^\d{4}-\d{2}-\d{2}T09:00(?::00(?:\.000)?)?(Z|[+-]\d{2}:\d{2})$/.test(
      data.startsAt,
    );
    if (dayOnly) {
      // hora 09:00 é o marcador do prompt ("não disse a hora"); o CALENDÁRIO do ISO é o
      // dia local do usuário (ADR-002) — materializamos no offset real da conta e a
      // régua deriva o dia de volta. Offset do ISO ≠ tz da conta ⇒ sem confiança no
      // calendário: cai na régua cheia e vira needs_review "parse_falho".
      const m = /^(\d{4})-(\d{2})-(\d{2})T09:00(?::00(?:\.000)?)?(Z|[+-]\d{2}:\d{2})$/.exec(
        data.startsAt,
      );
      const embedded = m ? this.offsetOfIso(m[7]!) : null;
      if (m && embedded === offsetMinutes) {
        const inst = zonedTimeToUtc(
          { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) },
          offsetMinutes,
        );
        const day = dayFromResolvedUtc(inst, offsetMinutes);
        if (day) {
          this.logger.log(`bot: extracao quando_parcial (dia ${day.day}) p/ ${user.id}`);
          return { kind: 'quando_parcial', data: { title: data.title, day } };
        }
      }
    }
    const payload: ExtracaoPayloadBruto = {
      title: data.title,
      startsAt: data.startsAt,
      ...(data.durationMinutes !== undefined ? { durationMinutes: data.durationMinutes } : {}),
      confidence: data.confidence,
      ...(data.dateEvidence ? { dateEvidence: data.dateEvidence } : {}),
    };
    const v = classificarExtracao(payload, {
      minConfidence: this.minConfidence,
      now,
      offsetMinutes,
    });
    this.logger.log(
      `bot: extracao ${v.verdict} p/ ${user.id} (conf ${data.confidence}, modelo ok)`,
    );
    switch (v.verdict) {
      case 'aceito':
        return {
          kind: 'aceito',
          data: {
            title: v.candidate.title,
            startUtc: v.candidate.startUtc,
            endUtc: v.candidate.endUtc,
            ...(v.candidate.dateEvidence ? { dateEvidence: v.candidate.dateEvidence } : {}),
          },
        };
      case 'fraco':
      case 'suspeito':
        return {
          kind: v.verdict,
          data: {
            title: v.candidate.title,
            startUtc: v.candidate.startUtc,
            endUtc: v.candidate.endUtc,
            ...(v.candidate.dateEvidence ? { dateEvidence: v.candidate.dateEvidence } : {}),
          },
          reviewReason: v.reviewReason,
          rawText: result.rawText,
        };
      case 'sem_quando':
      case 'invalido':
        return { kind: 'sem_quando' };
      case 'quando_parcial': {
        // o modelo marcou 09:00 mas o offset era da conta e o materializou a cima;
        // este ramo só pega ISO dia-cheio que a régua derivou (impossível hoje — mantém
        // a tipologia total): converte o dia direto.
        return { kind: 'quando_parcial', data: { title: v.title, day: v.day } };
      }
    }
  }

  /** Offset (minutos) embutido num sufixo ISO ("Z" | "+HH:MM" | "-HH:MM"); null = ilegível. */
  private offsetOfIso(tz: string): number | null {
    if (tz === 'Z') return 0;
    const m = /^([+-])(\d{2}):(\d{2})$/.exec(tz);
    if (!m) return null;
    const sign = m[1] === '-' ? -1 : 1;
    return sign * (Number(m[2]) * 60 + Number(m[3]));
  }

  /**
   * Borda dos passos de edição (Fase 4, spec regras 10/11): interpretador edit →
   * localização 100% determinística (`findMatchingAppointments` + símbolos do
   * schedule-core) → régua do quando + `applyShift`. O LLM NUNCA escolhe o compromisso
   * nem calcula data final (ADR-003). `mode` vem da SESSÃO (máquina decidiu o passo):
   * `target` = procurar o compromisso; `change` = a fala é a mudança na candidata.
   */
  private async runEditInterpret(
    text: string,
    session: FlowSession,
    existing: AppointmentLike[],
    user: BotUser,
    offsetMinutes: number,
    now: Date,
    mode: 'target' | 'change',
  ): Promise<{
    location?: NonNullable<HandleTurnInput['editLocation']>;
    picked?: EditCandidateLike;
    change?: NonNullable<HandleTurnInput['editChange']>;
  }> {
    const result = await this.editInterpreter.interpretar(text, {
      todayLocal: this.todayLocal(user, now),
    });
    const edit = session.candidate.edit;
    if (!result.ok) {
      // editar NUNCA vira needs_review (spec regra 20): re-pergunta.
      this.logger.log(`bot: interpretacao de edicao falhou (${result.reason}) p/ ${user.id}`);
      return mode === 'change'
        ? { change: { kind: 'reperguntar', reason: result.reason } }
        : { location: { kind: 'ask_descricao' } };
    }
    const data = result.data;

    // ---- mudança de horário na candidata já achada (esperada: mode change) ----
    if (mode === 'change' && edit?.appointmentId && edit.fromStartUtc && edit.fromEndUtc) {
      const payload: EdicaoPayloadBruto = {
        acao: data.acao,
        confidence: data.confidence,
        ...(data.novoInicio ? { novoInicio: data.novoInicio } : {}),
        ...(data.novaDuracaoMin !== undefined ? { novaDuracaoMin: data.novaDuracaoMin } : {}),
        ...(data.deslocamentoMin !== undefined ? { deslocamentoMin: data.deslocamentoMin } : {}),
        ...(data.evidence ? { evidence: data.evidence } : {}),
      };
      const v = classificarEdicao(payload, {
        minConfidence: this.minConfidence,
        now,
        offsetMinutes,
      });
      if (v.verdict === 'reperguntar') {
        return { change: { kind: 'reperguntar', reason: v.reason } };
      }
      let toStart = edit.fromStartUtc;
      let toEnd = edit.fromEndUtc;
      if (v.deslocamentoMin !== undefined) {
        const shifted = applyShift(toStart, toEnd, v.deslocamentoMin);
        toStart = shifted.startsAt;
        toEnd = shifted.endsAt;
      }
      if (v.novoStartUtc) {
        const durMs =
          v.novaDuracaoMin !== undefined
            ? v.novaDuracaoMin * 60_000
            : toEnd.getTime() - toStart.getTime();
        toStart = v.novoStartUtc;
        toEnd = new Date(v.novoStartUtc.getTime() + durMs);
      } else if (v.novaDuracaoMin !== undefined) {
        toEnd = new Date(toStart.getTime() + v.novaDuracaoMin * 60_000);
      }
      return {
        change: {
          kind: 'ok',
          toStartUtc: toStart,
          toEndUtc: toEnd,
          ...(data.descricao?.trim() ? { toTitle: data.descricao.trim() } : {}),
        },
      };
    }

    // ---- localização do alvo (100% determinística — spec regra 11) ----
    const rawRange = this.resolveAlvoRange(data.alvoData, offsetMinutes, now);
    const unresolvedAlvo = Boolean(data.alvoData) && rawRange === undefined;
    const descricao = (data.descricao?.trim() || edit?.descricao || '').trim() || undefined;
    const horizon = new Date(now.getTime() + 90 * 24 * 60 * 60_000);
    const rows = await this.appointments.listOverlapping(user.id, now, horizon, [
      'confirmed',
      'needs_review',
    ]);
    // Filtro determinístico: o texto só casa com o TÍTULO (findMatchingAppointments);
    // a data só estreita quando o modelo deu um período RESOLVÍVEL. "consulta de
    // quinta" com `from` horário não resolvesível ⇒ busca pelo título e apresenta.
    const candidates = findMatchingAppointments(rows, {
      ...(descricao ? { texto: descricao } : {}),
      ...(rawRange ? { intervalo: rawRange } : {}),
    });
    // "de quinta" que não resolveu NADA: não listar o mundo — perguntar qual (ask).
    const resolvedRange = descricao ? undefined : rawRange;
    this.logger.log(
      `bot: localizacao p/ ${user.id}: ${candidates.length} candidata(s) ` +
        `(descricao="${descricao ?? ''}", alvoData=${data.alvoData ? 'sim' : 'nao'})`,
    );
    if (candidates.length === 0) {
      if (!descricao && (!resolvedRange || unresolvedAlvo)) {
        return { location: { kind: 'ask_descricao' } };
      }
      return { location: { kind: 'none' } };
    }
    if (candidates.length === 1) {
      const only = candidates[0]!;
      if (edit && edit.appointmentId !== only.id) {
        // resposta ao "qual deles?"/descrição refinada: a máquina apresenta direto.
        // (candidate só no turno que ABRIU a edição — nunca para re-apresentar.)
        return { picked: this.toEditCandidate(only) };
      }
      return { location: { kind: 'candidate', data: this.toEditCandidate(only) } };
    }
    if (edit?.appointmentId) {
      // candidata já apresentada (sessão em confirmação/escolha): não re-localizar —
      // a fala é DADO do passo; a máquina trata (escolher_candidata/confirmar_*).
      return {};
    }
    return {
      location: {
        kind: 'candidates',
        data: candidates.slice(0, BOT_MESSAGES.maxCandidatas).map((a) => this.toEditCandidate(a)),
      },
    };
  }

  /** Row do Prisma → candidata vista pela máquina (id/title/quando/status). */
  private toEditCandidate(row: {
    id: string;
    title: string;
    startsAt: Date;
    endsAt: Date;
    status: string;
  }): EditCandidateLike {
    return {
      id: row.id,
      title: row.title,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      status: row.status,
    };
  }

  /** `alvoData` do interpretador → intervalo UTC (símbolos: agenda-query puro). */
  private resolveAlvoRange(
    alvoData: { simbolo?: string; from?: string; to?: string } | undefined,
    offsetMinutes: number,
    now: Date,
  ): { start: Date; end: Date } | undefined {
    if (!alvoData) return undefined;
    if (alvoData.simbolo) {
      return resolveSimboloRange(alvoData.simbolo as SimboloConsulta, now, offsetMinutes);
    }
    if (alvoData.from && alvoData.to) {
      const r = resolveIntervaloRange({ from: alvoData.from, to: alvoData.to }, offsetMinutes);
      if (r) return r;
      // ISO com hora em vez de dia-cheio: usa os instantes crus (meio-aberto preservado).
      const start = new Date(alvoData.from);
      const end = new Date(alvoData.to);
      if (isValidDate(start) && isValidDate(end) && end.getTime() > start.getTime()) {
        return { start, end };
      }
    }
    return undefined;
  }

  /**
   * Abre a sessão de editar/cancelar a partir da classificação off-flow (Fase 4):
   * a fala vira a primeira descrição do alvo; localização é a borda que faz.
   * Em `edit_descricao` a máquina já espera a descrição (editRedefine) — sem a
   * pergunta de proteção, que só existe com um criar em curso (spec regra 9).
   */
  private async offFlowLocate(
    user: BotUser,
    text: string,
    action: 'edit' | 'cancel',
    now: Date,
  ): Promise<void> {
    const offsetMinutes = tzOffsetMinutes(user.timezone, now);
    const session = this.machine.newSession(now);
    session.step = 'edit_descricao';
    session.editMode = action;
    session.editRedefine = true;
    session.candidate.edit = {
      action: action === 'cancel' ? 'cancelar' : 'editar',
      descricao: text.trim() || undefined,
      tries: 0,
    };
    this.sessions.set(user.telegramId, session);
    // O turno que ABRIU a edição já gastou a classificação de intenção do usuário;
    // a sessão abre com [editResumed=true] para o próximo turno (escolha "1", "sim")
    // não re-classificar a fala (que é DADO do passo — regra 22).
    this.consumedTurns.set(user.telegramId, true);
    // sem re-classificar: este turno é a descrição inicial do alvo (1 chamada LLM).
    const existing = await this.existingConfirmedFuture(user.id, now);
    const verdict = await this.runEditInterpret(
      text,
      session,
      existing,
      user,
      offsetMinutes,
      now,
      'target',
    );
    const outcome = await this.machine.handleTurn({
      session,
      user,
      text,
      existing,
      offsetMinutes,
      now,
      editLocation: verdict.location,
      editPicked: verdict.picked,
      editChange: verdict.change,
    });
    if (outcome.done) this.sessions.delete(user.telegramId);
    await this.send(user.telegramId, outcome.replies);
    if (outcome.update) await this.applyUpdate(user, outcome.update);
    if (outcome.cancelAppointment) {
      await this.applyCancelAppointment(user, outcome.cancelAppointment.appointmentId);
    }
  }

  /**
   * Carga p/ findConflict: endsAt>now, janela futura de 90 dias (spec) e
   * `confirmed + needs_review` — review multi-agente 2026-10-09/R1: a carga
   * PRECISA bater com a das fronteiras de escrita (ADR-0015/D6;
   * `appointments.service.existingFor`). Se o bot só visse `confirmed`, um
   * `needs_review` concorrente passaria no pré-check do chat e a GRAVAÇÃO
   * (que valida com a carga nova) devolveria conflito TARDE — mensagem sem
   * botões de remarcar/abortar e sessão encerrada. Pré-check alinhado = o
   * conflito é descoberto na hora certa, com o fluxo de resposta certo.
   */
  private async existingConfirmedFuture(userId: string, now: Date): Promise<AppointmentLike[]> {
    const horizon = new Date(now.getTime() + 90 * 24 * 60 * 60_000);
    const rows = await this.prisma.appointment.findMany({
      where: {
        userId,
        status: { in: ['confirmed', 'needs_review'] },
        endsAt: { gt: now, lte: horizon },
      },
      orderBy: { startsAt: 'asc' },
      select: { id: true, title: true, startsAt: true, endsAt: true },
    });
    return rows;
  }

  /**
   * Regras 1+2 da spec (Fase 1) + roteamento da consulta (Fase 2): fora do fluxo o
   * LLM classifica a intencao e so transita acima do limiar (ADR-008).
   *
   * - consulta pendente aguardando o periodo (spec Fase 2 #14): desistencia encerra,
   *   2a resposta reinterpreta, 3a pergunta encerra educadamente.
   * - confianca baixa / parse falho => pergunta o que o usuario quis, nunca age.
   * - `consultar` => AgendaQueryService (somente leitura; nao abre o fluxo).
   * - `criar`/`substituir_atual` => abre o fluxo; a fala vira o passo titulo.
   * - `continuar_fluxo`/`remarcar`/`fora_do_escopo` => resposta padrao.
   * - `cancelar` => nada em andamento, so responde.
   */
  private async offFlowTurn(user: BotUser, text: string, now: Date): Promise<void> {
    const telegramId = user.telegramId;
    const offsetMinutes = tzOffsetMinutes(user.timezone, now);
    const pending = this.takePendingQuery(telegramId, now);

    // A consulta aguardando o período é tratada ANTES da classificação (o turno é a
    // RESPOSTA à pergunta do bot; fala de desistência dispensa o LLM — ADR-008).
    if (pending?.awaitingPeriod) {
      if (givesUpQuery(text) || parseYesNo(text) === false) {
        await this.telegram.sendMessage(telegramId, BOT_MESSAGES.cancelado);
        return;
      }
      if (pending.count >= AGENDA_QUERY_MAX_PERIOD_PROMPTS) {
        // 2× pedido de período sem sucesso: encerra educadamente (spec Fase 2 #14).
        await this.telegram.sendMessage(telegramId, this.agendaQuery.closePolitely());
        return;
      }
      await this.answerAgendaQuery(user, text, offsetMinutes, now, undefined, pending.count);
      return;
    }

    const classified = await this.classifier.classify(text, { inFlow: false });
    if (!classified.ok || classified.confidence < this.minConfidence) {
      await this.telegram.sendMessage(telegramId, BOT_MESSAGES.pediuEsclarecimento);
      return;
    }
    switch (classified.intent) {
      case 'consultar': {
        await this.answerAgendaQuery(user, text, offsetMinutes, now, undefined, 0);
        return;
      }
      case 'criar':
      case 'substituir_atual': {
        // Fase 4 (spec regra 8): o criar abre no portão do atalho SOMENTE se a fala solta
        // trouxer um candidato (extração livre + régua). Sem candidato, o criar abre no
        // guiado clássico perguntando o título (spec A5/Fase 1: a fala de intenção que
        // abriu o fluxo ainda pode ser o título — nada se perde).
        const existing = await this.existingConfirmedFuture(user.id, now);
        const extracted = await this.runExtraction(text, user, offsetMinutes, now);
        const openable =
          extracted.kind === 'aceito' ||
          extracted.kind === 'quando_parcial' ||
          extracted.kind === 'fraco' ||
          extracted.kind === 'suspeito';
        const fresh = this.machine.newSession(now);
        if (!openable) {
          this.openFlow(user, now);
          // a fala vira o passo título (UX "marca uma consulta" ⇒ título), sem re-classificar
          const opened = this.sessions.get(user.telegramId)!;
          const outcome = await this.machine.handleTurn({
            session: opened,
            user,
            text,
            existing,
            offsetMinutes,
            now,
          });
          if (outcome.done) this.sessions.delete(user.telegramId);
          await this.send(user.telegramId, outcome.replies);
          return;
        }
        fresh.step = 'criar_aberto';
        this.sessions.set(user.telegramId, fresh);
        const outcome = await this.machine.handleTurn({
          session: fresh,
          user,
          text,
          extracted,
          existing,
          offsetMinutes,
          now,
        });
        if (outcome.done) this.sessions.delete(user.telegramId);
        await this.send(user.telegramId, outcome.replies);
        if (outcome.needsReview) {
          await this.persistNeedsReview(user, fresh, outcome.needsReview);
        }
        return;
      }
      case 'editar_compromisso':
        return this.offFlowLocate(user, text, 'edit', now);
      case 'cancelar_compromisso':
        return this.offFlowLocate(user, text, 'cancel', now);
      case 'cancelar': {
        await this.telegram.sendMessage(telegramId, BOT_MESSAGES.cancelado);
        return;
      }
      default: {
        await this.telegram.sendMessage(telegramId, BOT_MESSAGES.fallback);
      }
    }
  }

  /** Roda a consulta e envia; se o periodo faltou, marca a pendencia (contador). */
  private async answerAgendaQuery(
    user: BotUser,
    text: string,
    offsetMinutes: number,
    now: Date,
    inFlowStep: string | undefined,
    priorPrompts: number,
  ): Promise<void> {
    const result = await this.runAgendaQuery(user, text, offsetMinutes, now, inFlowStep);
    for (const reply of result.replies) {
      await this.telegram.sendMessage(user.telegramId, reply);
    }
    const key = user.telegramId;
    if (result.awaitingPeriod) {
      this.pendingQueries.set(key, {
        awaitingPeriod: true,
        count: priorPrompts + 1,
        lastActivityAt: now.getTime(),
      });
    } else {
      this.pendingQueries.delete(key);
    }
  }

  /** Estado pendente da consulta com TTL (llm.md #5); expirado = descartado. */
  private takePendingQuery(
    telegramId: string,
    now: Date,
  ): { awaitingPeriod: boolean; count: number } | undefined {
    const pending = this.pendingQueries.get(telegramId);
    if (!pending) return undefined;
    if (now.getTime() - pending.lastActivityAt > this.ttlMs) {
      this.pendingQueries.delete(telegramId);
      return undefined;
    }
    return pending;
  }

  private async runAgendaQuery(
    user: BotUser,
    text: string,
    offsetMinutes: number,
    now: Date,
    inFlowStep: string | undefined,
  ): Promise<AgendaQueryResult> {
    try {
      return await this.agendaQuery.run(user, { text, offsetMinutes, now, inFlowStep });
    } catch (err) {
      this.logger.error(`bot: falha na consulta de agenda p/ ${user.id}: ${String(err)}`);
      return {
        replies: [
          'Deu um probleminha aqui do meu lado e eu não consegui consultar 😞 Tenta de novo?',
        ],
        awaitingPeriod: false,
      };
    }
  }

  /**
   * Decisão #5 da Fase 2: depois de responder a consulta com o criar aberto, repete a
   * pergunta do passo atual (mesmo teclado) sem tocar no candidato. Reusa a máquina
   * com texto vazio + nenhuma classificação — cada passo re-pergunta a si mesmo.
   */
  private async replayCurrentStep(
    user: BotUser,
    session: FlowSession,
    offsetMinutes: number,
    now: Date,
  ): Promise<void> {
    const outcome = await this.machine.handleTurn({
      session,
      user,
      text: '',
      classified: undefined,
      existing: [],
      offsetMinutes,
      now,
    });
    if (outcome.done) this.sessions.delete(user.telegramId);
    await this.send(user.telegramId, outcome.replies);
  }

  /**
   * Replay do portão do atalho (Fase 4): depois de uma consulta com o criar aberto em
   * `criar_aberto`, a próxima fala solta é de novo hipótese do extrator (spec regra 8).
   */
  private async replayCreateGate(
    user: BotUser,
    session: FlowSession,
    text: string,
    existing: AppointmentLike[],
    offsetMinutes: number,
    now: Date,
  ): Promise<void> {
    const extracted = await this.runExtraction(text, user, offsetMinutes, now);
    const outcome = await this.machine.handleTurn({
      session,
      user,
      text,
      extracted,
      existing,
      offsetMinutes,
      now,
    });
    if (outcome.done) this.sessions.delete(user.telegramId);
    await this.send(user.telegramId, outcome.replies);
    if (outcome.needsReview) {
      await this.persistNeedsReview(user, session, outcome.needsReview);
    }
  }

  /** Criacao via AppointmentsService (mesmo caminho da web, D7). Falha logada, nunca engolida calada. */
  private async persist(
    user: BotUser,
    create: {
      title: string;
      startsAt: Date;
      endsAt: Date;
      notes: string | null;
      notificationRules: {
        type: 'none' | 'before_hours' | 'before_days' | 'countdown_3_2_1';
        value?: number;
      }[];
      timezone: string;
    },
  ): Promise<void> {
    try {
      await this.appointments.create(
        user.id,
        {
          title: create.title,
          startsAt: create.startsAt,
          endsAt: create.endsAt,
          notes: create.notes ?? undefined,
          notificationRules: create.notificationRules,
        },
        { origin: 'bot' },
      );
    } catch (err) {
      if (err instanceof AppointmentConflictError) {
        // corrida entre a checagem da maquina e o create: avisa e nao cria (1.1).
        const range = this.formatUtcRange(
          err.conflictWith.startsAt,
          err.conflictWith.endsAt,
          user.timezone,
        );
        this.logger.warn(`bot: conflito de corrida ao criar p/ ${user.id} — nada foi salvo`);
        await this.telegram.sendMessage(
          user.telegramId,
          BOT_MESSAGES.conflito({ title: err.conflictWith.title, range }),
        );
        return;
      }
      this.logger.error(`bot: falha ao criar compromisso p/ ${user.id}: ${String(err)}`);
      await this.telegram.sendMessage(
        user.telegramId,
        'Deu um probleminha aqui do meu lado e eu não consegui salvar 😞 Tenta de novo em instantes?',
      );
    }
  }

  /**
   * needs_review nascido da RÉGUA no criar (spec E16, decisão #6): persistido direto,
   * NUNCA via AppointmentsService.create (que é o caminho do confirmado e SEMPRE
   * materializa outbox — a fila de revisão não dispara lembrete: spec regra 7).
   */
  private async persistNeedsReview(
    user: BotUser,
    _session: FlowSession | undefined,
    needsReview: NonNullable<
      Awaited<ReturnType<SchedulingFlowMachine['handleTurn']>>['needsReview']
    >,
  ): Promise<void> {
    try {
      await this.prisma.appointment.create({
        data: {
          userId: user.id,
          title: needsReview.title,
          startsAt: needsReview.startsAt,
          endsAt: needsReview.endsAt,
          status: 'needs_review',
          origin: 'bot',
          rawText: needsReview.rawText,
          reviewReason: needsReview.reviewReason,
        },
      });
      this.logger.log(
        `bot: needs_review salvo p/ ${user.id} (${needsReview.reviewReason}) — zero outbox`,
      );
    } catch (err) {
      this.logger.error(`bot: falha ao salvar needs_review p/ ${user.id}: ${String(err)}`);
      await this.telegram.sendMessage(
        user.telegramId,
        'Deu um probleminha aqui do meu lado e eu não consegui anotar pra revisão 😞 Tenta de novo?',
      );
    }
  }

  /**
   * "sim" da edição (spec C12/C13): AppointmentsService.update faz o resto (conflito,
   * recálculo dos lembretes). ConflictError ⇒ a máquina re-pergunta o quando (máx 3).
   */
  private async applyUpdate(
    user: BotUser,
    update: {
      appointmentId: string;
      patch: { title?: string; startsAt?: Date; endsAt?: Date };
      title: string;
    },
  ): Promise<void> {
    try {
      await this.appointments.update(user.id, update.appointmentId, update.patch);
    } catch (err) {
      if (err instanceof AppointmentConflictError) {
        // A sessão já encerrou com o "Feito!" (a máquina emitiu done). Reabre a sessão
        // no passo de re-pergunta do quando (spec C13) para o usuário tentar outro horário.
        this.logger.log(`bot: conflito ao editar ${update.appointmentId} — re-pergunta o quando`);
        // Estado completo da re-pergunta (spec C13): a máquina monta a mensagem de
        // conflito a partir de `edit` + `editConflict` no próximo turno (re-posta a
        // cada fala sem quando; limite de 3 tentativas incluiu esta).
        const session = this.machine.newSession(new Date());
        session.editMode = 'edit';
        session.candidate.edit = {
          action: 'editar',
          appointmentId: update.appointmentId,
          fromTitle: update.title,
          ...(update.patch.startsAt ? { toStartUtc: update.patch.startsAt } : {}),
          ...(update.patch.endsAt ? { toEndUtc: update.patch.endsAt } : {}),
          tries: 2,
          lastConflict: {
            title: err.conflictWith.title,
            startsAt: err.conflictWith.startsAt,
            endsAt: err.conflictWith.endsAt,
          },
        };
        session.step = 'edit_propor';
        this.sessions.set(user.telegramId, session);
        const now2 = new Date();
        const outcome = await this.machine.handleTurn({
          session,
          user,
          text: '',
          existing: [],
          offsetMinutes: tzOffsetMinutes(user.timezone, now2),
          now: now2,
          editConflict: {
            title: err.conflictWith.title,
            startsAt: err.conflictWith.startsAt,
            endsAt: err.conflictWith.endsAt,
          },
        });
        await this.send(user.telegramId, outcome.replies);
        return;
      }
      this.logger.error(`bot: falha ao editar compromisso p/ ${user.id}: ${String(err)}`);
      await this.telegram.sendMessage(
        user.telegramId,
        'Deu um probleminha aqui do meu lado e eu não consegui mudar 😞 Tenta de novo?',
      );
    }
  }

  /**
   * "sim" do cancelar (spec D14, decisão #2 do plano: APAGAR): `remove` do service —
   * o cascade do Prisma derruba as linhas de outbox e jobs viram no-op (regra 12).
   */
  private async applyCancelAppointment(user: BotUser, appointmentId: string): Promise<void> {
    try {
      await this.appointments.remove(user.id, appointmentId);
    } catch (err) {
      this.logger.error(`bot: falha ao cancelar compromisso p/ ${user.id}: ${String(err)}`);
      await this.telegram.sendMessage(
        user.telegramId,
        'Deu um probleminha aqui do meu lado e eu não consegui cancelar 😞 Tenta de novo?',
      );
    }
  }

  private formatUtcRange(startsAt: Date, endsAt: Date, timeZone: string): string {
    const fmt = (d: Date) =>
      new Intl.DateTimeFormat('pt-BR', {
        timeZone,
        weekday: 'short',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(d);
    return `${fmt(startsAt)}–${fmt(endsAt)}`;
  }

  /** Renderiza as replies da maquina (texto + teclado inline) via shared/telegram. */
  private async send(telegramId: string, replies: BotReply[]): Promise<void> {
    for (const reply of replies) {
      // parse_mode HTML => todo texto dinâmico (que ecoa fala do usuário) precisa de escape.
      const text = escapeHtml(reply.text);
      if (reply.kind === 'buttons') {
        await this.telegram
          .getClient()
          .telegram.sendMessage(telegramId, text, {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                reply.buttons.map((label) => ({ text: label, callback_data: `flow:${label}` })),
              ],
            },
          })
          .catch((err: unknown) => {
            this.logger.error(`bot: falha ao enviar c/ teclado p/ ${telegramId}: ${String(err)}`);
          });
        continue;
      }
      await this.telegram.sendMessage(telegramId, text);
    }
  }

  /** Handler fino encaminha callback_data dos teclados p/ ca. */
  async handleCallback(telegramId: string, data: string): Promise<void> {
    if (!data.startsWith('flow:')) return;
    const label = data.slice('flow:'.length);
    if (label === 'hoje' || label === 'amanhã' || label === 'amanha') {
      await this.pickShortcutDay(telegramId, label);
      return;
    }
    const day = label.match(/^(\d{2})\/(\d{2})(?:\/(\d{4}))?$/);
    if (day) {
      const now = this.now();
      const year = day[3] ? Number(day[3]) : now.getUTCFullYear();
      await this.handleDayPick(telegramId, { year, month: Number(day[2]), day: Number(day[1]) });
      return;
    }
    if (/^([01]\d|2[0-3]):00$/.test(label)) {
      await this.handleTimePick(telegramId, label);
      return;
    }
    // sim/não, remarcar, abortar, confirmar, alterar, hoje...: seguem como fala normal.
    await this.handleText(telegramId, label);
  }

  private async pickShortcutDay(telegramId: string, label: string): Promise<void> {
    // resolve hoje/amanha no tz do usuario (deterministico, spec decisao #7).
    try {
      const user = await this.access.requireConfirmedUser(telegramId);
      const now = this.now();
      const offset = tzOffsetMinutes(user.timezone, now);
      const shift = label === 'hoje' ? 0 : 1;
      const probe = new Date(now.getTime() + shift * 24 * 60 * 60_000 + offset * 60_000);
      await this.handleDayPick(telegramId, {
        year: probe.getUTCFullYear(),
        month: probe.getUTCMonth() + 1,
        day: probe.getUTCDate(),
      });
    } catch {
      await this.telegram.sendMessage(telegramId, BOT_MESSAGES.cadastroNecessario);
    }
  }

  /** Exposto p/ teste de fumaça do parse sim/nao das mensagens centralizadas. */
  yesNo(text: string): boolean | null {
    return parseYesNo(text);
  }
}
