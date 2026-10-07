import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type AppointmentLike } from '@agendabo/schedule-core';
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
import {
  AgendaQueryService,
  AGENDA_QUERY_MAX_PERIOD_PROMPTS,
  type AgendaQueryResult,
} from './agenda-query.service';
import {
  SchedulingFlowMachine,
  type BotReply,
  type FlowSession,
  type HandleTurnInput,
  type ReminderClassified,
} from './scheduling-flow.machine';

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

  /** Abre o fluxo de agendamento (intencao `criar` confirmada acima do limiar). */
  private openFlow(user: BotUser, now: Date): void {
    const fresh = this.machine.newSession(now);
    this.sessions.set(user.telegramId, fresh);
    void this.send(user.telegramId, this.machine.startReplies());
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
    const classified =
      reminder || deterministic
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
      await this.replayCurrentStep(user, session, offsetMinutes, now);
      return;
    }

    const outcome = await this.machine.handleTurn({
      session,
      user,
      text: partial.text ?? '',
      classified,
      reminder,
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

  /** Carga p/ findConflict: confirmed, endsAt>now, janela futura de 90 dias (spec). */
  private async existingConfirmedFuture(userId: string, now: Date): Promise<AppointmentLike[]> {
    const horizon = new Date(now.getTime() + 90 * 24 * 60 * 60_000);
    const rows = await this.prisma.appointment.findMany({
      where: { userId, status: 'confirmed', endsAt: { gt: now, lte: horizon } },
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
        this.openFlow(user, now);
        // O turno atual ja e a resposta do passo titulo: processa a fala como dado
        // (UX: "marca uma consulta" vira titulo), sem re-classificar (1 chamada LLM/turno).
        const fresh = this.sessions.get(user.telegramId)!;
        const outcome = await this.machine.handleTurn({
          session: fresh,
          user,
          text,
          classified: undefined,
          existing: [],
          offsetMinutes: tzOffsetMinutes(user.timezone, now),
          now,
        });
        if (outcome.done) this.sessions.delete(user.telegramId);
        await this.send(user.telegramId, outcome.replies);
        return;
      }
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
