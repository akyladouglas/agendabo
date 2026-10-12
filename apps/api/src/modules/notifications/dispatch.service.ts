import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  appointmentsOnUserDay,
  describeLeadTime,
  userDayRange,
  utcToZonedParts,
} from '@agendabo/schedule-core';
import { BOT_MESSAGES, escapeHtml } from '../bot/messages';
import { TelegramClientService } from '../../shared/telegram/telegram-client.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { SharedAgendasService } from '../shared-agendas/shared-agendas.service';
import { SharedAgendaAuditService } from '../shared-agendas/shared-agenda-audit.service';
import type { Env } from '../../config/env.validation';
import {
  buildDigestBody,
  digestHeaderPtBr,
  greetingPtBr,
  type DigestSharedSection,
} from './digest';
import type { DispatchJobData } from './outbox.service';

/**
 * Medida de fuso na BORDA (ADR-002): minutos leste de UTC observados em `at`.
 * Exposta para o teste poder injetar fusos fixos sem Intl (regra testing).
 */
export type OffsetProvider = (timeZone: string, at: Date) => number;

export const realTzOffset: OffsetProvider = (timeZone, at) => {
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
};

/** Motivo guardado em `lastError` quando o atraso passou do limiar (spec regra 14). */
export const STALE_ERROR = 'atraso_excedido';

/** Resultado de um job processado (observável nos testes; o worker só loga). */
export type DispatchResult =
  | { kind: 'sent' }
  | { kind: 'noop'; reason: 'not_pending' | 'not_found' }
  | { kind: 'cancelled'; reason: 'gate_conta' | 'not_confirmed' }
  | { kind: 'failed'; reason: typeof STALE_ERROR | 'envio' };

interface OutboxRow {
  id: string;
  kind: 'reminder' | 'daily_digest';
  firesAt: Date;
  status: string;
  attempts: number;
  ruleType: string | null;
  appointment: {
    id: string;
    title: string;
    startsAt: Date;
    endsAt: Date;
    notes: string | null;
    status: string;
  } | null;
  user: {
    id: string;
    telegramId: string | null;
    emailConfirmedAt: Date | null;
    timezone: string;
    /** Nome p/ saudação do resumo (decisão 7 da spec web; null = sem nome). */
    name: string | null;
  };
}

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Lógica de disparo do worker (Fase 3, spec regras 11–14/17–18) — 100% testável sem
 * BullMQ: recebe `{ outboxId }` + `now` e decide a partir da linha do outbox. O
 * entrypoint `src/workers/notifications-worker.ts` é só a ligação BullMQ → este serviço.
 *
 * Idempotência pela LINHA (D4): `pending → sent` condicional via `updateMany` ANTES de
 * enviar; linha `sent`/`cancelled` ⇒ no-op (restart nunca reenvia). Gates na hora do
 * disparo: conta confirmada, compromisso `confirmed`, atraso ≤ `NOTIFY_STALE_MINUTES`.
 */
@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);

  /** Sobrescrito nos testes para fixar fusos (testing.md — nada de Intl/relógio real). */
  offsetProvider: OffsetProvider = realTzOffset;

  /** Contador de tentativas por linha, alimentado pelo `attempts: increment` do claim. */
  private readonly attemptCache = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramClientService,
    private readonly config: ConfigService<Env, true>,
    /**
     * Digest com seções compartilhadas (spec E.23, decisão D8): vínculos recebidos
     * ativos + auditoria best-effort `shared_section_built`. Opcional defensivamente
     * (o mock do worker-entry de testes pode não passar): sem ele, o corpo é o de
     * hoje (zero regressão — nunca se consulta vínculo nenhum).
     */
    private readonly sharedAgendas?: SharedAgendasService,
    private readonly sharedAudit?: SharedAgendaAuditService,
  ) {}

  /** Relógio da borda (testes congelam — testing.md; dispatch recebe `now` do caller). */
  now(): Date {
    return new Date();
  }

  async dispatch(job: DispatchJobData, now: Date = this.now()): Promise<DispatchResult> {
    const row = (await this.prisma.notificationOutbox.findUnique({
      where: { id: job.outboxId },
      include: {
        appointment: {
          select: {
            id: true,
            title: true,
            startsAt: true,
            endsAt: true,
            notes: true,
            status: true,
          },
        },
        user: {
          select: {
            id: true,
            telegramId: true,
            emailConfirmedAt: true,
            timezone: true,
            name: true,
          },
        },
      },
    })) as OutboxRow | null;
    if (!row) return this.noop(job, 'not_found');
    if (row.status !== 'pending') return this.noop(job, 'not_pending');

    // Gate de conta (regra 12 / invariante do bot): sem telegramId ou sem email
    // confirmado ⇒ cancelled, nada é enviado.
    if (!row.user.telegramId || !row.user.emailConfirmedAt) {
      await this.prisma.notificationOutbox.updateMany({
        where: { id: row.id, status: 'pending' },
        data: { status: 'cancelled', lastError: 'gate_conta' },
      });
      this.logger.log(`outbox ${row.id}: cancelled (gate_conta)`);
      return { kind: 'cancelled', reason: 'gate_conta' };
    }

    // needs_review/cancelado na hora do disparo nunca vaza lembrete (regra 11 / D8).
    if (row.kind === 'reminder' && row.appointment?.status !== 'confirmed') {
      await this.prisma.notificationOutbox.updateMany({
        where: { id: row.id, status: 'pending' },
        data: { status: 'cancelled', lastError: 'appointment_not_confirmed' },
      });
      this.logger.log(
        `outbox ${row.id}: cancelled (appointment ${row.appointment?.status ?? 'removido'})`,
      );
      return { kind: 'cancelled', reason: 'not_confirmed' };
    }

    // Atraso excessivo (regra 14): Redis/API caiu e o instante passou do limiar.
    const staleMinutes = this.config.get('NOTIFY_STALE_MINUTES', { infer: true });
    if (row.firesAt.getTime() < now.getTime() - staleMinutes * 60_000) {
      await this.prisma.notificationOutbox.updateMany({
        where: { id: row.id, status: 'pending' },
        data: { status: 'failed', lastError: STALE_ERROR },
      });
      this.logger.warn(`outbox ${row.id}: failed (${STALE_ERROR})`);
      return { kind: 'failed', reason: STALE_ERROR };
    }

    // Idempotência: só quem VENCE a condição pending→sent envia (regra 12 / restart).
    const claimed = await this.prisma.notificationOutbox.updateMany({
      where: { id: row.id, status: 'pending' },
      data: { status: 'sent', sentAt: now, attempts: { increment: 1 } },
    });
    if (claimed.count === 0) return this.noop(job, 'not_pending');
    // tentativas vistas POR ESTE PROCESSO p/ o limite de retry abaixo (o worker BullMQ
    // também conta as suas, mas o `failed` precisa sair do DISPATCH — regra 14)
    const attempt = (this.attemptCache.get(row.id) ?? 0) + 1;
    this.attemptCache.set(row.id, attempt);

    try {
      const text =
        row.kind === 'daily_digest'
          ? await this.buildDigestText(row.user.id, row.user.timezone, now, row.user.name)
          : this.buildReminderText(row, now);
      await this.telegram.sendMessage(row.user.telegramId, text);
      this.attemptCache.delete(row.id);
      return { kind: 'sent' };
    } catch (err) {
      // A linha já saiu de `pending` (nunca reenvia em paralelo): registra o erro e
      // relança para o backoff do BullMQ. Esgotado `NOTIFY_MAX_ATTEMPTS` ⇒ `failed`
      // + `lastError` — nada fica `pending` eterno (regras 12/14).
      const message = String(err instanceof Error ? err.message : err).slice(0, 500);
      this.logger.error(`outbox ${row.id}: envio falhou (tentativa ${attempt}): ${message}`);
      if (attempt >= this.config.get('NOTIFY_MAX_ATTEMPTS', { infer: true })) {
        this.attemptCache.delete(row.id);
        await this.prisma.notificationOutbox.updateMany({
          where: { id: row.id },
          data: { status: 'failed', lastError: message },
        });
        return { kind: 'failed', reason: 'envio' };
      }
      await this.prisma.notificationOutbox.updateMany({
        where: { id: row.id },
        data: { lastError: message },
      });
      throw err;
    }
  }

  /**
   * Lembrete (spec regra 13 / decisão #3): `⏰ Lembrete: "X" — qui 08/10 às 14:30
   * (daqui a 1 hora)` + notas quando existirem. TZ do usuário aplicado na borda
   * (ADR-002); antecedência em linguagem vem de `describeLeadTime` (schedule-core);
   * escape HTML aqui (gotcha 6 — o worker não passa pelo `send()` do bot).
   */
  private buildReminderText(row: OutboxRow, now: Date): string {
    const appointment = row.appointment!;
    const offset = this.offsetProvider(row.user.timezone, now);
    const p = utcToZonedParts(appointment.startsAt, offset);
    const weekday = WEEKDAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()] ?? '';
    const minutesBefore = Math.max(
      0,
      Math.round((appointment.startsAt.getTime() - row.firesAt.getTime()) / 60_000),
    );
    const lead = describeLeadTime(row.firesAt, now, minutesBefore);
    return escapeHtml(
      BOT_MESSAGES.lembrete({
        title: appointment.title,
        when: `${weekday} ${pad(p.day)}/${pad(p.month)} às ${pad(p.hour)}:${pad(p.minute)}`,
        lead,
        notes: appointment.notes,
      }),
    );
  }

  /**
   * Resumo diário (regras 17/18): compromissos `confirmed` do dia civil do usuário
   * (`appointmentsOnUserDay` com offset medido na borda) + seção "vencem hoje"
   * (linhas `pending`/`reminder` com `firesAt` no dia civil, de compromisso de qualquer
   * data — decisão #6). `needs_review` não aparece; dia vazio dos dois
   * = "☀️ Hoje você está livre!" (decisão #5).
   *
   * E.23/D8: com vínculos recebidos ATIVOS, o corpo ganha uma seção "🤝 Agenda de
   * ‹dono›:" por vínculo — os `confirmed` do dono que TOCAM o DIA CIVIL DO
   * CONVIDADO (interseção half-open, mesma semântica da agenda emprestada
   * C.19/B.19; o dono pode estar em outro fuso). A
   * materialização/idempotência do outbox NÃO muda (1 linha usuário/dia — ADR-009),
   * só o corpo. `needs_review` do dono nunca entra (where status confirmed).
   * Audit `shared_section_built` best-effort SOMENTE quando há seção (metadata =
   * apenas a QUANTIDADE de itens da seção — F.4, nunca conteúdo).
   */
  private async buildDigestText(
    userId: string,
    timezone: string,
    now: Date,
    name: string | null = null,
  ): Promise<string> {
    const offset = this.offsetProvider(timezone, now);
    const day = userDayRange(now, offset);
    const [appointments, due] = await Promise.all([
      this.prisma.appointment.findMany({
        where: { userId, status: 'confirmed' },
        select: { id: true, title: true, startsAt: true, endsAt: true },
      }),
      this.prisma.notificationOutbox.findMany({
        where: {
          userId,
          kind: 'reminder',
          status: 'pending',
          firesAt: { gte: day.start, lt: day.end },
        },
        select: { id: true, appointment: { select: { title: true, startsAt: true } } },
      }),
    ]);
    const today = appointmentsOnUserDay(appointments, timezone, now, () => offset * 60_000);
    const sharedSections = await this.buildSharedSections(userId, timezone, now, offset);
    return escapeHtml(
      buildDigestBody({
        now,
        offsetMinutes: offset,
        today,
        dueReminders: due
          .filter((d) => d.appointment !== null)
          .map((d) => ({ title: d.appointment!.title, startsAt: d.appointment!.startsAt })),
        header: digestHeaderPtBr(now, offset),
        // saudação com nome (decisão 7 da spec web): "Bom dia, Ana!" / "Bom dia!"
        greeting: greetingPtBr(now, offset, name),
        dueHeader: BOT_MESSAGES.resumoVencendoHoje,
        diaLivreText: BOT_MESSAGES.resumoDiaLivre,
        ...(sharedSections.length > 0 ? { sharedSections } : {}),
      }),
    );
  }

  /**
   * Seções compartilhadas do digest (E.23): um bloco por vínculo recebido ATIVO,
   * com os `confirmed` do dono cujo período TOCA o dia civil do CONVIDADO —
   * INTERSEÇÃO half-open (`startsAt < day.end AND endsAt >= day.start`, mesma
   * semântica da agenda emprestada B.19/listOverlapping). O dia civil do
   * convidado nasce da borda `userDayRange(now, offset)` do próprio convidado
   * (E.23 + C.19/B.19 — o dono pode estar em outro fuso; conteúdo do dia civil
   * do CONVIDADO, consulta interseccional). Compromisso do dono 23:00→01:00
   * APARECE na seção do dia que ele toca, não só no da largada. Dono sem nome
   * não gera seção (o cabeçalho "Agenda de ‹nome›" não tem como existir e o
   * e-mail do dono não vaza para o bot). Falha da carga compartilhada NUNCA
   * derruba o digest próprio: log + corpo sem seções (a seção é enfeite, o
   * resumo é o compromisso do dono da conta).
   * M6: uma ÚNICA consulta `userId in (donos)` + agrupamento em memória e as
   * auditorias depois do loop (Promise.all) — sem N+1 sequencial por vínculo.
   */
  private async buildSharedSections(
    userId: string,
    timezone: string,
    now: Date,
    offset: number,
  ): Promise<DigestSharedSection[]> {
    void timezone; // o corte fino é a interseção no `day` da borda (E.23) — sem segunda régua
    if (!this.sharedAgendas) return [];
    try {
      const links = await this.sharedAgendas.activeIncomingLinks(userId, now);
      const named = links.filter((l) => l.ownerName !== null); // sem rótulo: pula (nunca e-mail)
      if (named.length === 0) return [];
      const day = userDayRange(now, offset);
      // M6: uma consulta para TODOS os donos (mesmo WHERE da leitura emprestada
      // B.13: status confirmed fixo + interseção com o dia do convidado).
      const ownerIds = [...new Set(named.map((l) => l.ownerId))];
      type SharedRow = { id: string; title: string; startsAt: Date; endsAt: Date };
      const rows = (await this.prisma.appointment.findMany({
        where: {
          userId: { in: ownerIds },
          status: 'confirmed',
          // INTERSEÇÃO half-open com o dia civil do CONVIDADO (M5/B.19): um
          // compromisso 23:00→01:00 TOCA os dois dias e deve aparecer em ambos.
          startsAt: { lt: day.end },
          endsAt: { gte: day.start },
        },
        orderBy: { startsAt: 'asc' },
        select: { id: true, title: true, startsAt: true, endsAt: true, userId: true },
      })) as (SharedRow & { userId: string })[];
      const byOwner = new Map<string, SharedRow[]>();
      for (const r of rows) {
        // M6: o `userId` só existe para o agrupamento — a seção carrega o
        // subconjunto do digest (id/título/início/fim), nada além.
        const item: SharedRow = { id: r.id, title: r.title, startsAt: r.startsAt, endsAt: r.endsAt };
        const bucket = byOwner.get(r.userId);
        if (bucket) bucket.push(item);
        else byOwner.set(r.userId, [item]);
      }
      const sections: DigestSharedSection[] = [];
      const builtLinks: { ownerId: string }[] = [];
      for (const link of named) {
        const items = byOwner.get(link.ownerId) ?? [];
        if (items.length === 0) continue; // dia do dono vazio no dia do convidado: sem seção
        sections.push({ ownerName: link.ownerName as string, items });
        builtLinks.push({ ownerId: link.ownerId });
      }
      // F.4: `shared_section_built` só quando há seção; metadata = contagem da
      // seção. M6: fora do loop, em paralelo (o auditor é nunca-lança — a ordem
      // de chegada não é contrato; a pareia por índice mantém os donos certos).
      if (sections.length > 0 && this.sharedAudit) {
        await Promise.all(
          sections.map((section, i) =>
            this.sharedAudit!.registrar(userId, 'shared_section_built', {
              ownerId: builtLinks[i]!.ownerId,
              guestId: userId,
              metadata: { count: section.items.length },
            }),
          ),
        );
      }
      return sections;
    } catch (err) {
      this.logger.warn(`digest: seção compartilhada falhou p/ ${userId}: ${String(err)}`);
      return [];
    }
  }

  private noop(job: DispatchJobData, reason: 'not_pending' | 'not_found'): DispatchResult {
    this.logger.log(`job ${job.outboxId}: no-op (${reason})`);
    return { kind: 'noop', reason };
  }
}
