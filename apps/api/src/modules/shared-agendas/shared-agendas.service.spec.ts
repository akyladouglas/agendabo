import { Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { SharedAgendasService, SharedInviteInvalidError } from './shared-agendas.service';
import { SharedAgendaAuditService } from './shared-agenda-audit.service';
import { sha256Hex } from '../auth/auth.service';
import { INVITE_TTL_MS } from './shared-invite';

/**
 * SharedAgendasService (spec compartilhamento bloco A; plano D4/D5/D10/D13) —
 * jest com mock plano (testing.md), padrao `auth-password-reset.service.spec`:
 * zod dos contracts de verdade, relógio congelado via `now`, Prisma/mail/audit
 * falsos. O que este spec NAO negocia:
 *  - anti-enumeration nominal: autoconvite/inexistente/nao-confirmation/quota
 *    retornam o MESMO 'ignored' e zero efeito (nem auditoria — a tabela é
 *    visível na UI e 'tentativa vs email inexistente' seria oráculo);
 *  - quota 3/30min por par (série = eventos invite_created/invite_resent);
 *  - pending duplicado SUBSTITUI token (link antigo morre) na MESMA linha;
 *  - aceite/decline: todos os sabores na MESMA falha genérica; CAS anti-corrida;
 *  - expiração checada NA HORA (D4): pending morta = revoked em todo leitor.
 */

const NOW = new Date('2026-10-12T12:00:00Z');
const OWNER_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const GUEST_ID = 'aaaaaaaa-0000-4000-8000-000000000002';
const OTHER_ID = 'aaaaaaaa-0000-4000-8000-000000000003';
const LINK_ID = 'bbbbbbbb-0000-4000-8000-000000000001';

interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

interface Fixtures {
  /** dono da sessão (findUnique por id) */
  session?: Record<string, unknown> | null;
  /** convidado (findUnique por email) */
  guest?: Record<string, unknown> | null;
  /** linha do par (findFirst ownerId+guestId / findUnique por id) */
  link?: Record<string, unknown> | null;
  /** todas as linhas do usuário no list/findMany */
  links?: Record<string, unknown>[];
  /** contrapartes devolvidas pelo user.findMany no list */
  guestsForList?: Record<string, unknown>[];
  /** eventos de auditoria lidos pela quota/expiração (findMany/findFirst) */
  events?: { occurredAt: Date; kind?: string; id?: string }[];
  /** quantas linhas o CAS (updateMany condicional) encontra viva */
  casCount?: number;
  mailFail?: boolean;
  /** create lança P2002 (corrida no índice parcial único do tokenHash) */
  createP2002?: boolean;
}

function p2002(): unknown {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '6.19.3',
  });
}

const sessionUser = { id: OWNER_ID, email: 'dono@x.com', name: 'Dona' };
const guestUser = {
  id: GUEST_ID,
  email: 'beta@x.com',
  emailConfirmedAt: new Date('2026-10-01T00:00:00Z'),
};

/** M1: o mock de guest reconhece o e-mail NORMALIZADO (o service envia o valor
 *  do `emailSchema` — trim+lowercase; o fixture do cadastro é caixa baixa). */
function isGuestEmail(email: unknown): boolean {
  return email === 'beta@x.com' || String(email).trim().toLowerCase() === 'beta@x.com';
}

function linkRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: LINK_ID,
    ownerId: OWNER_ID,
    guestId: GUEST_ID,
    status: 'pending',
    role: 'read',
    tokenHash: 'hash-antigo',
    inviteSentAt: new Date(NOW.getTime() - 60_000),
    inviteExpiresAt: new Date(NOW.getTime() + 3600_000),
    acceptedAt: null,
    revokedAt: null,
    createdAt: new Date(NOW.getTime() - 7 * 24 * 3600_000),
    updatedAt: NOW,
    ...over,
  };
}

function make(fx: Fixtures = {}) {
  const session = fx.session === undefined ? sessionUser : fx.session;
  const created: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const user = {
    findUnique: jest.fn(async (args: { where: Record<string, unknown> }) => {
      if ('id' in args.where) return args.where.id === OWNER_ID ? session : null;
      return isGuestEmail(args.where.email) ? fx.guest : null;
    }),
    findMany: jest.fn(async () => fx.guestsForList ?? [sessionUser, guestUser]),
  };
  const auditEvents: Record<string, unknown>[] = [];
  const sharedAgenda = {
    findFirst: jest.fn(async (args: { where: Record<string, unknown> }) => {
      if ('tokenHash' in args.where) {
        // caminho do aceite/recusa: só a linha pendente com AQUELE hash é achada
        const row = fx.link;
        return row && row.tokenHash === args.where.tokenHash ? row : null;
      }
      return fx.link ?? null;
    }),
    findUnique: jest.fn(async (args: { where: Record<string, unknown> }) =>
      args.where.id === LINK_ID ? (fx.link ?? null) : null,
    ),
    findMany: jest.fn(
      async (_args?: unknown) => (fx.links ?? (fx.link ? [fx.link] : [])) as Record<string, unknown>[],
    ),
    create: jest.fn(async (args: { data: Record<string, unknown> }) => {
      if (fx.createP2002) throw p2002();
      const row = { id: LINK_ID, ...args.data };
      created.push(args.data);
      return row;
    }),
    update: jest.fn(async (args: { where: unknown; data: Record<string, unknown> }) => {
      updates.push(args.data);
      return fx.link;
    }),
    updateMany: jest.fn(async (args: { where: unknown; data: Record<string, unknown> }) => {
      updates.push(args.data);
      return { count: fx.casCount ?? 1 };
    }),
  };
  const sharedAgendaAuditEvent = {
    create: jest.fn(async (args: { data: Record<string, unknown> }) => {
      auditEvents.push(args.data as never);
      return { id: 'e' + auditEvents.length };
    }),
    findMany: jest.fn(async () => (fx.events ?? []).map((e) => ({ occurredAt: e.occurredAt }))),
    findFirst: jest.fn(async () => {
      const hit = (fx.events ?? []).find((e) => e.kind === 'invite_expired_auto');
      return hit ? { id: hit.id ?? 'ea' } : null;
    }),
  };
  const mails: MailMessage[] = [];
  const mail = {
    send: jest.fn(async (msg: MailMessage) => {
      mails.push(msg);
      if (fx.mailFail) throw new Error('Resend falhou: domain not verified');
    }),
  };
  const config = { get: jest.fn(() => 'http://localhost:5174') };
  const telegramSent: { chatId: string; text: string }[] = [];
  const telegram = {
    sendMessage: jest.fn(async (chatId: string, text: string) => {
      telegramSent.push({ chatId, text });
    }),
  };
  const svc = new SharedAgendasService(
    { user, sharedAgenda, sharedAgendaAuditEvent } as never,
    mail as never,
    // service de auditoria REAL por cima do prisma mockado: os testes de fluxo
    // assertam os KINDS gravados (F.4) no caminho de verdade, não num dublê.
    new SharedAgendaAuditService({ sharedAgendaAuditEvent } as never),
    config as never,
    telegram as never,
  );
  // relogio do servico congelado (determinismo do atalho "hoje"/datas UTC)
  // contrapartes com telegramId/nome p/ o aviso A.3 do revoke (dono = sessão,
  // convidado = guestUser); testes sobrescrevem `user.findUnique` se preciso.
  (user.findUnique as jest.Mock).mockImplementation(
    async (args: { where: Record<string, unknown> }) => {
      if ('id' in args.where) {
        if (args.where.id === OWNER_ID) return { ...session, telegramId: 't-dono' };
        if (args.where.id === GUEST_ID) return { ...guestUser, telegramId: 't-beta' };
        return null;
      }
      return isGuestEmail(args.where.email) ? fx.guest : null;
    },
  );
  jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  jest.spyOn(Logger.prototype, 'error').mockImplementation();
  return {
    svc,
    user,
    sharedAgenda,
    sharedAgendaAuditEvent,
    mails,
    mail,
    config,
    created,
    updates,
    auditEvents,
    telegram,
    telegramSent,
  };
}

// helper local usado só pelo mock de `list` (extensão opcional do fixture)

function tokenIn(html: string): string {
  const m = /token=([0-9a-f]{64})/.exec(html);
  if (!m?.[1]) throw new Error('link com token de 64 hex nao encontrado no html');
  return m[1];
}

// ---------------------------------------------------------------------------
// invite (POST /shared-agendas) — anti-enumeration A.2/A.3, quota D13, D4/D5
// ---------------------------------------------------------------------------

const inviteBody = { email: 'beta@x.com' };

describe('SharedAgendasService.invite', () => {
  it('convidado confirmado: create pending role=read, tokenHash=sha256 (nunca o cru), TTL 24h, e-mail com link /convite-agenda', async () => {
    const { svc, created, mails } = make({ guest: guestUser });
    await expect(svc.invite(OWNER_ID, inviteBody, NOW)).resolves.toBe('created');

    expect(created).toHaveLength(1);
    const row = created[0]!;
    expect(row).toMatchObject({
      ownerId: OWNER_ID,
      guestId: GUEST_ID,
      role: 'read',
      status: 'pending',
    });
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.inviteSentAt).toEqual(NOW);
    expect(row.inviteExpiresAt).toEqual(new Date(NOW.getTime() + INVITE_TTL_MS));

    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toBe('beta@x.com');
    const token = tokenIn(mails[0]!.html);
    expect(row.tokenHash).toBe(sha256Hex(token)); // o cru só no link, o hash no banco
    expect(mails[0]!.html).toContain('http://localhost:5174/convite-agenda?token=');
  });

  it('nome do dono no e-mail é escapado (gotcha 6): `Ana <x>` não vira markup', async () => {
    const { svc, mails } = make({
      session: { ...sessionUser, name: 'Ana <x>' },
      guest: guestUser,
    });
    await svc.invite(OWNER_ID, inviteBody, NOW);
    expect(mails[0]!.html).toContain('Ana &lt;x&gt;');
    expect(mails[0]!.html).not.toContain('<x>');
  });

  // --- anti-enumeration nominal (F.1): os 4 sabores são INDISTINGUÍVEIS ---
  it.each([
    ['autoconvite (email == sessão)', { session: sessionUser, guest: null }, 'dono@x.com'],
    ['email inexistente', { session: sessionUser, guest: null }, 'beta@x.com'],
    [
      'email não confirmado',
      { session: sessionUser, guest: { ...guestUser, emailConfirmedAt: null } },
      'beta@x.com',
    ],
    [
      'quota estourada (3 na janela)',
      { session: sessionUser, guest: guestUser, events: [ev(25), ev(15), ev(5)] },
      'beta@x.com',
    ],
  ])(
    'ignorado sem nenhum efeito (%s): mesmo retorno, sem linha, sem e-mail, SEM auditoria',
    async (_name, fx, email) => {
      const m = make(fx);
      await expect(m.svc.invite(OWNER_ID, { email }, NOW)).resolves.toBe('ignored');
      expect(m.created).toHaveLength(0);
      expect(m.updates).toHaveLength(0);
      expect(m.mails).toHaveLength(0);
      expect(m.sharedAgendaAuditEvent.create).not.toHaveBeenCalled();
    },
  );

  it('linha active + POST novo: ignored silencioso (decisão de execução — reenvio é só de pendente)', async () => {
    const { svc, created, updates, mails } = make({
      guest: guestUser,
      link: linkRow({ status: 'active', tokenHash: null, inviteExpiresAt: null }),
    });
    await expect(svc.invite(OWNER_ID, inviteBody, NOW)).resolves.toBe('ignored');
    expect(created).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(mails).toHaveLength(0);
  });

  it('pending VIVA duplicada: MESMA linha com token novo (link antigo morre) + audit invite_resent com invitesInWindow', async () => {
    const { svc, updates, sharedAgenda, auditEvents } = make({
      guest: guestUser,
      link: linkRow(),
      events: [ev(10)], // 1 envio na janela ANTES deste → a carga do service conta o evento anterior
    });
    await expect(svc.invite(OWNER_ID, inviteBody, NOW)).resolves.toBe('resent');
    expect(sharedAgenda.update).toHaveBeenCalledTimes(1);
    expect(sharedAgenda.update.mock.calls[0]![0]!.where).toEqual({ id: LINK_ID }); // mesma linha
    const data = updates[0]!;
    expect(data.status).toBe('pending');
    expect(String(data.tokenHash)).toMatch(/^[0-9a-f]{64}$/);
    expect(data.tokenHash).not.toBe('hash-antigo'); // o link antigo MORREU
    expect(data.inviteExpiresAt).toEqual(new Date(NOW.getTime() + INVITE_TTL_MS));
    expect(auditEvents.map((e) => e.kind)).toEqual(['invite_resent']);
    // carga ANTES do envio: 1 evento na janela → este é o 2º convite dela (informativo, F.4)
    expect(auditEvents[0]!.metadata).toEqual({ invitesInWindow: 1 });
  });

  it('4º convite em 30min: ignored SEM nenhum efeito (quota silenciosa — nenhum audit, D5)', async () => {
    const { svc, created, updates, mails, sharedAgendaAuditEvent } = make({
      guest: guestUser,
      link: linkRow(),
      events: [ev(25), ev(15), ev(5)],
    });
    await expect(svc.invite(OWNER_ID, inviteBody, NOW)).resolves.toBe('ignored');
    expect(created).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(mails).toHaveLength(0);
    expect(sharedAgendaAuditEvent.create).not.toHaveBeenCalled();
  });

  it('pending MORTA (expirada na hora — D4): reconvite na mesma linha + traco invite_expired_auto (actor=null)', async () => {
    const { svc, updates, auditEvents } = make({
      guest: guestUser,
      link: linkRow({ inviteExpiresAt: new Date(NOW.getTime() - 1) }),
      events: [], // convite de ontem já saiu da janela de 30min
    });
    await expect(svc.invite(OWNER_ID, inviteBody, NOW)).resolves.toBe('resent');
    expect(updates[0]).toMatchObject({ status: 'pending' });
    expect(auditEvents.map((e) => e.kind)).toEqual(['invite_expired_auto', 'invite_resent']);
    expect(auditEvents[0]!.actorId).toBeNull(); // foi o sistema que descobriu (D4)
  });

  it('revoked → pending na MESMA linha (A.9: histórico é a mesma linha) com quota aplicada', async () => {
    const { svc, updates, sharedAgenda } = make({
      guest: guestUser,
      link: linkRow({
        status: 'revoked',
        tokenHash: null,
        inviteExpiresAt: null,
        revokedAt: new Date(),
      }),
    });
    await expect(svc.invite(OWNER_ID, inviteBody, NOW)).resolves.toBe('resent');
    expect(sharedAgenda.update.mock.calls[0]![0]!.where).toEqual({ id: LINK_ID });
    expect(updates[0]).toMatchObject({ status: 'pending', revokedAt: null });
  });

  it('corrida no índice parcial (create P2002): ignored silencioso, sem e-mail, sem 500', async () => {
    const { svc, created, mails } = make({ guest: guestUser, createP2002: true });
    await expect(svc.invite(OWNER_ID, inviteBody, NOW)).resolves.toBe('ignored');
    expect(created).toHaveLength(0);
    expect(mails).toHaveLength(0);
  });

  it('Resend falha: retorno igual, token fica criado, audit invite_email_failed + log interno SEM o token cru', async () => {
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const { svc, created, mails, auditEvents } = make({ guest: guestUser, mailFail: true });
      await expect(svc.invite(OWNER_ID, inviteBody, NOW)).resolves.toBe('created');
      expect(created).toHaveLength(1); // o token existe p/ o reenvio depois
      expect(mails).toHaveLength(1);
      expect(auditEvents.map((e) => e.kind)).toEqual(['invite_created', 'invite_email_failed']);
      const logged = stderr.mock.calls.map((c) => String(c[0])).join('');
      expect(logged).toContain('beta@x.com');
      expect(logged).not.toContain(tokenIn(mails[0]!.html));
    } finally {
      stderr.mockRestore();
    }
  });

  // M1 (review): o invite normaliza o e-mail (emailSchema trim+lowercase) ANTES
  // de buscar o guest — reenvio com "BETA@X.com " acha o guest cadastrado como
  // 'beta@x.com' e REENVIA ('resent'), em vez de cair em 'ignored'.
  it('M1: e-mail em caixa diferente do cadastro é normalizado e acha o guest (resent, não ignored)', async () => {
    const { svc, updates } = make({ guest: guestUser, link: linkRow() });
    // o service envia o e-mail NORMALIZADO (emailSchema: trim+lowercase) na
    // busca do guest — é isso que a busca do mock casa (isGuestEmail). O
    // domínio tem de ser válido (o emailSchema não afrouxa a validação); o que
    // o contrato agora ABSORVE é a caixa e o espaço. Sem o emailSchema (o
    // `z.string().email()` cru antigo, sem transform), 'BETA@X.com' ia cru para
    // a busca e o mock de igualdade exata ('beta@x.com') devolveria null ⇒
    // 'ignored'.
    await expect(svc.invite(OWNER_ID, { email: 'BETA@X.com ' }, NOW)).resolves.toBe('resent');
    expect(updates).toHaveLength(1); // a mesma linha do par foi reativada
  });

  it('entrada inválida (body sem email / campo extra): ZodError ANTES de tocar no banco', async () => {
    const m = make({ guest: guestUser });
    await expect(m.svc.invite(OWNER_ID, {}, NOW)).rejects.toBeInstanceOf(z.ZodError);
    await expect(
      m.svc.invite(OWNER_ID, { email: 'beta@x.com', extra: 1 }, NOW),
    ).rejects.toBeInstanceOf(z.ZodError);
    expect(m.user.findUnique).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// accept / decline — A.7/A.8, falha genérica única (A.5)
// ---------------------------------------------------------------------------

const TOKEN = 'ab'.repeat(32);
const HASH = sha256Hex(TOKEN);
const acceptBody = { token: TOKEN };

function liveLink(over: Record<string, unknown> = {}) {
  return linkRow({ tokenHash: HASH, ...over });
}

describe('SharedAgendasService.accept', () => {
  it('token vivo do convidado da sessão: CAS → active, acceptedAt, token zerado + audit invite_accepted', async () => {
    const { svc, sharedAgenda, auditEvents } = make({ link: liveLink() });
    await expect(svc.accept(acceptBody, GUEST_ID, NOW)).resolves.toBeUndefined();
    expect(sharedAgenda.updateMany).toHaveBeenCalledWith({
      where: { id: LINK_ID, status: 'pending', tokenHash: HASH, inviteExpiresAt: { gt: NOW } },
      data: { status: 'active', acceptedAt: NOW, tokenHash: null, inviteExpiresAt: null },
    });
    expect(auditEvents.map((e) => e.kind)).toEqual(['invite_accepted']);
    expect(auditEvents[0]!.actorId).toBe(GUEST_ID);
  });

  it('token para OUTRO convidado: falha genérica, nada muda (A.5/A.7)', async () => {
    const { svc, sharedAgenda } = make({ link: liveLink() });
    await expect(svc.accept(acceptBody, OTHER_ID, NOW)).rejects.toBeInstanceOf(
      SharedInviteInvalidError,
    );
    expect(sharedAgenda.updateMany).not.toHaveBeenCalled();
  });

  it('token EXPIRADO: a MESMA falha genérica + effectiveStatus revoked + traco invite_expired_auto (idempotente)', async () => {
    const dead = liveLink({ inviteExpiresAt: new Date(NOW.getTime() - 1) });
    const m1 = make({ link: dead });
    await expect(m1.svc.accept(acceptBody, GUEST_ID, NOW)).rejects.toBeInstanceOf(
      SharedInviteInvalidError,
    );
    expect(m1.auditEvents.map((e) => e.kind)).toEqual(['invite_expired_auto']);

    // 2º aceite do mesmo convite morto: NÃO duplica o traço (findFirst acha o anterior)
    const m2 = make({ link: dead, events: [{ occurredAt: NOW, kind: 'invite_expired_auto' }] });
    await expect(m2.svc.accept(acceptBody, GUEST_ID, NOW)).rejects.toBeInstanceOf(
      SharedInviteInvalidError,
    );
    expect(m2.auditEvents).toHaveLength(0);
  });

  it('borda exata do TTL (inviteExpiresAt === relógio do aceite): morto — CAS nem tentado', async () => {
    // O CAS exige `inviteExpiresAt: { gt: NOW }` — exactly-at-expiry é morto
    // (> estrito, espelho do inviteIsLive puro). Achar o pendente E não gravar
    // prova que a expiração é a razão da recusa (outro sabor = findFirst null).
    const dead = liveLink({ inviteExpiresAt: NOW });
    const { svc, sharedAgenda, auditEvents } = make({ link: dead });
    await expect(svc.accept(acceptBody, GUEST_ID, NOW)).rejects.toBeInstanceOf(
      SharedInviteInvalidError,
    );
    expect(sharedAgenda.findFirst).toHaveBeenCalled(); // link real achado — a borda o matou
    expect(sharedAgenda.updateMany).not.toHaveBeenCalled();
    expect(auditEvents.map((e) => e.kind)).toEqual(['invite_expired_auto']);
  });

  it('token USADO (busca por hash não acha: tokenHash zerado pós-aceite): mesma falha genérica', async () => {
    const { svc } = make({ link: null }); // linha existe mas tokenHash é outro/null → findFirst por hash devolve null
    await expect(svc.accept(acceptBody, GUEST_ID, NOW)).rejects.toBeInstanceOf(
      SharedInviteInvalidError,
    );
  });

  it('CAS perdido (corrida aceitou antes): updateMany count 0 → mesma falha genérica, sem audit', async () => {
    const { svc, auditEvents } = make({ link: liveLink(), casCount: 0 });
    await expect(svc.accept(acceptBody, GUEST_ID, NOW)).rejects.toBeInstanceOf(
      SharedInviteInvalidError,
    );
    expect(auditEvents).toHaveLength(0);
  });

  it('body inválido (token curto / campo extra): ZodError antes do banco', async () => {
    const { svc, sharedAgenda } = make({ link: liveLink() });
    await expect(svc.accept({ token: 'curto' }, GUEST_ID, NOW)).rejects.toBeInstanceOf(z.ZodError);
    expect(sharedAgenda.findFirst).not.toHaveBeenCalled();
  });
});

describe('SharedAgendasService.decline', () => {
  it('token vivo: CAS → revoked + revokedAt + token zerado + audit invite_declined', async () => {
    const { svc, sharedAgenda, auditEvents } = make({ link: liveLink() });
    await expect(svc.decline(acceptBody, GUEST_ID, NOW)).resolves.toBeUndefined();
    expect(sharedAgenda.updateMany).toHaveBeenCalledWith({
      where: { id: LINK_ID, status: 'pending', tokenHash: HASH, inviteExpiresAt: { gt: NOW } },
      data: { status: 'revoked', revokedAt: NOW, tokenHash: null, inviteExpiresAt: null },
    });
    expect(auditEvents.map((e) => e.kind)).toEqual(['invite_declined']);
  });

  it('todos os sabores (outro convidado/expirado/usado/CAS 0): a MESMA falha genérica', async () => {
    await expect(
      make({ link: liveLink() }).svc.decline(acceptBody, OTHER_ID, NOW),
    ).rejects.toBeInstanceOf(SharedInviteInvalidError);
    await expect(
      make({ link: liveLink({ inviteExpiresAt: new Date(NOW.getTime() - 1) }) }).svc.decline(
        acceptBody,
        GUEST_ID,
        NOW,
      ),
    ).rejects.toBeInstanceOf(SharedInviteInvalidError);
    await expect(
      make({ link: null }).svc.decline(acceptBody, GUEST_ID, NOW),
    ).rejects.toBeInstanceOf(SharedInviteInvalidError);
    await expect(
      make({ link: liveLink(), casCount: 0 }).svc.decline(acceptBody, GUEST_ID, NOW),
    ).rejects.toBeInstanceOf(SharedInviteInvalidError);
  });
});

// ---------------------------------------------------------------------------
// revoke — A.9 (dono revoga / convidado sai / dono cancela pendente)
// ---------------------------------------------------------------------------

describe('SharedAgendasService.revoke', () => {
  it('dono revoga active: revoked + revokedAt + token null + audit access_revoked (ator=dono)', async () => {
    const { svc, sharedAgenda, auditEvents } = make({
      link: linkRow({ status: 'active', tokenHash: null }),
    });
    await expect(svc.revoke(OWNER_ID, LINK_ID, NOW)).resolves.toBeUndefined();
    expect(sharedAgenda.update).toHaveBeenCalledWith({
      where: { id: LINK_ID },
      data: { status: 'revoked', revokedAt: NOW, tokenHash: null, inviteExpiresAt: null },
    });
    expect(auditEvents.map((e) => e.kind)).toEqual(['access_revoked']);
    expect(auditEvents[0]!.actorId).toBe(OWNER_ID);
  });

  it('convidado sai de active: MESMO endpoint, audit guest_left (ator=convidado)', async () => {
    const { svc, auditEvents } = make({ link: linkRow({ status: 'active', tokenHash: null }) });
    await expect(svc.revoke(GUEST_ID, LINK_ID, NOW)).resolves.toBeUndefined();
    expect(auditEvents.map((e) => e.kind)).toEqual(['guest_left']);
    expect(auditEvents[0]!.actorId).toBe(GUEST_ID);
  });

  it('dono cancela pending VIVA (revogável só pelo dono): → revoked', async () => {
    const { svc } = make({ link: linkRow() });
    await expect(svc.revoke(OWNER_ID, LINK_ID, NOW)).resolves.toBeUndefined();
  });

  it('convidado tentando revogar pending: 404 genérico (use o decline com token)', async () => {
    const { svc, sharedAgenda } = make({ link: linkRow() });
    await expect(svc.revoke(GUEST_ID, LINK_ID, NOW)).rejects.toBeInstanceOf(NotFoundException);
    expect(sharedAgenda.update).not.toHaveBeenCalled();
  });

  it('pending MORTA (effective=revoked): 404 — já era recusado (A.5)', async () => {
    const { svc } = make({ link: linkRow({ inviteExpiresAt: new Date(NOW.getTime() - 1) }) });
    await expect(svc.revoke(OWNER_ID, LINK_ID, NOW)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('linha inexistente OU de terceiros: o MESMO 404 (sem oráculo)', async () => {
    await expect(make({ link: null }).svc.revoke(OWNER_ID, LINK_ID, NOW)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      make({ link: linkRow() }).svc.revoke(OTHER_ID, LINK_ID, NOW),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // ---------- aviso A.3: mensagem leve SÓ para quem perdeu o acesso ----------

  it('A.3 dono revoga active: CONVIDADO recebe sharedAccessEnded(‹nome do dono›) — sem conteúdo de compromisso', async () => {
    const { svc, telegramSent } = make({ link: linkRow({ status: 'active', tokenHash: null }) });
    await svc.revoke(OWNER_ID, LINK_ID, NOW);
    expect(telegramSent).toHaveLength(1);
    expect(telegramSent[0]!.chatId).toBe('t-beta'); // só o convidado
    expect(telegramSent[0]!.text).toBe('O acesso à agenda de Dona foi encerrado.');
  });

  it('A.3 convidado sai de active: DONO recebe sharedGuestLeft(‹nome do convidado›) — nome vem do ator', async () => {
    const { svc, telegramSent, user } = make({ link: linkRow({ status: 'active', tokenHash: null }) });
    // o ator (convidado) tem nome na tabela — o nome citado é o do ATOR, não da linha
    (user.findUnique as jest.Mock).mockImplementation(
      async (args: { where: Record<string, unknown> }) => {
        if ('id' in args.where) {
          if (args.where.id === GUEST_ID)
            return { id: GUEST_ID, telegramId: 't-beta', name: 'Bia', email: 'beta@x.com' };
          if (args.where.id === OWNER_ID)
            return { id: OWNER_ID, telegramId: 't-dono', name: 'Dona', email: 'dono@x.com' };
        }
        return null;
      },
    );
    await svc.revoke(GUEST_ID, LINK_ID, NOW);
    expect(telegramSent).toHaveLength(1);
    expect(telegramSent[0]!.chatId).toBe('t-dono'); // só o dono (quem perdeu o acesso)
    expect(telegramSent[0]!.text).toBe('Bia saiu do compartilhamento da sua agenda.');
  });

  it('A.3 ator sem nome: cita o e-mail (identificador neutro), nunca "null"', async () => {
    const { svc, telegramSent } = make({ link: linkRow({ status: 'active', tokenHash: null }) });
    await svc.revoke(OWNER_ID, LINK_ID, NOW); // sessionUser tem name 'Dona' — versão sem nome abaixo
    expect(telegramSent[0]!.text).toContain('Dona');

    const m2 = make({
      session: { id: OWNER_ID, email: 'dono@x.com', name: null },
      link: linkRow({ status: 'active', tokenHash: null }),
    });
    await m2.svc.revoke(OWNER_ID, LINK_ID, NOW);
    expect(m2.telegramSent).toHaveLength(1);
    expect(m2.telegramSent[0]!.text).toContain('dono@x.com');
    expect(m2.telegramSent[0]!.text).not.toContain('null');
  });

  it('A.3 dono cancela PENDING viva: NINGUÉM é avisado (nenhum acesso nasceu)', async () => {
    const { svc, telegramSent } = make({ link: linkRow() });
    await svc.revoke(OWNER_ID, LINK_ID, NOW);
    expect(telegramSent).toHaveLength(0);
  });

  it('A.3 perdedor sem telegramId: pula silencioso, revoke acontece normal', async () => {
    const { svc, user, sharedAgenda } = make({ link: linkRow({ status: 'active', tokenHash: null }) });
    (user.findUnique as jest.Mock).mockImplementation(async (args: { where: Record<string, unknown> }) => {
      if ('id' in args.where) {
        if (args.where.id === OWNER_ID) return { name: 'Dona', email: 'dono@x.com' };
        if (args.where.id === GUEST_ID) return { telegramId: null }; // convidado sem bot
        return null;
      }
      return null;
    });
    await expect(svc.revoke(OWNER_ID, LINK_ID, NOW)).resolves.toBeUndefined();
    expect(sharedAgenda.update).toHaveBeenCalledTimes(1);
  });

  it('A.3 Telegram falha: best-effort — o 204 do revoke não estoura', async () => {
    const { svc, telegram, sharedAgenda } = make({ link: linkRow({ status: 'active', tokenHash: null }) });
    (telegram.sendMessage as jest.Mock).mockRejectedValue(new Error('telegram 429'));
    await expect(svc.revoke(OWNER_ID, LINK_ID, NOW)).resolves.toBeUndefined();
    expect(sharedAgenda.update).toHaveBeenCalledTimes(1);
  });

  it('A.3 nome do ator escapado (gotcha 6): `Ana <x>` não vira markup no HTML do Telegram', async () => {
    const { svc, telegramSent } = make({
      session: { id: OWNER_ID, email: 'dono@x.com', name: 'Ana <x>' },
      link: linkRow({ status: 'active', tokenHash: null }),
    });
    await svc.revoke(OWNER_ID, LINK_ID, NOW);
    expect(telegramSent[0]!.text).toContain('Ana &lt;x&gt;');
    expect(telegramSent[0]!.text).not.toContain('<x>');
  });
});

// ---------------------------------------------------------------------------
// list — A.10 + A2 + A5
// ---------------------------------------------------------------------------

describe('SharedAgendasService.list', () => {
  it('enviado PENDENTE: contraparte só email, SEM nome (A2)', async () => {
    const { svc } = make({ links: [linkRow()] });
    const out = await svc.list(OWNER_ID, NOW);
    expect(out.sent).toHaveLength(1);
    expect(out.sent[0]!.contraparte).toEqual({ email: 'beta@x.com' });
    expect(out.sent[0]!.status).toBe('pending');
    // ownerId = dono da LINHA mesmo no enviado (a web usa so no recebido — B.12)
    expect(out.sent[0]!.ownerId).toBe(OWNER_ID);
    expect(out.received).toHaveLength(0);
  });

  it('recebido: contraparte com o NOME do dono', async () => {
    const { svc } = make({
      links: [linkRow({ status: 'active', ownerId: OWNER_ID, guestId: GUEST_ID })],
    });
    const out = await svc.list(GUEST_ID, NOW);
    expect(out.received).toHaveLength(1);
    expect(out.received[0]!.contraparte).toEqual({ name: 'Dona' });
    expect(out.received[0]!.status).toBe('active');
    // uuid do DONO da linha (nao do convidado) — e isso que a web manda em `?owner=`
    expect(out.received[0]!.ownerId).toBe(OWNER_ID);
  });

  it('pending MORTA aparece revoked (D4/A5) — inclusive com timestamps preservados', async () => {
    const dead = linkRow({ inviteExpiresAt: new Date(NOW.getTime() - 1000) });
    const { svc } = make({ links: [dead] });
    const out = await svc.list(OWNER_ID, NOW);
    expect(out.sent[0]!.status).toBe('revoked');
    expect(out.sent[0]!.inviteExpiresAt).toEqual(dead.inviteExpiresAt);
  });

  it('saída passa no sharedAgendaListSchema dos contracts (dois sentidos no mesmo usuário)', async () => {
    const { sharedAgendaListSchema } = await import('@agendabo/contracts');
    const { svc } = make({
      links: [
        linkRow({ id: LINK_ID }),
        linkRow({
          id: 'bbbbbbbb-0000-4000-8000-000000000002',
          status: 'active',
          ownerId: OTHER_ID,
          guestId: OWNER_ID,
        }),
      ],
    });
    const out = await svc.list(OWNER_ID, NOW);
    expect(out.sent).toHaveLength(1);
    expect(out.received).toHaveLength(1);
    // cada lado carrega o dono da PROPRIA linha (o recebido e de OTHER_ID)
    expect(out.sent[0]!.ownerId).toBe(OWNER_ID);
    expect(out.received[0]!.ownerId).toBe(OTHER_ID);
    expect(sharedAgendaListSchema.safeParse(out).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// activeLinkBetween (helper da Etapa 3) + ordem de auditoria do fluxo
// ---------------------------------------------------------------------------

describe('SharedAgendasService.activeLinkBetween (helper Etapa 3)', () => {
  it('vínculo active real → { id }; inexistente → null', async () => {
    const ok = make({ link: linkRow({ status: 'active', tokenHash: null }) });
    await expect(ok.svc.activeLinkBetween(OWNER_ID, GUEST_ID, NOW)).resolves.toEqual({
      id: LINK_ID,
    });
    const none = make({ link: null });
    await expect(none.svc.activeLinkBetween(OWNER_ID, GUEST_ID, NOW)).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// activeIncomingLinks (helper Etapa 4: digest E.23 + consulta E.24)
// ---------------------------------------------------------------------------

describe('SharedAgendasService.activeIncomingLinks (helper Etapa 4)', () => {
  it('retorna { id, ownerId, ownerName } dos vínculos recebidos ativos (nome do dono)', async () => {
    const { svc } = make({
      links: [linkRow({ status: 'active', tokenHash: null, inviteExpiresAt: null })],
    });
    // o mock padrão de user.findMany devolve [sessionUser('Dona'), guestUser]
    const links = await svc.activeIncomingLinks(GUEST_ID, NOW);
    expect(links).toEqual([{ id: LINK_ID, ownerId: OWNER_ID, ownerName: 'Dona' }]);
  });

  it('sem vínculos recebidos → lista vazia (uma query sharedAgenda, zero user.findMany)', async () => {
    const { svc, sharedAgenda, user } = make({ links: [] });
    await expect(svc.activeIncomingLinks(GUEST_ID, NOW)).resolves.toEqual([]);
    expect(sharedAgenda.findMany).toHaveBeenCalledTimes(1);
    expect(user.findMany).not.toHaveBeenCalled();
  });

  it('dono sumido do banco → ownerName null (a pura de alvo nunca casa null; sem e-mail do dono na saída)', async () => {
    const { svc, user } = make({ links: [linkRow({ status: 'active', tokenHash: null })] });
    (user.findMany as jest.Mock).mockResolvedValue([]);
    await expect(svc.activeIncomingLinks(GUEST_ID, NOW)).resolves.toEqual([
      { id: LINK_ID, ownerId: OWNER_ID, ownerName: null },
    ]);
  });

  it('a query é guestId+status active com ordem estável (createdAt asc)', async () => {
    const { svc, sharedAgenda } = make({ links: [linkRow({ status: 'active', tokenHash: null })] });
    await svc.activeIncomingLinks(GUEST_ID, NOW);
    const args = sharedAgenda.findMany.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.where).toEqual({ guestId: GUEST_ID, status: 'active' });
    expect(args.orderBy).toEqual({ createdAt: 'asc' });
  });
});

describe('auditoria do fluxo completo (F.4 — kinds na ordem)', () => {
  it('invite → accept → revoke: invite_created → invite_accepted → access_revoked', async () => {
    const m = make({ guest: guestUser });
    await m.svc.invite(OWNER_ID, inviteBody, NOW);
    const token = tokenIn(m.mails[0]!.html);
    // o aceite encontra a linha pelo hash do token do e-mail (mesma série do fluxo real)
    const link = linkRow({ tokenHash: sha256Hex(token) });
    const m2 = make({ link });
    await m2.svc.accept({ token }, GUEST_ID, NOW);
    const m3 = make({ link: linkRow({ status: 'active', tokenHash: null }) });
    await m3.svc.revoke(OWNER_ID, LINK_ID, NOW);

    expect(m.auditEvents.map((e) => e.kind)).toEqual(['invite_created']);
    expect(m2.auditEvents.map((e) => e.kind)).toEqual(['invite_accepted']);
    expect(m3.auditEvents.map((e) => e.kind)).toEqual(['access_revoked']);
  });
});

function ev(minAgo: number) {
  return { occurredAt: new Date(NOW.getTime() - minAgo * 60_000) };
}
