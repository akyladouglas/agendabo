import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { AuthPasswordResetService, ResetTokenInvalidError } from './auth-password-reset.service';
import { sha256Hex } from './auth.service';
import { RESET_TOKEN_TTL_MS } from './password-reset';

/**
 * "Esqueci a senha" — service de orquestração (spec esqueci-a-senha, critérios
 * Gherkin API). Mock plano (testing.md): Prisma/mail/telegram/config falsos;
 * zod dos contracts de verdade (o teste prova a borda); relógio congelado via
 * parâmetro `now` (nada de new Date() no teste).
 */

const NOW = new Date('2026-10-08T12:00:00Z');
const TOKEN = 'ab'.repeat(32); // 64 hexchars
const HASH = sha256Hex(TOKEN);

interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

interface Fixtures {
  user?: Record<string, unknown> | null;
  sends?: { sentAt: Date }[];
  stored?: Record<string, unknown> | null;
  mailFail?: boolean;
  telegramFail?: boolean;
  /** create lança P2002 (corrida no índice único parcial de code_hash). */
  createP2002?: boolean;
  /** quantos tokens o CAS do consumo encontra vivos (0 = corrida consumiu antes). */
  casCount?: number;
  /** true = a transacao usa callback (tx) — o mock repassa um tx com updateMany espiável. */
  txUpdates?: { count: number }[];
}

/** P2002 falso com a shape do Prisma (a instanceof exige a classe real). */
function p2002(): unknown {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '6.19.3',
  });
}

function make(fx: Fixtures = {}) {
  const created: Record<string, unknown>[] = [];
  const user = {
    findUnique: jest.fn().mockResolvedValue(fx.user ?? null),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const verificationCode = {
    findMany: jest.fn().mockResolvedValue(fx.sends ?? []),
    findFirst: jest.fn(async (args: { where: Record<string, unknown> }) => {
      // espelha o where real: token expirado NAO e encontrado (I3 do review);
      // o mock so devolve a linha quando o where bate no stored.
      const stored = fx.stored ?? null;
      if (!stored) return null;
      if (args.where.codeHash !== stored.codeHash) return null;
      if (args.where.kind !== stored.kind) return null;
      const expiresGt = (args.where.expiresAt as { gt?: Date } | undefined)?.gt;
      if (expiresGt && new Date(stored.expiresAt as Date) <= expiresGt) return null;
      return stored;
    }),
    create: jest.fn(async (args: { data: Record<string, unknown> }) => {
      if (fx.createP2002) throw p2002();
      created.push(args.data);
    }),
    update: jest.fn().mockResolvedValue(undefined),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const refreshToken = {
    deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
  };
  // $transaction com callback (tx) OU array de ops — a impl usa callback.
  const $transaction = jest.fn(
    async (arg: ((tx: unknown) => Promise<unknown>) | Promise<unknown>[]) => {
      if (typeof arg === 'function') {
        const casCount = fx.casCount ?? 1;
        let casDone = false;
        const tx = {
          verificationCode: {
            updateMany: jest.fn(async (args: { where: Record<string, unknown> }) => {
              // primeira chamada = CAS do token (id + usedAt:null + expiresAt gt)
              if (!casDone && 'id' in args.where) {
                casDone = true;
                return { count: casCount };
              }
              return { count: 1 };
            }),
          },
          user: { update: user.update },
          refreshToken: { deleteMany: refreshToken.deleteMany },
        };
        return arg(tx);
      }
      await Promise.all(arg);
    },
  );
  const mails: MailMessage[] = [];
  const mail = {
    send: jest.fn(async (msg: MailMessage) => {
      if (fx.mailFail) {
        mails.push(msg);
        throw new Error('Resend falhou: domain not verified');
      }
      mails.push(msg);
    }),
  };
  const telegramSent: { id: string; text: string }[] = [];
  const telegram = {
    sendMessage: jest.fn(async (id: string, text: string) => {
      if (fx.telegramFail) throw new Error('Telegram 401 blocked');
      telegramSent.push({ id, text });
    }),
  };
  const config = {
    get: jest.fn(() => 'http://localhost:5174'),
  };
  const auth = {
    hashPassword: jest.fn(async (p: string) => `argon2(${p})`),
    // codeMatches REAL (mesmo algoritmo de auth.service.ts): hash sha256 comparado
    codeMatches: (candidate: string, codeHash: string) => sha256Hex(candidate) === codeHash,
  };
  const svc = new AuthPasswordResetService(
    { user, verificationCode, refreshToken, $transaction } as never,
    auth as never,
    mail as never,
    telegram as never,
    config as never,
  );
  return {
    svc,
    user,
    verificationCode,
    refreshToken,
    $transaction,
    mail,
    mails,
    telegram,
    telegramSent,
    created,
    config,
  };
}

const confirmed = {
  id: 'u1',
  email: 'ana@x.com',
  telegramId: '123456789',
  emailConfirmedAt: new Date('2026-10-01T00:00:00Z'),
};

/** Extrai o token cru do link dentro do HTML do e-mail. */
function tokenIn(html: string): string {
  const m = /token=([0-9a-f]{64})/.exec(html);
  if (!m?.[1]) throw new Error('link com token de 64 hex nao encontrado no html');
  return m[1];
}

// ---------------------------------------------------------------------------
// POST /auth/forgot-password (requestReset)
// ---------------------------------------------------------------------------

describe('AuthPasswordResetService.requestReset', () => {
  it('conta confirmada: void silencioso => linha password_reset com sha256 do token, TTL 1h, e-mail com link WEB_ORIGIN', async () => {
    const { svc, created, mails, config } = make({ user: confirmed });
    await expect(svc.requestReset({ email: 'ana@x.com' }, NOW)).resolves.toBeUndefined();

    expect(created).toHaveLength(1);
    const row = created[0]!;
    expect(row.kind).toBe('password_reset');
    expect(row.email).toBe('ana@x.com');
    expect(row.expiresAt).toEqual(new Date(NOW.getTime() + RESET_TOKEN_TTL_MS));
    // hash sha256 de 64 hexchars — o token cru nunca é persistido
    expect(String(row.codeHash)).toMatch(/^[0-9a-f]{64}$/);

    expect(mails).toHaveLength(1);
    const msg = mails[0]!;
    expect(msg.to).toBe('ana@x.com');
    expect(config.get).toHaveBeenCalledWith('WEB_ORIGIN', { infer: true });
    // o link no e-mail carrega um token de 64 hex; a linha guarda o hash DESSE token
    const token = tokenIn(msg.html);
    expect(row.codeHash).toBe(sha256Hex(token));
    expect(msg.html).toContain('http://localhost:5174/redefinir-senha?token=');
  });

  it('e-mail inexistente: mesma saída void, nenhuma linha e nenhum envio (anti-enumeration)', async () => {
    const { svc, created, mails, verificationCode } = make({ user: null });
    await expect(svc.requestReset({ email: 'ninguem@x.com' }, NOW)).resolves.toBeUndefined();
    expect(created).toHaveLength(0);
    expect(mails).toHaveLength(0);
    expect(verificationCode.findMany).not.toHaveBeenCalled();
  });

  it('conta pendente de confirmação: void e nenhum envio', async () => {
    const { svc, created, mails } = make({
      user: { ...confirmed, emailConfirmedAt: null },
    });
    await svc.requestReset({ email: 'ana@x.com' }, NOW);
    expect(created).toHaveLength(0);
    expect(mails).toHaveLength(0);
  });

  it('quota estourada (2 envios nos últimos 10min): void silencioso, sem linha e sem envio', async () => {
    const envia = (m: number) => ({
      sentAt: new Date(NOW.getTime() - m * 60_000),
    });
    const { svc, created, mails } = make({
      user: confirmed,
      sends: [envia(8), envia(2)],
    });
    await svc.requestReset({ email: 'ana@x.com' }, NOW);
    expect(created).toHaveLength(0);
    expect(mails).toHaveLength(0);
  });

  it('MailService lança: nada estoura, o token fica criado/pendente e nada vaza (só log interno)', async () => {
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const { svc, created, mails } = make({ user: confirmed, mailFail: true });
      await expect(svc.requestReset({ email: 'ana@x.com' }, NOW)).resolves.toBeUndefined();
      expect(created).toHaveLength(1); // o token existe p/ o usuário reenviar depois
      expect(mails).toHaveLength(1);
      // log interno contém o e-mail (padrão sendNewCode) — mas o token cru NÃO
      const logged = stderr.mock.calls.map((c) => String(c[0])).join('');
      expect(logged).toContain('ana@x.com');
      expect(logged).not.toContain(tokenIn(mails[0]!.html));
    } finally {
      stderr.mockRestore();
    }
  });

  it('novo pedido dentro da quota invalida o pendente anterior do e-mail', async () => {
    const { svc, verificationCode } = make({ user: confirmed });
    await svc.requestReset({ email: 'ana@x.com' }, NOW);
    expect(verificationCode.updateMany).toHaveBeenCalledWith({
      where: { email: 'ana@x.com', kind: 'password_reset', usedAt: null },
      data: { usedAt: NOW },
    });
  });

  it('e-mail com maiúsculas/espaços: normalizado pelo zod antes de tocar no banco', async () => {
    const { svc, user } = make({ user: confirmed });
    await svc.requestReset({ email: '  Ana@X.com  ' }, NOW);
    expect(user.findUnique).toHaveBeenCalledWith({ where: { email: 'ana@x.com' } });
  });

  it('corrida no índice único (create P2002): silenciada, resposta void uniforme, sem envio (I1)', async () => {
    const { svc, created, mails } = make({ user: confirmed, createP2002: true });
    await expect(svc.requestReset({ email: 'ana@x.com' }, NOW)).resolves.toBeUndefined();
    expect(created).toHaveLength(0);
    expect(mails).toHaveLength(0);
  });

  it('token cru não aparece em log nem na saída; só o hash circula (regra de privacidade)', async () => {
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const { svc, created } = make({ user: confirmed });
      const ret = await svc.requestReset({ email: 'ana@x.com' }, NOW);
      expect(ret).toBeUndefined();
      // nada gravado é um token cru de 64 hex: o codeHash é hash, não o próprio
      // valor que o e-mail carregou (comparado via tokenIn abaixo).
      expect(created[0]!.codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(stderr.mock.calls.map((c) => String(c[0])).join('')).toBe('');
    } finally {
      stderr.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// POST /auth/reset-password (consumeReset com now fixo)
// ---------------------------------------------------------------------------

const validStored = {
  id: 'c1',
  email: 'ana@x.com',
  kind: 'password_reset',
  codeHash: HASH,
  usedAt: null,
  expiresAt: new Date(NOW.getTime() + 60_000),
};
const body = { token: TOKEN, password: 'senha-nova-123' };

describe('AuthPasswordResetService.completeReset', () => {
  it('token válido: senha nova (argon2 via hashPassword), refresh do usuário apagado e aviso Telegram 1x', async () => {
    const { svc, user, refreshToken, telegramSent, $transaction } = make({
      user: confirmed,
      stored: validStored,
    });
    await expect(svc.consumeReset(body, NOW)).resolves.toBeUndefined();

    // transacao com callback (CAS) e nao array de ops
    const txArg = ($transaction.mock.calls[0] as unknown as [unknown])[0];
    expect(typeof txArg).toBe('function');
    // reexecuta o corpo da transacao com um tx-espião: CAS PRIMEIRO, senha depois,
    // revogação por último — e o CAS condiz com I2/I4 (id + usedAt:null + vivo)
    const calls: string[] = [];
    const txSpy = {
      verificationCode: {
        updateMany: jest.fn(async (a: { where: Record<string, unknown> }) => {
          if ('id' in a.where) {
            calls.push('consume');
            expect(a.where).toEqual(
              expect.objectContaining({
                id: 'c1',
                usedAt: null,
                kind: 'password_reset',
                expiresAt: { gt: NOW },
              }),
            );
          } else {
            calls.push('kill-siblings');
          }
          return { count: 1 };
        }),
      },
      user: {
        update: jest.fn(async () => {
          calls.push('password');
        }),
      },
      refreshToken: {
        deleteMany: jest.fn(async () => {
          calls.push('revoke');
        }),
      },
    };
    await (txArg as (tx: unknown) => Promise<void>)(txSpy);
    expect(calls).toEqual(['consume', 'kill-siblings', 'password', 'revoke']);

    expect(user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { passwordHash: 'argon2(senha-nova-123)' },
    });
    expect(refreshToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
    });
    expect(telegramSent).toHaveLength(1);
    expect(telegramSent[0]!.id).toBe('123456789');
    expect(telegramSent[0]!.text).toContain('senha');
  });

  it('Telegram lança: o reset NÃO é desfeito (transação já fechou) e nada estoura', async () => {
    const { svc, user, telegram } = make({
      user: confirmed,
      stored: validStored,
      telegramFail: true,
    });
    await expect(svc.consumeReset(body, NOW)).resolves.toBeUndefined();
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    expect(user.update).toHaveBeenCalledTimes(1); // a senha mudou
  });

  it('conta sem telegramId: reset conclui sem tocar no Telegram', async () => {
    const { svc, telegram } = make({
      user: { ...confirmed, telegramId: null },
      stored: validStored,
    });
    await expect(svc.consumeReset(body, NOW)).resolves.toBeUndefined();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  // Os três sabores (inexistente/usado/expirado) têm a MESMA falha genérica.
  it('token inexistente => ResetTokenInvalidError genérico', async () => {
    const { svc, user } = make({ user: confirmed, stored: null });
    await expect(svc.consumeReset(body, NOW)).rejects.toBeInstanceOf(ResetTokenInvalidError);
    expect(user.update).not.toHaveBeenCalled();
  });

  it('token expirado => o MESMO ResetTokenInvalidError e o caminho morto NUNCA chega ao argon2/usuário (I3)', async () => {
    const { svc, user } = make({
      user: confirmed,
      stored: { ...validStored, expiresAt: new Date(NOW.getTime() - 1) },
    });
    await expect(svc.consumeReset(body, NOW)).rejects.toBeInstanceOf(ResetTokenInvalidError);
    expect(user.update).not.toHaveBeenCalled();
    // busca ja filtra expirado no where (o mock so devolve linha viva)
    expect(user.findUnique).not.toHaveBeenCalled();
  });

  it('token já consumido (busca por usedAt:null não acha) => mesma falha genérica', async () => {
    // 2º uso: a linha existe mas usada => o where usedAt:null do service devolve null
    const { svc, verificationCode, user } = make({
      user: confirmed,
      stored: null,
    });
    await expect(svc.consumeReset(body, NOW)).rejects.toBeInstanceOf(ResetTokenInvalidError);
    expect(verificationCode.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ usedAt: null }),
      }),
    );
    expect(user.update).not.toHaveBeenCalled();
  });

  it('CAS perdido (corrida consumiu o token entre busca e transação) => mesma falha genérica, senha NÃO muda', async () => {
    const { svc, user, refreshToken } = make({
      user: confirmed,
      stored: validStored,
      casCount: 0,
    });
    await expect(svc.consumeReset(body, NOW)).rejects.toBeInstanceOf(ResetTokenInvalidError);
    expect(user.update).not.toHaveBeenCalled();
    expect(refreshToken.deleteMany).not.toHaveBeenCalled();
  });

  it('linha válida mas usuário sumido => mesma falha genérica, nada muda', async () => {
    const { svc } = make({ user: null, stored: validStored });
    await expect(svc.consumeReset(body, NOW)).rejects.toBeInstanceOf(ResetTokenInvalidError);
  });

  it("senha fraca ('123') => zod 400 ANTES de tocar no banco (nada mudou)", async () => {
    const { svc, verificationCode, user } = make({
      user: confirmed,
      stored: validStored,
    });
    await expect(svc.consumeReset({ token: TOKEN, password: '123' }, NOW)).rejects.toBeInstanceOf(
      z.ZodError,
    );
    expect(verificationCode.findFirst).not.toHaveBeenCalled();
    expect(user.update).not.toHaveBeenCalled();
  });

  it('token fora do formato (não-64-hex) => zod 400, nenhuma busca no banco', async () => {
    const { svc, verificationCode } = make({
      user: confirmed,
      stored: validStored,
    });
    await expect(
      svc.consumeReset({ token: 'abc', password: 'senha-nova-123' }, NOW),
    ).rejects.toBeInstanceOf(z.ZodError);
    expect(verificationCode.findFirst).not.toHaveBeenCalled();
  });

  it('token cru não vaza em log no caminho de sucesso (regra de privacidade)', async () => {
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const { svc } = make({ user: confirmed, stored: validStored });
      await svc.consumeReset(body, NOW);
      expect(stderr.mock.calls.map((c) => String(c[0])).join('')).not.toContain(TOKEN);
    } finally {
      stderr.mockRestore();
    }
  });
});
