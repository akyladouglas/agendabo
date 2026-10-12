import { describe, expect, it } from 'vitest';
import {
  SHARED_AUDIT_KINDS,
  parseSharedAuditMetadata,
  sharedAgendaListItemSchema,
  sharedAgendaRoleSchema,
  sharedAgendaStatusSchema,
  sharedAppointmentListResultSchema,
  sharedAuditPageSchema,
  sharedAuditQuerySchema,
  sharedInviteInputSchema,
  sharedInviteTokenSchema,
} from './shared-agendas';

/**
 * Contratos do compartilhamento de agenda (spec
 * `.ia/specs/compartilhamento/compartilhamento-agenda-par.spec.md`, blocos A,
 * B.13, F.4). O que importa AQUI: a metadata de auditoria nao aceita conteudo
 * de compromisso (.strict por kind, so ids/quantidades) e o payload emprestado
 * NAO sobrevive com rawText/reviewReason (o strip do zod de resposta descarta
 * os campos de revisao do dono — ausencia estrutural na web, decisao P5).
 */

const OWNER_ID = '3f0f1e2c-1111-4aaa-8bbb-ccccdddd0001';
const GUEST_ID = '3f0f1e2c-2222-4aaa-8bbb-ccccdddd0002';
const LINK_ID = '3f0f1e2c-3333-4aaa-8bbb-ccccdddd0003';

describe('SHARED_AUDIT_KINDS (F.4 — constante testavel)', () => {
  it('sao exatamente os 11 kinds da spec, sem duplicata', () => {
    expect(SHARED_AUDIT_KINDS).toEqual([
      'invite_created',
      'invite_resent',
      'invite_email_failed',
      'invite_accepted',
      'invite_declined',
      'invite_expired_auto',
      'access_revoked',
      'guest_left',
      'access_read',
      'write_denied',
      'shared_section_built',
    ]);
    expect(new Set(SHARED_AUDIT_KINDS).size).toBe(11);
  });
});

describe('parseSharedAuditMetadata (gate anti-conteudo da F.4)', () => {
  /** Payload minimo valido de CADA um dos 11 kinds (matriz). */
  const VALID: Record<(typeof SHARED_AUDIT_KINDS)[number], unknown> = {
    invite_created: {},
    invite_resent: { invitesInWindow: 2 },
    invite_email_failed: {},
    invite_accepted: {},
    invite_declined: {},
    invite_expired_auto: {},
    access_revoked: {},
    guest_left: {},
    access_read: { count: 7 },
    write_denied: {},
    shared_section_built: { count: 0 },
  };

  it('aceita o payload valido de cada um dos 11 kinds', () => {
    for (const kind of SHARED_AUDIT_KINDS) {
      expect(() => parseSharedAuditMetadata(kind, VALID[kind])).not.toThrow();
    }
    expect(parseSharedAuditMetadata('access_read', { count: 7 })).toEqual({ count: 7 });
    expect(parseSharedAuditMetadata('invite_resent', {})).toEqual({});
  });

  it('campo desconhecido e rejeitado (.strict) — conteudo disfarcado nao entra', () => {
    for (const kind of SHARED_AUDIT_KINDS) {
      expect(() => parseSharedAuditMetadata(kind, { titulo: 'Consulta no dentista' })).toThrow();
      expect(() =>
        parseSharedAuditMetadata(kind, { ...VALID[kind], rawText: 'marca ai amanha as 10' }),
      ).toThrow();
    }
  });

  it('string livre nunca passa (so uuid/int/bool/enum/ISO tem forma de existir)', () => {
    // kinds sem campo proprio recusam QUALQUER string; kinds com campo recusam
    // o tipo errado (count nao e string, invitesInWindow nao e texto).
    expect(() => parseSharedAuditMetadata('invite_created', { motivo: 'convidei' })).toThrow();
    expect(() => parseSharedAuditMetadata('access_read', { count: '7' })).toThrow();
    expect(() => parseSharedAuditMetadata('access_read', { count: -1 })).toThrow();
    expect(() => parseSharedAuditMetadata('access_read', {})).toThrow(); // count obrigatorio
    expect(() => parseSharedAuditMetadata('invite_resent', { invitesInWindow: 'muitos' })).toThrow();
  });
});

describe('sharedInviteInputSchema / sharedInviteTokenSchema (bordas strict)', () => {
  it('invite: so email — chave extra recusa', () => {
    expect(sharedInviteInputSchema.parse({ email: 'a@b.com' })).toEqual({ email: 'a@b.com' });
    // M1 (review): emailSchema do cadastro (trim+lowercase) — "Email@Upper "
    // parseia NORMALIZADO, igual ao que o servico busca no banco.
    expect(sharedInviteInputSchema.parse({ email: 'Email@Exemplo.Com ' })).toEqual({
      email: 'email@exemplo.com',
    });
    expect(() => sharedInviteInputSchema.parse({ email: 'nao-e-email' })).toThrow();
    expect(() => sharedInviteInputSchema.parse({})).toThrow();
    expect(() => sharedInviteInputSchema.parse({ email: 'a@b.com', telegramId: '123' })).toThrow();
  });

  it('token: body strict aceita { token } e recusa { token, id } (D10 — nada de id de vinculo)', () => {
    const token = 'a'.repeat(64);
    expect(sharedInviteTokenSchema.parse({ token })).toEqual({ token });
    expect(() => sharedInviteTokenSchema.parse({ token, id: LINK_ID })).toThrow();
    expect(() => sharedInviteTokenSchema.parse({ token: 'curto' })).toThrow();
    expect(() => sharedInviteTokenSchema.parse({ token: 'x'.repeat(129) })).toThrow();
    expect(() => sharedInviteTokenSchema.parse({})).toThrow();
  });
});

describe('sharedAgendaStatusSchema / sharedAgendaRoleSchema (enums fechados)', () => {
  it('status: exatamente pending/active/revoked', () => {
    for (const s of ['pending', 'active', 'revoked']) {
      expect(sharedAgendaStatusSchema.parse(s)).toBe(s);
    }
    expect(() => sharedAgendaStatusSchema.parse('expired')).toThrow();
    expect(() => sharedAgendaStatusSchema.parse('read')).toThrow();
  });

  it('papel de posicao: owner|guest (papel do convite e fixo read — P1)', () => {
    expect(sharedAgendaRoleSchema.parse('owner')).toBe('owner');
    expect(sharedAgendaRoleSchema.parse('guest')).toBe('guest');
    expect(() => sharedAgendaRoleSchema.parse('read')).toThrow();
    expect(() => sharedAgendaRoleSchema.parse('admin')).toThrow();
  });
});

describe('sharedAgendaListItemSchema (A.10 / decisao A2)', () => {
  const base = {
    id: LINK_ID,
    papel: 'owner' as const,
    status: 'pending' as const,
    inviteSentAt: '2026-10-12T00:00:00.000Z',
    inviteExpiresAt: '2026-10-13T00:00:00.000Z',
    createdAt: '2026-10-12T00:00:00.000Z',
    acceptedAt: null,
    revokedAt: null,
  };

  it('enviado pendente: SO email (sem nome) parseia — a UI mostra so o email (A2)', () => {
    const item = sharedAgendaListItemSchema.parse({
      ...base,
      contraparte: { email: 'convidado@ex.com' },
    });
    expect(item.contraparte.email).toBe('convidado@ex.com');
    expect('name' in item.contraparte).toBe(false);
  });

  it('recebido: nome do dono parseia (name pode ate ser null — conta sem nome)', () => {
    expect(
      sharedAgendaListItemSchema.parse({
        ...base,
        papel: 'guest',
        status: 'active',
        acceptedAt: '2026-10-12T02:00:00.000Z',
        inviteSentAt: null,
        inviteExpiresAt: null,
        contraparte: { name: 'Fulano' },
      }).contraparte.name,
    ).toBe('Fulano');
    expect(
      sharedAgendaListItemSchema.parse({ ...base, contraparte: { name: null } }).contraparte.name,
    ).toBe(null);
  });

  it('email invalido ou timestamp lixo recusa', () => {
    expect(() => sharedAgendaListItemSchema.parse({ ...base, contraparte: { email: 'x' } })).toThrow();
    expect(() => sharedAgendaListItemSchema.parse({ ...base, createdAt: 'ontem' })).toThrow();
  });

  // ownerId: uuid do dono da linha para a web montar `?owner=` (B.12; decisao
  // humana 2026-10-12). optional — o consumidor web trata fallback.
  it('ownerId: uuid valido aceita, string invalida recusa, ausente aceita', () => {
    const withOwner = sharedAgendaListItemSchema.parse({
      ...base,
      contraparte: { name: 'Fulano' },
      ownerId: OWNER_ID,
    });
    expect(withOwner.ownerId).toBe(OWNER_ID);
    expect(() =>
      sharedAgendaListItemSchema.parse({ ...base, ownerId: 'nao-e-uuid' }),
    ).toThrow();
    const withoutOwner = sharedAgendaListItemSchema.parse({ ...base, contraparte: {} });
    expect('ownerId' in withoutOwner).toBe(false);
  });
});

describe('sharedAppointmentListResultSchema (B.13 — payload emprestado)', () => {
  const item = {
    id: 'aaaaaaaa-1111-4aaa-8bbb-ccccdddd0001',
    title: 'Consulta',
    startsAt: '2026-10-12T14:00:00.000Z',
    endsAt: '2026-10-12T15:00:00.000Z',
    notes: null,
    status: 'confirmed' as const,
    createdAt: '2026-10-11T00:00:00.000Z',
  };

  it('aceita o subconjunto emprestado (datas ISO viram Date — isoDateSchema)', () => {
    const parsed = sharedAppointmentListResultSchema.parse({ items: [item] });
    expect(parsed.items).toHaveLength(1);
    const out = parsed.items[0]!;
    expect(out.title).toBe('Consulta');
    expect(out.status).toBe('confirmed');
    expect(out.startsAt).toBeInstanceOf(Date);
    expect(out.startsAt.toISOString()).toBe('2026-10-12T14:00:00.000Z');
  });

  it('rawText/reviewReason/notificationRules sao DESCRADOS pelo parse — ausencia estrutural na web', () => {
    // O zod de resposta e strip (padrao do repo): a garantia nao e "400 se vier
    // rawText", e "o objeto parseado NUNCA tem a chave". Mesmo que a consulta
    // do service errasse o select, a web nunca ve campo de revisao do dono.
    const leaked = sharedAppointmentListResultSchema.parse({
      items: [
        {
          ...item,
          rawText: 'texto original dito no bot',
          reviewReason: 'low_confidence',
          notificationRules: [{ id: OWNER_ID, type: 'none' }],
          origin: 'bot',
        },
      ],
    });
    const parsed = leaked.items[0] as Record<string, unknown>;
    expect('rawText' in parsed).toBe(false);
    expect('reviewReason' in parsed).toBe(false);
    expect('notificationRules' in parsed).toBe(false);
    expect('origin' in parsed).toBe(false);
    // os campos emprestados continuam la
    expect(parsed.title).toBe('Consulta');
  });

  it('status precisa ser do enum fechado (o service so emite confirmed — B.13)', () => {
    expect(() =>
      sharedAppointmentListResultSchema.parse({ items: [{ ...item, status: 'cancelled' }] }),
    ).toThrow();
  });
});

describe('sharedAuditQuerySchema / sharedAuditPageSchema (GET /shared-agendas/audit)', () => {
  it('exige sharedAgendaId uuid; default limit 20; teto 100', () => {
    expect(sharedAuditQuerySchema.parse({ sharedAgendaId: OWNER_ID })).toEqual({
      sharedAgendaId: OWNER_ID,
      limit: 20,
    });
    expect(() => sharedAuditQuerySchema.parse({ sharedAgendaId: 'nao-e-uuid' })).toThrow();
    expect(() => sharedAuditQuerySchema.parse({ sharedAgendaId: OWNER_ID, limit: 101 })).toThrow();
  });

  it('pagina: kind fechado + nextCursor nullable', () => {
    const page = sharedAuditPageSchema.parse({
      items: [
        {
          id: GUEST_ID,
          occurredAt: '2026-10-12T00:00:00.000Z',
          kind: 'access_read',
          metadata: { count: 3 },
        },
      ],
      nextCursor: null,
    });
    expect(page.items[0]?.kind).toBe('access_read');
    expect(() =>
      sharedAuditPageSchema.parse({
        items: [{ id: GUEST_ID, occurredAt: '2026-10-12T00:00:00.000Z', kind: 'whatever' }],
        nextCursor: null,
      }),
    ).toThrow();
  });
});
