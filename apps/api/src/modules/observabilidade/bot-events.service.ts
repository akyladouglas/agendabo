import { createHmac } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import {
  botEventStageSchema,
  parseBotEventMetadata,
  type BotEventOutcomeValue,
  type BotEventTypeValue,
} from '@agendabo/contracts';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { Env } from '../../config/env.validation';

/** O minimo que o registrador precisa saber do usuario do turno (BotUser é assignment-compatible). */
export interface BotEventUser {
  id: string;
  telegramId: string;
}

export interface BotEventInput {
  stage?: string;
  metadata?: unknown;
}

/**
 * truncate do HMAC (D-P3/ADR-0017): o hash SO existe para correlacionar
 * incidentes ("as 3 linhas sao do mesmo telegramId?"); 16 hexchars ~64 bits é
 * colisão-improvável na escala do produto e reduz o ganho de dicionário.
 */
const HASH_PREFIX = 16;

/**
 * Registro de interacoes do bot em `bot_events` (Fase 9, spec B1/B2; ADR-0017).
 *
 * invariantes deste service (a spec cobra as tres em teste):
 *  1. o telegramId CRU nunca sai daqui — a linha leva HMAC(EVENTS_HASH_SECRET)
 *     truncado (D-P3: nao reusar JWT_SECRET — um segredo, um proposito);
 *  2. `metadata` passa pelo zod dos contracts ANTES de gravar: conteudo
 *     proibido (fala/titulo/nota disfarçados) faz a metadata ser RECUSADA — a
 *     linha de auditoria ainda nasce, sem o conteudo; recusar nunca estoura o
 *     chamador;
 *  3. gravacao best-effort POS-commit (D-P6): falha do banco e log, nunca
 *     excecao — telemetria nao derruba turno nem trava transacao de negocio.
 */
@Injectable()
export class BotEventsService {
  private readonly logger = new Logger(BotEventsService.name);
  private readonly hashSecret: string;
  // P2-10 do review: LRU limitado (300) — o bot atende a mesma populacao o dia
  // todo; recalcular HMAC por turno e trabalho bobo. Mapa simples com evicao
  // por ordem de insercao (sem dependencia).
  private readonly hashCache = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.hashSecret = config.get('EVENTS_HASH_SECRET', { infer: true });
  }

  /** Hash deterministico do telegramId com salt (mesmo id => mesmo hash). */
  hashTelegramId(telegramId: string): string {
    const cached = this.hashCache.get(telegramId);
    if (cached !== undefined) return cached;
    const hash = createHmac('sha256', this.hashSecret)
      .update(telegramId)
      .digest('hex')
      .slice(0, HASH_PREFIX);
    if (this.hashCache.size >= 300) {
      const oldest = this.hashCache.keys().next().value;
      if (oldest !== undefined) this.hashCache.delete(oldest);
    }
    this.hashCache.set(telegramId, hash);
    return hash;
  }

  /**
   * Registra um evento do bot. Nunca lança (best-effort — D-P6). O stage é
   * texto CONTROLADO pelo codigo; algo fora do formato identificador (ex.: uma
   * fala passando por engano) degrada para `null` com warn, nunca e gravado.
   */
  async registrar(
    user: BotEventUser,
    type: BotEventTypeValue,
    outcome: BotEventOutcomeValue,
    input: BotEventInput = {},
  ): Promise<void> {
    try {
      const stage = this.sanitizeStage(input.stage);
      const metadata = this.sanitizeMetadata(type, input.metadata);
      await this.prisma.botEvent.create({
        data: {
          userId: user.id,
          type,
          outcome,
          stage,
          telegramIdHash: this.hashTelegramId(user.telegramId),
          // Prisma: undefined = coluna omitida; null explicito = Prisma.JsonNull
          metadata:
            metadata === undefined || metadata === null
              ? undefined
              : (metadata as Prisma.InputJsonValue),
        },
      });
    } catch (err) {
      // invariante 3: a fala do turno e mais importante que a auditoria dela.
      this.logger.error(
        `bot_events: falha ao registrar ${type}/${outcome} p/ ${user.id}: ${String(err)}`,
      );
    }
  }

  private sanitizeStage(stage: string | undefined): string | null {
    if (stage === undefined) return null;
    const parsed = botEventStageSchema.safeParse(stage);
    if (parsed.success) return parsed.data;
    this.logger.warn(
      `bot_events: stage fora do formato (descartado): ${JSON.stringify(stage).slice(0, 80)}`,
    );
    return null;
  }

  private sanitizeMetadata(type: BotEventTypeValue, metadata: unknown): unknown | undefined {
    if (metadata === undefined) return undefined;
    try {
      return parseBotEventMetadata(type, metadata) ?? null;
    } catch (err) {
      // invariante 2 com o maximo de auditoria que o ADR permite: a linha
      // ainda nasce (type/outcome/stage/hashes), mas o CONTEUDO rejeitado nao
      // e gravado em lugar nenhum — nem de forma truncada (pode ser fala).
      this.logger.warn(
        `bot_events: metadata recusada p/ ${type} (gravando linha sem metadata): ${
          err instanceof Error ? err.message.split('\n')[0] : String(err)
        }`,
      );
      return null;
    }
  }
}
