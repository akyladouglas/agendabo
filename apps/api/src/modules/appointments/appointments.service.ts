import { Injectable, NotFoundException } from '@nestjs/common';
import {
  appointmentInputSchema,
  appointmentPatchSchema,
  checkConflictInputSchema,
  listAppointmentsQuerySchema,
  relocationOptionsInputSchema,
  rescheduleAppointmentInputSchema,
} from '@agendabo/contracts';
import { findConflict, planRelocation } from '@agendabo/schedule-core';
import { AppointmentOrigin, AppointmentStatus, type NotificationRuleType, Prisma } from '@prisma/client';
import type { AppointmentDto } from '@agendabo/contracts';

/** Alias local do enum Prisma (usado no default de `listOverlapping`). */
type $AppointmentStatus = AppointmentStatus;

/** Shape cru do `SELECT ... FOR UPDATE` de existingForInTx (mesmas colunas do model). */
type RawAppointmentRow = {
  id: string;
  title: string;
  notes: string | null;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  origin: AppointmentOrigin;
  rawText: string | null;
  reviewReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
};
import { PrismaService } from '../../shared/prisma/prisma.service';
import { OutboxService } from '../notifications/outbox.service';

/** Erro de dominio: conflito de horario (1.1). A controller vira 409 com o compromisso que choca. */
export class AppointmentConflictError extends Error {
  constructor(readonly conflictWith: { id: string; title: string; startsAt: Date; endsAt: Date }) {
    super('conflito de horario');
  }
}

/** Erro de dominio: a jogada pedida nao existe mais (client obsoleto — D4 da spec). 409 sem escrita. */
export class RelocationNotAvailableError extends Error {
  constructor(readonly conflictWith: { id: string; title: string; startsAt: Date; endsAt: Date }) {
    super('jogada de reagendamento nao disponivel');
  }
}

/**
 * Regras de lembrete viram instantes de disparo determinísticos via schedule-core
 * (computeTriggers no OutboxService) e são materializadas no outbox JUNTO com o
 * compromisso (spec Fase 3, regras 6/9/10). A fila só recebe job pós-commit.
 */
@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  /** Relógio da borda (testes sobrescrevem — testing.md; regra de domínio recebe `now`). */
  now(): Date {
    return new Date();
  }

  async list(userId: string, raw: unknown) {
    const { from, to } = listAppointmentsQuerySchema.parse(raw);
    const items = await this.prisma.appointment.findMany({
      where: { userId, startsAt: { gte: from }, endsAt: { lte: to } },
      orderBy: { startsAt: 'asc' },
      include: { notificationRules: true },
    });
    return { items };
  }

  /**
   * Compromissos que TOCAM o intervalo [from, to) — intersecção half-open
   * `startsAt < to AND endsAt >= from` (Fase 2, spec #8). Diferente da `list` da web
   * (que usa contenção `startsAt >= from AND endsAt <= to`): um compromisso que
   * começa antes do período ou termina depois dele também aparece. Ordenado por
   * `startsAt`. `cancelled` nunca entra (filtro de status, default confirmado+revisão).
   */
  async listOverlapping(
    userId: string,
    from: Date,
    to: Date,
    statuses: readonly $AppointmentStatus[] = ['confirmed', 'needs_review'],
  ) {
    return this.prisma.appointment.findMany({
      where: {
        userId,
        startsAt: { lt: to },
        endsAt: { gte: from },
        status: { in: [...statuses] },
      },
      orderBy: { startsAt: 'asc' },
    });
  }

  async checkConflict(userId: string, raw: unknown) {
    const input = checkConflictInputSchema.parse(raw);
    const existing = await this.existingFor(userId, input.ignoreId);
    const result = findConflict(input, existing);
    return { conflict: result.conflict, with: result.with ?? null };
  }

  /**
   * POST /appointments/relocation-options (spec C2): roda `planRelocation`
   * SERVER-SIDE com a carga completa (D1 — o "primeiro vão livre" mentiria com
   * a carga parcial da página). `blocked` (2+ conflitos) vira o MESMO 409 do
   * check-conflict (corpo `{ message, conflictWith }`) — a UI diferencia
   * "ofereça jogadas" de "não cabe" pela rota que respondeu.
   */
  async relocationOptions(userId: string, raw: unknown) {
    const input = relocationOptionsInputSchema.parse(raw);
    const existing = await this.existingFor(userId, input.movedId);
    const plan = planRelocation(input, existing, { now: this.now(), movedId: input.movedId });
    if (plan.kind === 'blocked') {
      const firstConflict = existing
        .filter((a) => findConflict(input, [a], { now: this.now() }).conflict)
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
      // `blocked` SEM conflito nomeado não é "2+ choques": é o defensivo da regra
      // (B6). Não vira o 409 `conflictWith` do form (a UI renderizaria o ISO cru
      // de um candidato sem título) — as opções vazias já dizem "não cabe".
      if (firstConflict) throw new AppointmentConflictError(firstConflict);
    }
    return plan;
  }

  /**
   * POST /appointments/reschedule (spec C3): tx única que move dois compromissos
   * (ou cria um já resolvendo o conflito) com `findConflict` revalidado DENTRO
   * da tx (E5/F.2). O server RECOMPUTA a jogada (D4): nunca grava horário
   * sugerido por client obsoleto. Lados que mudaram de `startsAt` têm lembretes
   * invalidados + re-materializados na MESMA tx; Redis só pós-commit.
   */
  async reschedule(userId: string, raw: unknown) {
    const input = rescheduleAppointmentInputSchema.parse(raw);
    const isCreate = input.mode === 'create';
    const candidate = isCreate
      ? { startsAt: input.create.startsAt, endsAt: input.create.endsAt }
      : { startsAt: input.newStart, endsAt: input.newEnd };
    const movedId = isCreate ? undefined : input.movedId;
    const otherId = input.otherId;

    // 1. Dono/status dos envolvidos (404 e nada escrito se furar)
    if (!isCreate) await this.loadOwned(userId, input.movedId);
    if (otherId) await this.loadOwned(userId, otherId);

    // 2. Pré-checagem com a carga completa (a revalidação de verdade é DENTRO da tx)
    const existing = await this.existingFor(userId, movedId);
    this.assertPlanHasMove(input, candidate, existing);

    const now = this.now();
    const rulesOf = (id: string) =>
      this.prisma.notificationRule.findMany({ where: { appointmentId: id } });

    const result = await this.prisma.$transaction(async (tx) => {
      // revalida DENTRO da tx (E5): carga relida + jogada recomputada — e é a
      // ÚNICA checagem que vale (pré-checagem de leitura fica só como
      // fail-fast; entre ela e a tx o mundo pode mudar).
      const fresh = await this.existingForInTx(tx, userId, movedId);
      this.assertPlanHasMove(input, candidate, fresh, now);
      const plan = planRelocation(candidate, fresh, { now, movedId });
      const expectedOtherSlot =
        plan.kind === 'options'
          ? plan.options.find((o) => o.kind === 'move-other' && o.other.id === otherId)
          : undefined;
      if (otherId && !expectedOtherSlot) {
        const conflict = fresh.find((a) => findConflict(candidate, [a], { now }).conflict);
        throw new RelocationNotAvailableError(conflict ?? { id: '', title: '', ...candidate });
      }
      if (
        otherId &&
        expectedOtherSlot &&
        expectedOtherSlot.kind === 'move-other' &&
        !isCreate &&
        input.otherStart &&
        input.otherEnd &&
        (expectedOtherSlot.newStart.getTime() !== input.otherStart.getTime() ||
          expectedOtherSlot.newEnd.getTime() !== input.otherEnd.getTime())
      ) {
        // client obsoleto: a jogada que ele viu mudou de horário (D4)
        throw new RelocationNotAvailableError({ id: '', title: '', ...candidate });
      }

      const sideEffects: { outboxIds: string[]; triggers: { firesAt: Date }[] }[] = [];
      const dropTypes: NotificationRuleType[] = [];

      const moveSide = async (
        id: string,
        next: { startsAt: Date; endsAt: Date },
        current: { startsAt: Date; endsAt: Date },
      ) => {
        const timeChanged = current.startsAt.getTime() !== next.startsAt.getTime();
        if (!timeChanged) return;
        await this.outbox.invalidateForAppointment(tx, id);
        const rules = await rulesOf(id);
        const materialized = await this.outbox.materializeInTx(
          tx,
          { id, userId, startsAt: next.startsAt },
          rules.map((r) => ({ type: r.type, value: r.value })),
          now,
        );
        sideEffects.push({ outboxIds: materialized.outboxIds, triggers: materialized.triggers });
        dropTypes.push(...materialized.droppedRuleTypes);
      };

      let moved: AppointmentDto & { notificationRules: unknown[] };
      let other: AppointmentDto & { notificationRules: unknown[] } = null as never;

      if (isCreate) {
        const parsedCreate = appointmentInputSchema.parse(input.create);
        if (otherId) {
          const otherRow = await tx.appointment.findFirst({
            where: { id: otherId, userId },
            include: { notificationRules: true },
          });
          if (!otherRow) throw new NotFoundException();
          const slot = this.expectMoveOtherSlot(candidate, fresh, movedId, otherId, undefined, now);
          await moveSide(otherId, slot, { startsAt: otherRow.startsAt, endsAt: otherRow.endsAt });
          other = (await tx.appointment.update({
            where: { id: otherId },
            data: { startsAt: slot.startsAt, endsAt: slot.endsAt },
            include: { notificationRules: true },
          })) as unknown as AppointmentDto & { notificationRules: unknown[] };
        }
        const hasRules = parsedCreate.notificationRules.some((r) => r.type !== 'none');
        const created = await tx.appointment.create({
          data: {
            title: parsedCreate.title,
            startsAt: parsedCreate.startsAt,
            endsAt: parsedCreate.endsAt,
            notes: parsedCreate.notes ?? null,
            userId,
            origin: 'web',
            status: 'confirmed',
            notificationRules: { create: parsedCreate.notificationRules.map(toRuleCreate) },
          },
          include: { notificationRules: true },
        });
        if (hasRules) {
          const materialized = await this.outbox.materializeInTx(
            tx,
            { id: created.id, userId, startsAt: created.startsAt },
            parsedCreate.notificationRules.map((r) => ({ type: r.type, value: r.value ?? null })),
            now,
          );
          sideEffects.push({
            outboxIds: materialized.outboxIds,
            triggers: materialized.triggers,
          });
          dropTypes.push(...materialized.droppedRuleTypes);
        }
        moved = created as unknown as AppointmentDto & { notificationRules: unknown[] };
      } else {
        const movedRow = await tx.appointment.findFirst({
          where: { id: input.movedId, userId },
          include: { notificationRules: true },
        });
        if (!movedRow) throw new NotFoundException();
        await moveSide(input.movedId, candidate, {
          startsAt: movedRow.startsAt,
          endsAt: movedRow.endsAt,
        });
        moved = (await tx.appointment.update({
          where: { id: input.movedId },
          data: { startsAt: candidate.startsAt, endsAt: candidate.endsAt },
          include: { notificationRules: true },
        })) as unknown as AppointmentDto & { notificationRules: unknown[] };

        if (otherId) {
          const otherRow = await tx.appointment.findFirst({
            where: { id: otherId, userId },
            include: { notificationRules: true },
          });
          if (!otherRow) throw new NotFoundException();
          const slot = this.expectMoveOtherSlot(
            candidate,
            fresh,
            input.movedId,
            otherId,
            input.otherStart && input.otherEnd
              ? { startsAt: input.otherStart, endsAt: input.otherEnd }
              : undefined,
            now,
          );
          await moveSide(otherId, slot, { startsAt: otherRow.startsAt, endsAt: otherRow.endsAt });
          other = (await tx.appointment.update({
            where: { id: otherId },
            data: { startsAt: slot.startsAt, endsAt: slot.endsAt },
            include: { notificationRules: true },
          })) as unknown as AppointmentDto & { notificationRules: unknown[] };
        }
      }

      return { moved, other: other ?? null, sideEffects, dropTypes };
    });

    // Redis NUNCA dentro da tx (padrão existente)
    const jobs = result.sideEffects.flatMap((s) =>
      s.triggers.map((t, i) => ({ outboxId: s.outboxIds[i]!, firesAt: t.firesAt })),
    );
    if (jobs.length > 0) await this.outbox.enqueueJobs(jobs, now);

    return {
      moved: result.moved,
      other: result.other,
      droppedRules: result.dropTypes,
    };
  }

  /**
   * Valida o plano da escrita com `planRelocation` (regra única): destino livre
   * (ignorado o movido) ⇒ ok; senão exige que a jogada pedida exista. `otherId`
   * presente ⇒ a jogada esperada é `move-other` com esse outro; ausente ⇒ o
   * pedido é o DESTINO — 1 conflito ⇒ `move-self` (o servidor recomputa a
   * jogada, D4), 2+ ⇒ blocked (409 à frente). R3/review 2026-10-09: comentário
   * anterior dizia "precisa estar livre" — a regra de verdade é o
   * `planRelocation`, agora com teste de ambos os ramos.
   */
  private assertPlanHasMove(
    input: { mode: 'move' | 'create'; movedId?: string; otherId?: string },
    candidate: { startsAt: Date; endsAt: Date },
    existing: {
      id: string;
      title: string;
      startsAt: Date;
      endsAt: Date;
    }[],
    now?: Date,
  ): void {
    const plan = planRelocation(candidate, existing, { now, movedId: input.movedId });
    if (plan.kind === 'ok') return;
    if (plan.kind === 'blocked') {
      const firstConflict = existing
        .filter((a) => findConflict(candidate, [a], { now }).conflict)
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
      if (firstConflict) throw new AppointmentConflictError(firstConflict);
      throw new AppointmentConflictError({ id: '', title: '', ...candidate });
    }
    // options: sem `otherId` o client pede destino livre OU move-self (o form
    // manda o horário da jogada); com `otherId`, exige `move-other` com esse
    // outro — client obsoleto não escreve nada (D4).
    if (!input.otherId) return;
    const moveOther = plan.options.find(
      (o) => o.kind === 'move-other' && o.other.id === input.otherId,
    );
    if (!moveOther) {
      const conflict = existing.find((a) => findConflict(candidate, [a], { now }).conflict);
      throw new RelocationNotAvailableError(conflict ?? { id: '', title: '', ...candidate });
    }
  }

  /**
   * Extrai o slot `move-other` da jogada recomputada (D4: server manda no
   * horário). Se a jogada `move-other` sumiu (2+ conflitos agora), é conflito
   * comum; se ela MUDOU de horário (client viu 15:00, a regra manda 20:00), a
   * recusa protege o clique do usuário — o form re-consulta as opções.
   */
  private expectMoveOtherSlot(
    candidate: { startsAt: Date; endsAt: Date },
    existing: { id: string; title: string; startsAt: Date; endsAt: Date }[],
    movedId: string | undefined,
    otherId: string,
    requestedSlot: { startsAt: Date; endsAt: Date } | undefined,
    now: Date,
  ): { startsAt: Date; endsAt: Date } {
    const plan = planRelocation(candidate, existing, { now, movedId });
    if (plan.kind !== 'options') {
      const conflict = existing.find((a) => findConflict(candidate, [a], { now }).conflict);
      throw new AppointmentConflictError(conflict ?? { id: '', title: '', ...candidate });
    }
    const opt = plan.options.find((o) => o.kind === 'move-other' && o.other.id === otherId);
    if (!opt || opt.kind !== 'move-other') {
      const conflict = existing.find((a) => findConflict(candidate, [a], { now }).conflict);
      throw new RelocationNotAvailableError(conflict ?? { id: '', title: '', ...candidate });
    }
    const slot = { startsAt: opt.newStart, endsAt: opt.newEnd };
    if (
      requestedSlot &&
      (requestedSlot.startsAt.getTime() !== slot.startsAt.getTime() ||
        requestedSlot.endsAt.getTime() !== slot.endsAt.getTime())
    ) {
      throw new RelocationNotAvailableError({ id: '', title: '', ...slot });
    }
    return slot;
  }

  /**
   * Criação (web/bot): N regras + linhas do outbox na MESMA transação (spec regra 6);
   * jobs BullMQ entram na fila SÓ depois do commit (Redis nunca dentro de tx).
   * Gatilho no passado = zero linhas (descartado pelo schedule-core); a web recebe
   * `droppedRules` no response p/ avisar o usuário (Fase 5, decisão 3 — ADR-011).
   */
  async create(
    userId: string,
    raw: unknown,
    options: { origin?: 'bot' | 'web' } = {},
  ): Promise<AppointmentDto & { droppedRules: NotificationRuleType[] }> {
    const input = appointmentInputSchema.parse(raw);
    await this.assertNoConflict(userId, input);
    const now = this.now();
    const hasRules = input.notificationRules.some((r) => r.type !== 'none');

    const { appointment, outboxIds, triggers, droppedRuleTypes } = await this.prisma.$transaction(
      async (tx) => {
        const created = await tx.appointment.create({
          data: {
            ...input,
            notes: input.notes ?? null,
            userId,
            origin: options.origin ?? 'web',
            status: 'confirmed',
            notificationRules: { create: input.notificationRules.map(toRuleCreate) },
          },
          include: { notificationRules: true },
        });
        if (!hasRules)
          return {
            appointment: created,
            outboxIds: [] as string[],
            triggers: [],
            droppedRuleTypes: [] as NotificationRuleType[],
          };
        const materialized = await this.outbox.materializeInTx(
          tx,
          { id: created.id, userId, startsAt: created.startsAt },
          input.notificationRules.map((r) => ({
            type: r.type,
            value: r.value ?? null,
          })),
          now,
        );
        return { appointment: created, ...materialized };
      },
    );

    await this.outbox.enqueueJobs(
      triggers.map((t, i) => ({ outboxId: outboxIds[i]!, firesAt: t.firesAt })),
      now,
    );
    return { ...appointment, droppedRules: droppedRuleTypes };
  }

  /**
   * Edição pela web/API (spec regra 9): quando `startsAt`/`endsAt`/`notificationRules`
   * mudam, as linhas `pending` viram `cancelled` na MESMA transação e novas linhas
   * nascem dos dados novos; jobs antigos na fila viram no-op (regra 12). Edição que
   * não toca em nada disso não mexe no outbox. Conflito é SEMPRE 409 (ADR-0015 —
   * sem override: sobreposição é invariante do produto).
   */
  async update(
    userId: string,
    id: string,
    raw: unknown,
  ): Promise<AppointmentDto & { droppedRules: NotificationRuleType[] }> {
    const patch = appointmentPatchSchema.parse(raw);
    const current = await this.prisma.appointment.findFirst({ where: { id, userId } });
    if (!current) throw new NotFoundException();

    const startsAt = patch.startsAt ?? current.startsAt;
    const endsAt = patch.endsAt ?? current.endsAt;
    await this.assertNoConflict(userId, { startsAt, endsAt }, id);

    const now = this.now();
    const rulesChanged = patch.notificationRules !== undefined;
    const timeChanged =
      startsAt.getTime() !== current.startsAt.getTime() ||
      endsAt.getTime() !== current.endsAt.getTime();
    const reschedule = timeChanged || rulesChanged;
    const nextRules: readonly { type: NotificationRuleType; value: number | null }[] = rulesChanged
      ? patch.notificationRules!.map((r) => ({
          type: r.type as NotificationRuleType,
          value: r.value ?? null,
        }))
      : (await this.prisma.notificationRule.findMany({ where: { appointmentId: id } })).map(
          (r) => ({ type: r.type, value: r.value }),
        );

    const { appointment, outboxIds, triggers, droppedRuleTypes } = await this.prisma.$transaction(
      async (tx) => {
        if (rulesChanged) {
          await tx.notificationRule.deleteMany({ where: { appointmentId: id } });
          await tx.notificationRule.createMany({
            data: patch.notificationRules!.map((r) => ({ appointmentId: id, ...toRuleCreate(r) })),
          });
        }
        let newIds: string[] = [];
        let newTriggers: { firesAt: Date }[] = [];
        let dropped: NotificationRuleType[] = [];
        if (reschedule) {
          // cancela as pendências antigas na MESMA transação (spec regra 9)
          await this.outbox.invalidateForAppointment(tx, id);
          // re-materializa SOMENTE quando o instante ou as regras mudaram (mexer só no
          // título/notas/fim não recria gatilhos — os `firesAt` continuariam válidos)
          if (startsAt.getTime() !== current.startsAt.getTime() || rulesChanged) {
            const materialized = await this.outbox.materializeInTx(
              tx,
              { id, userId, startsAt },
              nextRules.map((r) => ({ type: r.type, value: r.value })),
              now,
            );
            newIds = materialized.outboxIds;
            newTriggers = materialized.triggers;
            dropped = materialized.droppedRuleTypes;
          }
        }
        const updated = await tx.appointment.update({
          where: { id },
          data: {
            ...(patch.title !== undefined && { title: patch.title }),
            ...(patch.notes !== undefined && { notes: patch.notes ?? null }),
            startsAt,
            endsAt,
          },
          include: { notificationRules: true },
        });
        return {
          appointment: updated,
          outboxIds: newIds,
          triggers: newTriggers,
          droppedRuleTypes: dropped,
        };
      },
    );

    if (reschedule) {
      // Jobs antigos ficam na fila: são no-op garantidos pela linha `cancelled`
      // (regra 12) — não há trabalho de fila aqui.
      await this.outbox.enqueueJobs(
        triggers.map((t, i) => ({ outboxId: outboxIds[i]!, firesAt: t.firesAt })),
        now,
      );
    }
    return { ...appointment, droppedRules: droppedRuleTypes };
  }

  /**
   * Remoção (spec regra 10): o cascade do Prisma apaga as linhas de outbox; jobs
   * remanescentes na fila viram no-op porque a linha não existe mais (regra 12).
   */
  async remove(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.appointment.deleteMany({ where: { id, userId } });
    if (count === 0) throw new NotFoundException();
  }

  /**
   * Carga dos compromissos do usuario para a checagem deterministica.
   * ADR-0015/D6: `needs_review` conta como obstáculo (a checagem antiga só via
   * `confirmed` — era o vetor real da sobreposição).
   */
  private async existingFor(userId: string, ignoreId?: string) {
    const rows = await this.prisma.appointment.findMany({
      where: {
        userId,
        status: { in: ['confirmed', 'needs_review'] },
        endsAt: { gt: this.now() },
      },
      orderBy: { startsAt: 'asc' },
    });
    return rows.filter((r) => r.id !== ignoreId);
  }

  /**
   * Mesma carga, lida DENTRO da tx (E5: revalidação anti-corrida). Review
   * multi-agente 2026-10-09/R2: `findMany` é snapshot de STATEMENT sob
   * READ COMMITTED — dois reschedules concorrentes podiam cada um ver um
   * mundo sem o write do outro e ambos gravar sobreposição (violava a
   * invariante ADR-0015 na janela mínima entre as txs). `FOR UPDATE` nas
   * linhas TRAVA a transação concorrente na primeira linha até o commit — o
   * serializador do intervalo é a própria trava de linha (decisão D9). O
   * shape é o MESMO do findMany antigo (todas as colunas do model) para não
   * alterar o contrato de `rescheduleResultSchema`.
   *
   * SMOKE REAL no Postgres (2026-10-09): tx A trava + dorme 3 s + escreve; tx B
   * faz a leitura CRUA (vê o mundo antigo) e depois `FOR UPDATE` — B BLOQUEIA,
   * acorda com o write do A VISÍVEL e decide sobre o estado novo (a leitura sem
   * trava continua snapshot velho; é por isso que a ÚNICA checagem que vale é a
   * desta carga travada).
   */
  private async existingForInTx(tx: Prisma.TransactionClient, userId: string, ignoreId?: string) {
    const rows = await tx.$queryRaw<RawAppointmentRow[]>`
      SELECT id, title, notes, "startsAt", "endsAt", status, origin, "rawText",
             "reviewReason", "createdAt", "updatedAt", "userId"
      FROM "appointments"
      WHERE "userId" = ${userId}::uuid
        AND status IN ('confirmed', 'needs_review')
        AND "endsAt" > ${this.now()}
      ORDER BY "startsAt" ASC
      FOR UPDATE
    `;
    return rows.filter((r) => r.id !== ignoreId);
  }

  /** Dono + status (movível: confirmado OU em revisão). 404 se furar (E5). */
  private async loadOwned(userId: string, id: string) {
    const row = await this.prisma.appointment.findFirst({
      where: { id, userId, status: { in: ['confirmed', 'needs_review'] } },
    });
    if (!row) throw new NotFoundException();
    return row;
  }

  private async assertNoConflict(
    userId: string,
    candidate: { startsAt: Date; endsAt: Date },
    ignoreId?: string,
  ): Promise<void> {
    const existing = await this.existingFor(userId, ignoreId);
    const result = findConflict(candidate, existing);
    if (result.conflict && result.with) {
      throw new AppointmentConflictError(result.with);
    }
  }
}

type RuleType = 'none' | 'before_hours' | 'before_days' | 'countdown_3_2_1';

function toRuleCreate(rule: {
  type: string;
  value?: number;
}): Prisma.NotificationRuleCreateWithoutAppointmentInput {
  return { type: rule.type as RuleType, value: rule.value ?? null };
}
