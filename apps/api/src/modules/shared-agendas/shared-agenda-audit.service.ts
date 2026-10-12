import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  parseSharedAuditMetadata,
  sharedAuditQuerySchema,
  type SharedAuditKind,
  type SharedAuditPage,
} from '@agendabo/contracts';
import { PrismaService } from '../../shared/prisma/prisma.service';

/**
 * Auditoria do compartilhamento (spec F.4) em `shared_agenda_audit_events`.
 * Padrao `BotEventsService` (ADR-0017) nas tres invariantes de escrita:
 *  1. `metadata` passa pelo zod dos contracts ANTES de gravar — conteudo
 *     proibido (titulo/nota/fala/email disfarçados) faz a metadata ser
 *     RECUSADA: a linha ainda nasce sem ela, com warn (F.4 é só
 *     ids/quantidades/estados);
 *  2. gravacao best-effort: falha do banco é log, NUNCA exceção — auditoria
 *     nao derruba convite/aceite/revogação;
 *  3. o actor é opcional (null quando o sistema descobre sozinho — ex.:
 *     `invite_expired_auto` achado por leitor).
 *
 * A leitura (`listar`) é a outra metade da F.4: só o dono OU o convidado do
 * vinculo veem os proprios eventos, paginada por cursor opaco.
 */
@Injectable()
export class SharedAgendaAuditService {
  private readonly logger = new Logger(SharedAgendaAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Grava um evento de auditoria. NUNCA lança (padrao BotEventsService).
   * `ctx.guestId`/`ctx.metadata` sao colunas/valores estruturados — ids de
   * gente real (a tabela é visível na UI; nada de placeholder pra email
   * inexistente — o service chamada decide o que auditar).
   */
  async registrar(
    actorId: string | null,
    kind: SharedAuditKind,
    ctx: { ownerId: string; guestId?: string | null; metadata?: unknown },
  ): Promise<void> {
    try {
      const metadata = this.sanitizeMetadata(kind, ctx.metadata);
      await this.prisma.sharedAgendaAuditEvent.create({
        data: {
          actorId,
          ownerId: ctx.ownerId,
          guestId: ctx.guestId ?? null,
          kind,
          // Prisma: undefined = coluna omitida; null explicito = Prisma.JsonNull
          metadata:
            metadata === undefined || metadata === null
              ? undefined
              : (metadata as Prisma.InputJsonValue),
        },
      });
    } catch (err) {
      // invariante 2: a acao de negocio é mais importante que a auditoria dela.
      this.logger.error(
        `shared_agenda_audit: falha ao registrar ${kind} p/ vinculo owner=${ctx.ownerId}: ${String(err)}`,
      );
    }
  }

  private sanitizeMetadata(kind: SharedAuditKind, metadata: unknown): unknown | undefined {
    if (metadata === undefined) return undefined;
    try {
      return parseSharedAuditMetadata(kind, metadata) ?? null;
    } catch (err) {
      // invariante 1: a linha ainda nasce; o conteudo rejeitado nao é gravado
      // em lugar nenhum — nem truncado (pode ser conteudo de compromisso).
      this.logger.warn(
        `shared_agenda_audit: metadata recusada p/ ${kind} (gravando linha sem metadata): ${
          err instanceof Error ? err.message.split('\n')[0] : String(err)
        }`,
      );
      return null;
    }
  }

  /**
   * GET /shared-agendas/audit — pagina de eventos do vinculo (occurredAt desc).
   * Autorizacao: a linha do vinculo precisa existir e o viewer precisa ser o
   * dono OU o convidado dela. Linha inexistente OU sem acesso caem no MESMO
   * NotFoundException (sem oráculo "existe mas você não pode").
   * O cursor é opaco: JSON `{occurredAt,id}` base64 — chave de ordenacao
   * composta, page size do zod (`limit` 1..100, default 20).
   */
  async listar(sharedAgendaIdRaw: unknown, viewerId: string): Promise<SharedAuditPage> {
    const query = sharedAuditQuerySchema.parse(sharedAgendaIdRaw);

    const link = await this.prisma.sharedAgenda.findUnique({
      where: { id: query.sharedAgendaId },
      select: { ownerId: true, guestId: true },
    });
    if (!link || (link.ownerId !== viewerId && link.guestId !== viewerId)) {
      throw new NotFoundException();
    }

    const before = decodeCursor(query.cursor);
    const rows = await this.prisma.sharedAgendaAuditEvent.findMany({
      where: {
        // M4 (review): o AND em conjuNcao — o filtro do cursor (mais antigo que
        // a posição) NUNCA pode valer sozinho. Um OR único permitiria que a
        // página 2 aceitasse eventos de OUTRO vínculo do mesmo dono (o
        // older-than-cursor dispensando o par). Entao:
        // AND: [ {par: ownerId + guestId∈{linha,null}}, {cursor: mais antigo} ]
        AND: [
          {
            // eventos do vinculo: mesmo dono E o convidado da linha (ou null em
            // evento sem convidado definido). Exigir o par evita vazar eventos de
            // OUTRO vinculo do mesmo dono para o convidado deste.
            ownerId: link.ownerId,
            OR: [{ guestId: link.guestId }, { guestId: null }],
          },
          ...(before ? [{ OR: [olderThan(before), sameInstantOther(before)] }] : []),
        ],
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      select: { id: true, occurredAt: true, kind: true, metadata: true },
    });

    const page = rows.slice(0, query.limit);
    const hasMore = rows.length > query.limit;
    const last = page[page.length - 1];
    // sharedAuditPageSchema e a borda da web (safeParse client-side); o cast
    // Documentos de Prisma (status Json) e estreitado pelo zod na leitura.
    return {
      items: page.map((r) => ({
        id: r.id,
        // `sharedAuditPageSchema` usa z.coerce.date() — Date cru serializa ISO
        // no JSON e passa no safeParse da web (mesma forma das listagens).
        occurredAt: r.occurredAt,
        kind: r.kind as SharedAuditPage['items'][number]['kind'],
        metadata: r.metadata ?? null,
      })),
      nextCursor:
        hasMore && last ? encodeCursor({ occurredAt: last.occurredAt, id: last.id }) : null,
    };
  }
}

interface Cursor {
  occurredAt: Date;
  id: string;
}

/** Cursor opaco base64 (`{occurredAt,id}`); cursor ruim = primeira pagina (defensivo, nunca 500). */
function decodeCursor(cursor: string | undefined): Cursor | null {
  if (!cursor) return null;
  try {
    const raw = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      occurredAt?: string;
      id?: string;
    };
    const occurredAt = raw.occurredAt ? new Date(raw.occurredAt) : null;
    if (!occurredAt || Number.isNaN(occurredAt.getTime()) || typeof raw.id !== 'string') {
      return null;
    }
    return { occurredAt, id: raw.id };
  } catch {
    return null;
  }
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(
    JSON.stringify({ occurredAt: c.occurredAt.toISOString(), id: c.id }),
    'utf8',
  ).toString('base64url');
}

/** Clusters de ordenacao compostos (desc,desc): eventos estritamente mais antigos. */
function olderThan(c: Cursor) {
  return { occurredAt: { lt: c.occurredAt } };
}
function sameInstantOther(c: Cursor) {
  return { occurredAt: c.occurredAt, id: { lt: c.id } };
}
