import { hashToken } from './auth.service';
import { AuthSessionsService } from './auth-sessions.service';
import { z } from 'zod';
import { activeSessionSchema, revokeOtherSessionsResultSchema } from '@agendabo/contracts';

/**
 * Gestão de sessões ativas (spec sessão-24h, decisão humana nº 2): o refresh token
 * É a sessão (1 linha por device, sem tabela nova). Mock plano no padrão do repo;
 * `hashRefreshToken` usa o algoritmo REAL (HMAC) para o match de `current` e o
 * zod dos contracts de verdade para provar a borda. Relógio congelado via spy no
 * `now()` protected (D1 do plano).
 */

const NOW = new Date('2026-10-11T12:00:00Z');
const SECRET = 'secret-de-teste-1234567890';

type Row = Record<string, unknown>;

let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

function row(over: Row = {}): Row {
  return {
    id: uuid(),
    tokenHash: 'hash-qualquer',
    userId: 'u1',
    ip: '200.0.0.1',
    userAgent: 'Mozilla/5.0 Chrome/130',
    loginAt: new Date('2026-10-11T08:00:00Z'),
    ...over,
  };
}

/** Congela o `now()` protected (mesma técnica do spec de sessão do signup). */
function freezeSessionsNow(svc: AuthSessionsService) {
  const target = svc as unknown as Record<string, () => Date>;
  target.now = jest.fn(() => NOW);
}

function make(rows: Row[] = [], deleteCount = 0) {
  const findMany = jest.fn().mockResolvedValue(rows);
  const deleteMany = jest.fn().mockResolvedValue({ count: deleteCount });
  const findUnique = jest.fn().mockResolvedValue(null);
  const prisma = { refreshToken: { findMany, deleteMany, findUnique } };
  const auth = { hashRefreshToken: (t: string) => hashToken(t, SECRET) };
  const svc = new AuthSessionsService(prisma as never, auth as never);
  freezeSessionsNow(svc);
  return { svc, findMany, deleteMany, findUnique };
}

// ---------------------------------------------------------------------------
// listSessions — POST /auth/sessions
// ---------------------------------------------------------------------------

describe('AuthSessionsService.listSessions', () => {
  it('where do Gherkin: só linhas do usuário NÃO expiradas, ordenadas por loginAt desc', async () => {
    const { svc, findMany } = make();
    await svc.listSessions('u1', undefined);
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 'u1', expiresAt: { gt: NOW } },
      select: { id: true, tokenHash: true, ip: true, userAgent: true, loginAt: true },
      orderBy: { loginAt: 'desc' },
    });
  });

  it('current=true EXATAMENTE na linha cujo tokenHash bate com o hash do cookie; tokenHash nunca vaza', async () => {
    const cookieHash = hashToken('token-da-sessao-a', SECRET);
    const { svc } = make([row({ tokenHash: cookieHash }), row({ tokenHash: 'hash-outra' })]);
    const res = await svc.listSessions('u1', 'token-da-sessao-a');
    // valida contra o contract REAL (a borda zod do service)
    expect(res).toEqual(z.object({ items: z.array(activeSessionSchema) }).parse(res));
    expect(res.items.map((i) => i.current)).toEqual([true, false]);
    expect(res.items[0]).not.toHaveProperty('tokenHash');
  });

  it('sem cookie: lista completa e nenhum current (D5 — a sessão atual pode ter morrido no teto)', async () => {
    const { svc } = make([row()]);
    const res = await svc.listSessions('u1', undefined);
    expect(res.items.every((i) => i.current === false)).toBe(true);
  });

  it('cookie desconhecido (linha já revogada): mesma lista, nenhum current — nunca falha', async () => {
    const { svc } = make([row({ tokenHash: 'hash-vivo' })]);
    const res = await svc.listSessions('u1', 'token-morto');
    expect(res.items.map((i) => i.current)).toEqual([false]);
  });
});

// ---------------------------------------------------------------------------
// revokeOthers — DELETE /auth/sessions
// ---------------------------------------------------------------------------

describe('AuthSessionsService.revokeOthers', () => {
  it('com cookie: deleteMany NOT tokenHash do cookie (mantém a sessão da chamada) e { revoked }', async () => {
    const { svc, deleteMany } = make([], 2);
    const res = await svc.revokeOthers('u1', 'token-vivo');
    expect(deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', NOT: { tokenHash: hashToken('token-vivo', SECRET) } },
    });
    expect(res).toEqual(revokeOtherSessionsResultSchema.parse(res));
    expect(res).toEqual({ revoked: 2 });
  });

  it('sem cookie: revoga TODOS os tokens do usuário (D5)', async () => {
    const { svc, deleteMany } = make([], 3);
    const res = await svc.revokeOthers('u1', undefined);
    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(res).toEqual({ revoked: 3 });
  });
});

// ---------------------------------------------------------------------------
// revokeAllByRefreshToken — POST /auth/logout (bug corrigido)
// ---------------------------------------------------------------------------

describe('AuthSessionsService.revokeAllByRefreshToken', () => {
  it('cookie válido: deleteMany de TODOS os refresh_tokens do usuário e retorna o userId', async () => {
    const { svc, findUnique, deleteMany } = make([], 3);
    findUnique.mockResolvedValue({ userId: 'u1' });
    const res = await svc.revokeAllByRefreshToken('token-vivo');
    expect(findUnique).toHaveBeenCalledWith({
      where: { tokenHash: hashToken('token-vivo', SECRET) },
      select: { userId: true },
    });
    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(res).toEqual({ userId: 'u1' });
  });

  it('sem cookie: { userId: null }, nenhuma query, nenhum throw (logout nunca 401)', async () => {
    const { svc, findUnique, deleteMany } = make();
    await expect(svc.revokeAllByRefreshToken(undefined)).resolves.toEqual({ userId: null });
    expect(findUnique).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('cookie desconhecido: { userId: null } e nenhum delete (token morto não atrapalha o logout)', async () => {
    const { svc, deleteMany } = make(); // findUnique default = null
    await expect(svc.revokeAllByRefreshToken('token-morto')).resolves.toEqual({ userId: null });
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
