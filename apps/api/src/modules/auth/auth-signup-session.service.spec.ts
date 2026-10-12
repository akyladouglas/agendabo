import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { hashToken } from './auth.service';
import { AuthSignupService, SessionExpiredError } from './auth-signup.service';
import type { Env } from '../../config/env.validation';

/**
 * Sessão rígida de 24h + e-mail de novo login no AuthSignupService (spec
 * sessão-24h, Gherkin API). Mock plano (padrão auth-signup.service.spec.ts):
 * Prisma/auth/mail/config falsos; relógio congelado via spy no `now()` protected
 * (D1 do plano); HMAC do refresh com segredo FIXO de teste para o match de
 * `current`/rotação ser o algoritmo real.
 */

const NOW = new Date('2026-10-11T12:00:00Z');
const SECRET = 'secret-de-teste-1234567890';
const H = 3_600_000;
/** Teto da cadeia criada agora: loginAt + 24h (default do env). */
const CAP = new Date(NOW.getTime() + 24 * H);

type Row = Record<string, unknown>;

interface Fx {
  /** Linhas pré-existentes de refresh_tokens do u1. */
  rows?: Row[];
  /** null = nenhuma linha (primeiro login). */
  user?: Row | null;
  mailFail?: boolean;
  /** override dos números de TTL do config (default: 30d / 24h). */
  refreshTtlDays?: number;
  absoluteTtlHours?: number;
}

function make(fx: Fx = {}) {
  const rows: Row[] = fx.rows ?? [];
  const created: Row[] = [];
  const deletedIds: string[] = [];
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(
        fx.user === undefined
          ? {
              id: 'u1',
              email: 'ana@exemplo.com',
              passwordHash: 'argon2-ok',
              telegramId: '123',
              name: 'Ana',
              timezone: 'America/Sao_Paulo',
              resumoDiarioHora: '08:00',
              resumoDiarioAtivo: true,
              isAdmin: false,
              emailConfirmedAt: new Date('2026-10-01T00:00:00Z'),
            }
          : fx.user,
      ),
    },
    refreshToken: {
      create: jest.fn(async (args: { data: Row }) => {
        created.push(args.data);
      }),
      findMany: jest.fn(async (args: { where: Record<string, unknown> }) => {
        // espelha o where real do service: só linhas do usuário NÃO expiradas
        const gt = (args.where.expiresAt as { gt?: Date } | undefined)?.gt;
        return rows.filter(
          (r) => r.userId === args.where.userId && (!gt || new Date(r.expiresAt as Date) > gt),
        );
      }),
      findUnique: jest.fn(
        async (args: { where: { tokenHash: string } }) =>
          rows.find((r) => r.tokenHash === args.where.tokenHash) ?? null,
      ),
      delete: jest.fn(async (args: { where: { id: string } }) => {
        deletedIds.push(args.where.id);
      }),
    },
    // rotação é $transaction ARRAY (delete + create) — o mock executa as ops
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => {
      await Promise.all(ops);
    }),
  };
  const auth = {
    verifyPassword: jest.fn(async (_h: string, p: string) => p === 'senha12345'),
    newRefreshToken: () => ({
      token: 'token-novo',
      tokenHash: hashToken('token-novo', SECRET),
    }),
    hashRefreshToken: (t: string) => hashToken(t, SECRET),
    signAccessToken: jest.fn(async () => 'jwt-de-acesso'),
  };
  const mails: { to: string; subject: string; text: string }[] = [];
  const mail = {
    send: jest.fn(async (msg: { to: string; subject: string; text: string }) => {
      if (fx.mailFail) throw new Error('Resend falhou: domain not verified');
      mails.push(msg);
    }),
  };
  const numbers: Record<string, number> = {
    REFRESH_TOKEN_TTL_DAYS: fx.refreshTtlDays ?? 30,
    SESSION_ABSOLUTE_TTL_HOURS: fx.absoluteTtlHours ?? 24,
  };
  const config = {
    get: jest.fn((key: string) => numbers[key]),
  } as unknown as ConfigService<Env, true>;
  const svc = new AuthSignupService(prisma as never, auth as never, mail as never, config);
  freezeNow(svc);
  return { svc, prisma, created, deletedIds, rows, mail, mails };
}

const LOGIN_BODY = { email: 'ana@exemplo.com', password: 'senha12345' };
const META = { ip: '201.1.2.3', userAgent: 'Mozilla/5.0 Chrome/130' };

/**
 * Congela o `now()` protected do service no relógio do teste (D1 do plano).
 * TS proíbe spyOn direto de membro protected pela instância tipada; o alvo é a
 *OwnProperty da instância (método no protótipo não é own — o descriptor é
 * instalado na instância e o jest a trata como spy restaurável).
 */
function freezeNow(svc: AuthSignupService) {
  const target = svc as unknown as Record<string, () => Date>;
  target.now = jest.fn(() => NOW);
}

// ---------------------------------------------------------------------------
// login — metadados de sessão
// ---------------------------------------------------------------------------

describe('AuthSignupService.login — metadados da sessão (spec sessão-24h)', () => {
  it('token nasce com loginAt=now, ip, userAgent e expiresAt=min(now+30d, teto)=o TETO; retorna refreshExpiresAt', async () => {
    const { svc, created } = make();
    const res = await svc.login(LOGIN_BODY, META);
    expect(created).toHaveLength(1);
    const data = created[0]!;
    expect(data.loginAt).toEqual(NOW);
    expect(data.ip).toBe('201.1.2.3');
    expect(data.userAgent).toBe('Mozilla/5.0 Chrome/130');
    // com o default 24h o teto (now+24h) CORTA o refreshTtl de 30d
    expect(data.expiresAt).toEqual(CAP);
    expect(res.refreshExpiresAt).toEqual(CAP);
    // resto do shape preservado (a controller devolve accessToken + user)
    expect(res.accessToken).toBe('jwt-de-acesso');
    expect(res.user.id).toBe('u1');
  });

  it('meta ausente grava null (sem crash)', async () => {
    const { svc, created } = make();
    await svc.login(LOGIN_BODY, {});
    expect(created[0]!.ip).toBeNull();
    expect(created[0]!.userAgent).toBeNull();
  });

  it('teto maior que o refreshTtl: expiresAt = now + refreshTtl (o min corta no TTL deslizante)', async () => {
    // 90d de teto, 30d de refresh → vence os 30d
    const { svc, created } = make({ absoluteTtlHours: 90 * 24, refreshTtlDays: 30 });
    const res = await svc.login(LOGIN_BODY, META);
    expect(created[0]!.expiresAt).toEqual(new Date(NOW.getTime() + 30 * 24 * H));
    expect(res.refreshExpiresAt).toEqual(new Date(NOW.getTime() + 30 * 24 * H));
  });
});

// ---------------------------------------------------------------------------
// login — e-mail de novo login (decisão humana nº 3 / D4 do plano)
// ---------------------------------------------------------------------------

const priorSession = (userAgent: string | null): Row => ({
  id: 's1',
  userId: 'u1',
  tokenHash: 'hash-s1',
  expiresAt: new Date(NOW.getTime() + 3 * H), // viva
  userAgent,
});

describe('AuthSignupService.login — e-mail de novo login', () => {
  it('sessão ativa de user-agent DIFERENTE: mail.send 1x "Novo login na sua conta" com ip, UA e o aviso', async () => {
    const { svc, mails } = make({ rows: [priorSession('Mozilla/5.0 Firefox/130')] });
    await svc.login(LOGIN_BODY, META);
    expect(mails).toHaveLength(1);
    const msg = mails[0]!;
    expect(msg.to).toBe('ana@exemplo.com');
    expect(msg.subject).toBe('Novo login na sua conta');
    expect(msg.text).toContain('201.1.2.3');
    expect(msg.text).toContain(META.userAgent);
    expect(msg.text).toContain('encerre as outras sessões em Perfil → Suas sessões');
  });

  it('sessão ativa do MESMO user-agent (ip diferente): nenhum e-mail (D4 — fingerprint é o UA)', async () => {
    const { svc, mails } = make({ rows: [priorSession(META.userAgent)] });
    await svc.login(LOGIN_BODY, { ip: '192.168.9.9', userAgent: META.userAgent });
    expect(mails).toHaveLength(0);
  });

  it('primeiro login (nenhuma linha anterior): nenhum e-mail', async () => {
    const { svc, mails } = make();
    await svc.login(LOGIN_BODY, META);
    expect(mails).toHaveLength(0);
  });

  it('mail.send lança: o login CONCLUI normalmente e loga em stderr (padrão sendNewCode)', async () => {
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const { svc, created, mail } = make({ rows: [priorSession('Firefox/130')], mailFail: true });
      await expect(svc.login(LOGIN_BODY, META)).resolves.toMatchObject({
        accessToken: 'jwt-de-acesso',
      });
      expect(mail.send).toHaveBeenCalledTimes(1);
      expect(created).toHaveLength(1);
      const logged = stderr.mock.calls.map((c) => String(c[0])).join('');
      expect(logged).toContain('[mail]');
    } finally {
      stderr.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// refresh — teto absoluto de 24h (decisão humana nº 1)
// ---------------------------------------------------------------------------

const OLD_HASH = hashToken('token-atual', SECRET);

const storedValid = (over: Row = {}): Row => ({
  id: 't1',
  userId: 'u1',
  tokenHash: OLD_HASH,
  expiresAt: new Date(NOW.getTime() + 3 * H),
  loginAt: new Date('2026-10-11T09:00:00Z'),
  ip: '10.0.0.1',
  userAgent: 'Chrome/129',
  user: {
    id: 'u1',
    email: 'ana@exemplo.com',
    telegramId: '123',
    name: 'Ana',
    timezone: 'America/Sao_Paulo',
    resumoDiarioHora: '08:00',
    resumoDiarioAtivo: true,
    isAdmin: false,
  },
  ...over,
});

describe('AuthSignupService.refresh — teto absoluto da cadeia', () => {
  it('now > loginAt + 24h: SessionExpiredError, a linha do token é DELETADA e nenhum create roda', async () => {
    const { svc, created, deletedIds, prisma } = make();
    prisma.refreshToken.findUnique.mockImplementation(
      async (args: { where: { tokenHash: string } }) =>
        args.where.tokenHash === OLD_HASH
          ? storedValid({ loginAt: new Date(NOW.getTime() - 25 * H) })
          : null,
    );
    await expect(svc.refresh('token-atual', META)).rejects.toBeInstanceOf(SessionExpiredError);
    expect(deletedIds).toEqual(['t1']);
    expect(created).toHaveLength(0);
  });

  it('now EXATAMENTE no teto: SessionExpiredError (expired = now >= cap)', async () => {
    const { svc, created } = make();
    makeStored(svc, storedValid({ loginAt: new Date(NOW.getTime() - 24 * H) }));
    await expect(svc.refresh('token-atual', META)).rejects.toBeInstanceOf(SessionExpiredError);
    expect(created).toHaveLength(0);
  });

  it('perto do teto: novo token com expiresAt EXATAMENTE o cap, loginAt HERDADO, UA/IP preservados', async () => {
    const loginAt = new Date('2026-10-11T11:00:00Z'); // cap = 23:00Z (1h de folga)
    const cap = new Date(loginAt.getTime() + 24 * H);
    const { svc, created, deletedIds } = make();
    makeStored(svc, storedValid({ loginAt }));
    const res = await svc.refresh('token-atual', { ip: null, userAgent: null });
    expect(created).toHaveLength(1);
    const data = created[0]!;
    expect(data.expiresAt).toEqual(cap); // o min corta no teto — asserção do Gherkin
    expect(data.loginAt).toEqual(loginAt); // herdado, nunca now
    expect(data.userAgent).toBe('Chrome/129'); // meta null → herda do token anterior
    expect(data.ip).toBe('10.0.0.1');
    expect(res.refreshExpiresAt).toEqual(cap);
    expect(deletedIds).toEqual(['t1']); // o token anterior é apagado na rotação
  });

  it('dentro do teto com folga: loginAt herdado e expiresAt = now + refreshTtl (30d intocado)', async () => {
    // folga REAL exige teto > 30d (senão o cap corta sempre): teto de 40d
    const loginAt = new Date(NOW.getTime() - 2 * H); // 2h de sessão
    const { svc, created } = make({ absoluteTtlHours: 40 * 24, refreshTtlDays: 30 });
    makeStored(svc, storedValid({ loginAt }));
    const res = await svc.refresh('token-atual', META);
    expect(created[0]!.expiresAt).toEqual(new Date(NOW.getTime() + 30 * 24 * H));
    expect(created[0]!.loginAt).toEqual(loginAt); // herdado, nunca now
    expect(res.refreshExpiresAt).toEqual(new Date(NOW.getTime() + 30 * 24 * H));
  });

  it('com o default de 24h, QUALQUER rotação morre no cap (now+30d é sempre cortado)', async () => {
    // loginAt = now - 1s: a cadeia tem 1s de vida; o min é SEMPRE o teto
    const loginAt = new Date(NOW.getTime() - 1_000);
    const { svc, created } = make(); // 30d / 24h (defaults do env)
    makeStored(svc, storedValid({ loginAt }));
    const res = await svc.refresh('token-atual', META);
    const cap = new Date(loginAt.getTime() + 24 * H);
    expect(created[0]!.expiresAt).toEqual(cap);
    expect(res.refreshExpiresAt).toEqual(cap);
  });

  it('token desconhecido: UnauthorizedException e NENHUMA escrita no banco', async () => {
    const { svc, created, deletedIds, prisma } = make();
    prisma.refreshToken.findUnique.mockResolvedValue(null);
    await expect(svc.refresh('token-fantasma', META)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(created).toHaveLength(0);
    expect(deletedIds).toHaveLength(0);
  });

  it('sem token no cookie: UnauthorizedException sem tocar no banco', async () => {
    const { svc, prisma } = make();
    await expect(svc.refresh(undefined, META)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.refreshToken.findUnique).not.toHaveBeenCalled();
  });
});

/** Aponta o findUnique do mock para UMA linha conhecida (hash OLD_HASH). */
function makeStored(svc: AuthSignupService, stored: Row | null) {
  // o svc carrega o prisma do `make()` via closure do teste — re-mocka por dentro
  const prisma = (svc as never as { prisma: { refreshToken: { findUnique: jest.Mock } } }).prisma;
  prisma.refreshToken.findUnique.mockImplementation(
    async (args: { where: { tokenHash: string } }) =>
      stored && args.where.tokenHash === OLD_HASH ? stored : null,
  );
}
