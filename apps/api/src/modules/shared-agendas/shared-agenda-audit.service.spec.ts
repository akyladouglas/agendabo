import { Logger, NotFoundException } from '@nestjs/common';
import { SharedAgendaAuditService } from './shared-agenda-audit.service';

/**
 * SharedAgendaAuditService (spec F.4) — jest com mock plano (testing.md),
 * padrao `bot-events.service.spec.ts`. O que este spec NAO negocia:
 *  - falha do banco é log, NUNCA exceção (auditoria nao derruba a acao);
 *  - metadata passa pelo zod dos contracts ANTES de gravar — conteudo
 *    proibido (titulo/email disfarçado) é recusado e a linha nasce sem ela;
 *  - leitura: so dono OU convidado do vinculo veem os proprios eventos, e
 *    linha inexistente/estranha é o MESMO 404 (sem oraculo);
 *  - paginacao por cursor opaco ({occurredAt,id} base64url).
 */

type Row = { id: string; occurredAt: Date; kind: string; metadata: unknown };
/** Linha de evento CRUA: guestId OBRIGATÓRIO — o filtro do par é exercitado de
 *  verdade pelo falso Prisma (undefined jamais casaria `guestId: null`). */
type RowFixture = Row & { guestId: string | null };

function make(
  opts: {
    link?: Record<string, unknown> | null;
    events?: RowFixture[];
    createFails?: boolean;
    findManyFails?: boolean;
  } = {},
) {
  const sharedAgenda = {
    findUnique: jest.fn(async () => opts.link ?? null),
  };
  const sharedAgendaAuditEvent = {
    create: jest.fn(async (_args: { data: Record<string, unknown> }) => {
      if (opts.createFails) throw new Error('banco caiu');
      return { id: 'e1' };
    }),
    findMany: jest.fn(async (args: { where: unknown; take?: number }) => {
      if (opts.findManyFails) throw new Error('banco caiu');
      // Falso Prisma que APLICA o where (padrao do mock de select em
      // appointments-shared-read.service.spec): os testes de paginacao assertam
      // RESULTADO (o que chega ao cliente), nunca o `where` cru — asserir o
      // where cimentava o formato permissivo do leak M4. Ordena e corta (take)
      // como o banco — a paginacao de verdade so funciona com o where correto.
      const rows = applyWhere(opts.events ?? [], args.where as PrismaWhere);
      return typeof args.take === 'number' ? rows.slice(0, args.take) : rows;
    }),
  };
  const svc = new SharedAgendaAuditService({
    sharedAgenda,
    sharedAgendaAuditEvent,
  } as never);
  const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  return { svc, sharedAgenda, sharedAgendaAuditEvent, errorSpy, warnSpy };
}

/** Subconjunto da sintaxe Prisma usado pelo service: ownerId, guestId, occurredAt, id, AND/OR. */
type PrismaWhere = Record<string, unknown>;

function applyWhere(rows: Row[], where: PrismaWhere): Row[] {
  return rows
    .filter((r) => matches(r, where))
    .sort(
      (a, b) =>
        b.occurredAt.getTime() - a.occurredAt.getTime() ||
        (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
    );
}

function matches(r: Row, where: PrismaWhere): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'AND') {
      if (!(cond as PrismaWhere[]).every((w) => matches(r, w))) return false;
    } else if (key === 'OR') {
      if (!(cond as PrismaWhere[]).some((w) => matches(r, w))) return false;
    } else if (key === 'ownerId') {
      // as linhas cruas do falso banco só carregam as colunas que os fixtures
      // modelam; `ownerId` é constante da cena (linkRow) — ausente ⇒ casa o do
      // vínculo. O teste de leak exercita `guestId` (presente) de verdade.
      if ('ownerId' in r && r.ownerId !== cond) return false;
    } else if (key === 'guestId') {
      // o where do par SEMPRE consulta guestId (linha do vínculo ou null): linha
      // sem a coluna no fixture é erro de cena — nunca um "casa os dois ramos"
      // que deixaria o leak do M4 escapar.
      if (!('guestId' in r)) {
        throw new Error('applyWhere: fixture sem guestId (o where do par exige a coluna)');
      }
      const mine = (r as unknown as Record<string, unknown>)[key];
      if (cond === null ? mine !== null : mine !== cond) return false;
    } else if (key === 'occurredAt') {
      const c = cond as Date | { lt?: Date };
      if (c instanceof Date) {
        // igualdade exata (cluster do cursor: sameInstantOther)
        if (r.occurredAt.getTime() !== c.getTime()) return false;
      } else if (c.lt && !(r.occurredAt < c.lt)) return false;
    } else if (key === 'id') {
      const c = cond as { lt?: string };
      if (c.lt && !(r.id < c.lt)) return false;
    } else {
      throw new Error(`applyWhere: chave nao implementada no falso Prisma: ${key}`);
    }
  }
  return true;
}

const OWNER = '11111111-1111-4111-8111-111111111111';
const GUEST = '22222222-2222-4222-8222-222222222222';
const LINK_ID = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';

describe('SharedAgendaAuditService.registrar (nunca-lança)', () => {
  it('grava linha com actorId/kind/ownerId/guestId', async () => {
    const { svc, sharedAgendaAuditEvent } = make();
    await svc.registrar(OWNER, 'invite_created', { ownerId: OWNER, guestId: GUEST });
    expect(sharedAgendaAuditEvent.create).toHaveBeenCalledTimes(1);
    const data = sharedAgendaAuditEvent.create.mock.calls[0]![0]!.data;
    expect(data).toMatchObject({
      actorId: OWNER,
      kind: 'invite_created',
      ownerId: OWNER,
      guestId: GUEST,
    });
  });

  it('banco lança: NADA propaga (telemetria não derruba convite/aceite) e loga error', async () => {
    const { svc, errorSpy } = make({ createFails: true });
    await expect(
      svc.registrar(OWNER, 'invite_accepted', { ownerId: OWNER, guestId: GUEST }),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('metadata recusada (email de compromisso disfarçado, schema .strict() do kind): linha nasce SEM metadata, warn, nunca estoura', async () => {
    const { svc, sharedAgendaAuditEvent, warnSpy } = make();
    await svc.registrar(OWNER, 'invite_resent', {
      ownerId: OWNER,
      guestId: GUEST,
      metadata: { invitesInWindow: 2, tituloDoCompromisso: 'consulta <no dr x>' },
    });
    expect(sharedAgendaAuditEvent.create).toHaveBeenCalledTimes(1);
    const data = sharedAgendaAuditEvent.create.mock.calls[0]![0]!.data;
    expect(data.metadata ?? null).toBeNull();
    expect(JSON.stringify(data)).not.toContain('consulta');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('metadata aceita (só quantidade — F.4) passa pelo zod e é gravada', async () => {
    const { svc, sharedAgendaAuditEvent } = make();
    await svc.registrar(OWNER, 'invite_resent', {
      ownerId: OWNER,
      guestId: GUEST,
      metadata: { invitesInWindow: 3 },
    });
    const data = sharedAgendaAuditEvent.create.mock.calls[0]![0]!.data;
    expect(data.metadata).toEqual({ invitesInWindow: 3 });
  });
});

describe('SharedAgendaAuditService.listar (F.4 — acesso + paginação)', () => {
  const linkRow = { id: LINK_ID, ownerId: OWNER, guestId: GUEST };
  const ev = (minAgo: number, id: string, kind = 'invite_created') => ({
    id,
    occurredAt: new Date(Date.UTC(2026, 9, 12, 12, 0, 0, 0) - minAgo * 60_000),
    kind,
    metadata: null,
    guestId: GUEST as string | null,
  });

  it('dono vê os eventos do vínculo (filtro ownerId+guestId, desc, limit+1)', async () => {
    const { svc, sharedAgendaAuditEvent } = make({
      link: linkRow,
      events: [ev(1, 'e2'), ev(5, 'e1')],
    });
    const page = await svc.listar({ sharedAgendaId: LINK_ID }, OWNER);
    expect(sharedAgendaAuditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: 21, // limit default 20 + 1 (sonda de próxima página)
      }),
    );
    expect(page.items.map((i) => i.id)).toEqual(['e2', 'e1']);
    expect(page.nextCursor).toBeNull();
  });

  it('convidado também vê (mesma página que o dono)', async () => {
    const { svc } = make({ link: linkRow, events: [ev(1, 'e1')] });
    await expect(svc.listar({ sharedAgendaId: LINK_ID }, GUEST)).resolves.toMatchObject({
      items: [{ id: 'e1' }],
    });
  });

  it('não-dono-não-convidado e linha inexistente: o MESMO NotFoundException (sem oráculo)', async () => {
    const estranho = make({ link: linkRow });
    await expect(estranho.svc.listar({ sharedAgendaId: LINK_ID }, OTHER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(estranho.sharedAgendaAuditEvent.findMany).not.toHaveBeenCalled();

    const ausente = make({ link: null });
    await expect(ausente.svc.listar({ sharedAgendaId: LINK_ID }, OWNER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('cursor opaco: próxima página busca estritamente antes de {occurredAt,id}; nextCursor decodifica no último item', async () => {
    const t0 = Date.UTC(2026, 9, 12, 12, 0, 0, 0);
    const { svc } = make({
      link: linkRow,
      events: [
        { ...ev(1, 'e3'), guestId: GUEST },
        { ...ev(2, 'e2'), guestId: GUEST },
        { ...ev(3, 'e1'), guestId: GUEST },
        { ...ev(4, 'e0'), guestId: GUEST },
        // par divergente (outro vínculo do dono) + guest null (sistema): a
        // página 2 só pode trazer e1/e0 — o cursor em conjunção com o par é o
        // que garante (a asserção de resultado pegaria o OR permissivo).
        { ...ev(5, 'x_outro'), guestId: OTHER },
        { ...ev(6, 'x_null'), guestId: null },
      ],
    });
    const page = await svc.listar({ sharedAgendaId: LINK_ID, limit: 2 }, OWNER);
    expect(page.items.map((i) => i.id)).toEqual(['e3', 'e2']);
    expect(page.nextCursor).not.toBeNull();

    // o cursor é o {occurredAt,id} do ÚLTIMO item da página (base64url)
    const decoded = JSON.parse(
      Buffer.from(page.nextCursor as string, 'base64url').toString('utf8'),
    ) as { occurredAt: string; id: string };
    expect(decoded).toEqual({ occurredAt: new Date(t0 - 2 * 60_000).toISOString(), id: 'e2' });

    // ASSERÇÃO DE RESULTADO (M4): o falso Prisma aplica o where — a página 2 só
    // traz o que é estritamente mais antigo que o cursor E do par. `x_outro`
    // (guestId de terceiro) NÃO é do par e nunca entra; `x_null` (guest null =
    // evento de sistema) É o ramo nulo do par e entra. Com o where permissivo
    // (cursor em OR com o par), 'x_outro' passaria pelo older-than-cursor
    // sozinho — na ordem (desc,desc) ele vem antes de e0/x_null e o corte de 3
    // da página 2 o colocaria na lista: esta asserção falha.
    const page2 = await svc.listar({ sharedAgendaId: LINK_ID, limit: 3, cursor: page.nextCursor }, OWNER);
    expect(page2.items.map((i) => i.id)).toEqual(['e1', 'e0', 'x_null']);
    expect(page2.items.map((i) => i.id)).not.toContain('x_outro');
    expect(page2.nextCursor).toBeNull();
  });

  it('M4 (leak entre vínculos): evento de OUTRO vínculo do mesmo dono NUNCA chega na página 2', async () => {
    // `e_outro` = evento do MESMO dono com guestId de TERCEIRO (outro vínculo) e
    // occurredAt ANTIGO. Com o where permissivo (o cursor em OR com o par, em
    // vez de conjunção), a página 2 aceitaria "mais antigo que o cursor" sozinho
    // e o evento do outro vínculo vazaria para o convidado deste. O falso Prisma
    // aplica o where de verdade (par + cursor em AND) — a asserção é de RESULTADO.
    // A cena é montada para o where PERMISSIVO matar a página 1 (é o que a
    // página 2 mostra no leak, qualquer que seja o corte): e_outro é o ÚNICO
    // evento mais antigo que o cursor que passa no older-than-cursor sem o par,
    // então com o leak a página 2 = [e_outro] (a ordem desc dos ids sintéticos
    // o põe antes dos pares) e com o fix = [e1, e0].
    const { svc } = make({
      link: linkRow,
      events: [
        { ...ev(1, 'f1'), guestId: GUEST },
        { ...ev(2, 'f2'), guestId: GUEST },
        { ...ev(3, 'f3'), guestId: GUEST },
        { ...ev(4, 'f4'), guestId: GUEST },
        { ...ev(5, 'f5'), guestId: GUEST },
        { ...ev(6, 'f6'), guestId: GUEST },
        { ...ev(7, 'f7'), guestId: GUEST },
        { ...ev(8, 'f8'), guestId: GUEST },
        { ...ev(9, 'f9'), guestId: GUEST },
        { ...ev(10, 'f10'), guestId: GUEST },
        { ...ev(11, 'f11'), guestId: GUEST },
        { ...ev(12, 'f12'), guestId: null }, // sistema do vínculo (guest null)
        // MESMO instante da cauda (12min), id maior que 'f12': com o where
        // permissivo (cursor em OR com o par) ele passa no older-than-cursor
        // SOZINHO e, na ordem (occurredAt desc, id desc), entra no corte da
        // página 2 ANTES dos pares — vazando para o convidado deste vínculo.
        { ...ev(12, 'e_outro'), guestId: OTHER }, // OUTRO vínculo do mesmo dono
      ],
    });
    const p1 = await svc.listar({ sharedAgendaId: LINK_ID, limit: 2 }, OWNER);
    expect(p1.items.map((i) => i.id)).toEqual(['f1', 'f2']);
    const p2 = await svc.listar(
      { sharedAgendaId: LINK_ID, limit: 2, cursor: p1.nextCursor },
      OWNER,
    );
    // e_outro (occurredAntigo/par divergente — exatamente o que o
    // older-than-cursor deixaria passar sozinho) NUNCA aparece; só os pares.
    // MUTAÇÃO verificada: com o where permissivo, p2 = ['e_outro', 'f12'].
    expect(p2.items.map((i) => i.id)).not.toContain('e_outro');
    expect(p2.items.map((i) => i.id)).toEqual(['f3', 'f4']);
  });

  it('cursor malformado: degrada para primeira página (nunca 500)', async () => {
    const { svc } = make({ link: linkRow, events: [ev(1, 'e1')] });
    await expect(
      svc.listar({ sharedAgendaId: LINK_ID, cursor: 'nao-e-base64-$$' }, OWNER),
    ).resolves.toMatchObject({ items: [{ id: 'e1' }] });
  });

  it('limit fora do zod (0 ou 101): ZodError na borda, nenhuma consulta', async () => {
    const { svc, sharedAgendaAuditEvent } = make({ link: linkRow });
    await expect(svc.listar({ sharedAgendaId: LINK_ID, limit: 0 }, OWNER)).rejects.toThrow();
    await expect(svc.listar({ sharedAgendaId: LINK_ID, limit: 101 }, OWNER)).rejects.toThrow();
    await expect(svc.listar({ sharedAgendaId: 'nao-uuid' }, OWNER)).rejects.toThrow();
    expect(sharedAgendaAuditEvent.findMany).not.toHaveBeenCalled();
  });
});
