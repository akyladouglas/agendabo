import { AuthSignupService, EmailAlreadyInUseError } from './auth-signup.service';

/**
 * Signup + confirmação de e-mail com o código criado ANTES do envio (Fase 5,
 * ajuste pós-smoke): falha do provedor de email nao pode desfazer a conta nem
 * explodir o cadastro — a resposta sinaliza mailDelivered=false.
 */
function makeService(mailImpl?: { send: (m: unknown) => Promise<void> }) {
  const user = {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
  };
  const code = {
    findFirst: jest.fn(),
    create: jest.fn().mockResolvedValue(undefined),
    update: jest.fn(),
    updateMany: jest.fn(),
  };
  const mail = {
    send: mailImpl?.send ?? jest.fn().mockResolvedValue(undefined),
  };
  // D-P7 (Fase 9): o create passa a viver numa tx com count() de admins.
  // $transaction plano: executa o callback com o MESMO mock (o tx.user.create
  // e gravado no mock de user — os testes antigos de create continuam vendo).
  const prisma: Record<string, unknown> = {
    user,
    verificationCode: code,
  };
  prisma['$transaction'] = jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
  const svc = new AuthSignupService(
    prisma as never,
    {
      hashPassword: jest.fn().mockResolvedValue('hash'),
      codeMatches: jest.fn().mockReturnValue(false),
    } as never,
    mail as never,
    { get: jest.fn() } as never,
  );
  return { svc, user, code, mail, prisma };
}

const input = {
  name: 'Ana',
  email: 'ana@exemplo.com',
  password: 'senha12345',
  telegramId: '123456789',
};

describe('AuthSignupService.signup', () => {
  it('cria a conta e entrega o codigo: mailDelivered=true', async () => {
    const { svc, mail } = makeService();
    const res = await svc.signup(input);
    expect(res).toEqual({
      email: 'ana@exemplo.com',
      codeExpiresInSeconds: 900,
      mailDelivered: true,
    });
    expect(mail.send).toHaveBeenCalledTimes(1);
  });

  it('email falhou: conta continua criada, codigo salvo e mailDelivered=false (sem throw)', async () => {
    const send = jest.fn().mockRejectedValue(new Error('Resend falhou: domain not verified'));
    const { svc, user, code } = makeService({ send });
    const res = await svc.signup(input);
    expect(user.create).toHaveBeenCalledTimes(1);
    expect(code.create).toHaveBeenCalledTimes(1); // o codigo existe p/ "Reenviar codigo"
    expect(res.mailDelivered).toBe(false);
  });

  it('e-mail ja CONFIRMADO (pré-checada) continua 409 de dominio', async () => {
    const { svc, user } = makeService();
    user.findUnique.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(where.email ? { id: 'u1', emailConfirmedAt: new Date() } : null),
    );
    await expect(svc.signup(input)).rejects.toBeInstanceOf(EmailAlreadyInUseError);
  });

  it('telegramId de conta CONFIRMADA e conflito proprio (TelegramAlreadyInUseError)', async () => {
    const { svc, user } = makeService();
    user.findUnique.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(where.telegramId ? { id: 'outro', emailConfirmedAt: new Date() } : null),
    );
    const { TelegramAlreadyInUseError } = jest.requireActual('./auth-signup.service');
    await expect(svc.signup(input)).rejects.toBeInstanceOf(TelegramAlreadyInUseError);
  });

  it('e-mail pendente de confirmacao NAO e conflito: retoma gerando codigo novo', async () => {
    const { svc, user, mail } = makeService();
    user.findUnique.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(where.email ? { id: 'u1', emailConfirmedAt: null } : null),
    );
    const res = await svc.signup(input);
    expect(res).toMatchObject({
      email: 'ana@exemplo.com',
      pendingResumed: true,
    });
    expect(mail.send).toHaveBeenCalledTimes(1);
    expect(user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { telegramId: '123456789' },
    });
  });

  it('telegramId preso em OUTRA conta pendente e liberado (sobrescrito)', async () => {
    const { svc, user } = makeService();
    user.findUnique.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(
        where.email
          ? { id: 'u1', emailConfirmedAt: null }
          : where.telegramId
            ? { id: 'pendente2', emailConfirmedAt: null }
            : null,
      ),
    );
    await svc.signup(input);
    expect(user.update).toHaveBeenCalledWith({
      where: { id: 'pendente2' },
      data: { telegramId: null },
    });
  });

  it('corrida no unique do banco (P2002) tambem vira EmailAlreadyInUseError', async () => {
    const { svc, user } = makeService();
    const { Prisma } = jest.requireActual('@prisma/client');
    user.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: '6',
      }),
    );
    await expect(svc.signup(input)).rejects.toBeInstanceOf(EmailAlreadyInUseError);
  });
});

/**
 * D-P7 (Fase 9 / ADR-0017): o PRIMEIRO usuario do sistema nasce admin. A
 * contagem e o create vivem na MESMA transacao e a constraint parcial unica
 * (`users_single_admin_unique`) e a trava de corrida real — o teste abaixo
 * simula o Postgres: P2002 no indice parcial = segundo perdedor nasce nao-admin.
 */
describe('AuthSignupService.signup — primeiro admin (D-P7)', () => {
  it('sem nenhum admin no sistema: primeiro cadastro nasce isAdmin=true', async () => {
    const { svc, user } = makeService();
    // count() default = 0 admins
    await svc.signup(input);
    expect(user.create).toHaveBeenCalledTimes(1);
    expect(user.create.mock.calls[0]![0]!.data.isAdmin).toBe(true);
  });

  it('ja existe admin: cadastro normal nasce isAdmin=false', async () => {
    const { svc, user } = makeService();
    user.count = jest.fn().mockResolvedValue(1);
    await svc.signup(input);
    expect(user.create.mock.calls[0]![0]!.data.isAdmin).toBe(false);
  });

  it('corrida dos dois "primeiros usuarios": P2002 no indice parcial re-tenta como nao-admin', async () => {
    const { svc, user } = makeService();
    const { Prisma } = jest.requireActual('@prisma/client');
    user.create
      .mockRejectedValueOnce(
        // o alvo do P2002 e o indice parcial do admin — NAO email/telegramId
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: '6',
          meta: { target: 'users_single_admin_unique' },
        }),
      )
      .mockResolvedValue({ id: 'u2' });
    const res = await svc.signup(input); // nao pode lancar: o segundo ganha a conta
    expect(res.mailDelivered).toBe(true);
    expect(user.create).toHaveBeenCalledTimes(2);
    expect(user.create.mock.calls[1]![0]!.data.isAdmin).toBe(false);
  });
});
