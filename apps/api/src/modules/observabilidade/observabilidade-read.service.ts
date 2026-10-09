import { Injectable, NotFoundException } from '@nestjs/common';
import {
  botEventsQuerySchema,
  botEventsResultSchema,
  llmUsageQuerySchema,
  llmUsageResultSchema,
  updateObservabilityRolloutInputSchema,
} from '@agendabo/contracts';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';

/**
 * Leitura de auditoria (Fase 9, spec observabilidade B5/B6/C4). Duas visoes do
 * MESMO GET /bot-events:
 *  - admin: qualquer filtro (incl. userId);
 *  - usuario com rollout ligado: SOMENTE os proprios eventos — o userId da
 *    visao vem do TOKEN (quem chama nunca filtra por outro id) e a flag e
 *    checada na fonte (desligar a flag vale na hora). 404 (nao 403) sem flag:
 *    a rota nao existe para quem nao tem rollout (nada vaza).
 * `llm_calls` e sempre admin-only (spec C4 — o cliente nunca ve custo).
 */
@Injectable()
export class ObservabilidadeReadService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Papel do chamador lido da FONTE (não do token — admin revogado vale na
   * hora, padrão re-fetch da casa). Retorna o id + isAdmin para o service
   * decidir o alcance da consulta (admin tudo / rollout só-próprios).
   */
  async callerRole(callerId: string): Promise<{ id: string; isAdmin: boolean }> {
    const me = await this.prisma.user.findUnique({
      where: { id: callerId },
      select: { isAdmin: true },
    });
    return { id: callerId, isAdmin: me?.isAdmin ?? false };
  }

  /** GET /bot-events — o papel do chamador define o alcance da consulta. */
  async listBotEvents(caller: { id: string; isAdmin: boolean }, raw: unknown) {
    const query = botEventsQuerySchema.parse(raw);

    let userIdFilter: string | undefined;
    if (caller.isAdmin) {
      userIdFilter = query.userId;
    } else {
      const me = await this.prisma.user.findUnique({
        where: { id: caller.id },
        select: { observabilidadeEventosAtivo: true },
      });
      if (!me?.observabilidadeEventosAtivo) {
        throw new NotFoundException('Rota nao encontrada');
      }
      // rollout: a visao e sempre a do proprio usuario (userId da query NAO vale
      // aqui — o padrao do repo: identidade nunca vem da query).
      userIdFilter = caller.id;
    }

    const where: Prisma.BotEventWhereInput = {
      ...(userIdFilter ? { userId: userIdFilter } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.botEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.botEvent.count({ where }),
    ]);
    const items = rows.map((r) => ({
      id: r.id,
      type: r.type,
      stage: r.stage,
      outcome: r.outcome,
      metadata: r.metadata,
      createdAt: r.createdAt,
      // admin viu eventos de muita gente — o userId por linha so sai na visao
      // admin; na do rollout tudo e do proprio chamador de todo modo.
      ...(caller.isAdmin ? { userId: r.userId } : {}),
    }));
    return botEventsResultSchema.parse({ items, total });
  }

  /**
   * GET /llm-usage (admin-only, spec C4): agregacao por purpose ou usuario.
   * A soma de micro-USD e feita pelo Postgres em inteiro (SUM de INT); float
   * so existe dentro do teste do provider. `callsWithoutUsage` denuncia as
   * chamadas sem tokens reportados — a soma de custo delas e parcial (spec C3).
   */
  async llmUsage(raw: unknown) {
    // P2-4 do review: escopo default = ULTIMOS 90 DIAS quando o admin nao
    // passa `from`. A tabela nao tem prazo de remocao (decisao humana #3),
    // entao a agregacao full-table e o unico jeito de a leitura nao piorar
    // para sempre. Limites (to-from) seguem presos pelo zod.
    const fallbackFrom = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const query = llmUsageQuerySchema.parse(raw);
    const where: Prisma.LlmCallWhereInput = {
      createdAt: {
        ...(query.from ? { gte: query.from } : { gte: fallbackFrom }),
        ...(query.to ? { lte: query.to } : {}),
      },
    };
    const groupField = query.groupBy === 'user' ? 'userId' : 'purpose';
    const rows = await this.prisma.llmCall.groupBy({
      by: [groupField],
      where,
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, costUsdMicros: true },
    });
    const buckets = rows.map((r) => {
      const key = String((r as Record<string, unknown>)[groupField] ?? 'sem_usuario');
      return {
        key,
        calls: r._count._all,
        inputTokens: r._sum.inputTokens ?? 0,
        outputTokens: r._sum.outputTokens ?? 0,
        costUsdMicros: r._sum.costUsdMicros ?? 0,
        // conservador e honesto: sem custo SOMADO != null, trata tudo como sem
        // usage (a agregacao nao pode contar custo de linha que nao tem tokens)
        callsWithoutUsage: r._sum.costUsdMicros === null ? r._count._all : 0,
      };
    });
    // P2-5 do review: ordem estavel e CONTRATADA — custo de ordenar por custo
    // zero ("sem cost" first). O Prisma devolve em ordem de GROUP BY; sem isto,
    // a UI de dashboard oscila a cada load.
    buckets.sort((a, b) => b.costUsdMicros - a.costUsdMicros);
    return llmUsageResultSchema.parse({ buckets });
  }

  /**
   * PATCH /admin/users/:id/observabilidade (rollout on/off, spec B6): SO a
   * flag — nada mais do usuario e tocavel por esta rota (o zod `.strict()` dos
   * contracts garante; 404 se o alvo nao existir).
   */
  async setRollout(targetUserId: string, raw: unknown) {
    const input = updateObservabilityRolloutInputSchema.parse(raw);
    // P2-9 do review: P2034 (deadlock/serialization) e transitorio — uma
    // re-tentativa resolve (o signup do admin segue o mesmo padrao de retry
    // da casa). Falha real de conexão NAO e retry-loop: uma chance e sobe.
    for (let attempt = 0; ; attempt += 1) {
      try {
        const result = await this.prisma.user.updateMany({
          where: { id: targetUserId },
          data: { observabilidadeEventosAtivo: input.observabilidadeEventosAtivo },
        });
        if (result.count === 0) throw new NotFoundException('Usuario nao encontrado');
        return {
          userId: targetUserId,
          observabilidadeEventosAtivo: input.observabilidadeEventosAtivo,
        };
      } catch (err) {
        const code = (err as { code?: string })?.code;
        if (code === 'P2034' && attempt === 0) continue;
        throw err;
      }
    }
  }
}
