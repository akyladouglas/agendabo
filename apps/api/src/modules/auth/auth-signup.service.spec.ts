import { AuthSignupService, EmailAlreadyInUseError } from './auth-signup.service';

/**
 * Signup + confirmação de e-mail com o código criado ANTES do envio (Fase 5,
 * ajuste pós-smoke): falha do provedor de email nao pode desfazer a conta nem
 * explodir o cadastro — a resposta sinaliza mailDelivered=false.
 */
function makeService(mailImpl?: { send: (m: unknown) => Promise<void> }) {
  const user = { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() };
  const code = {
    findFirst: jest.fn(),
    create: jest.fn().mockResolvedValue(undefined),
    update: jest.fn(),
    updateMany: jest.fn(),
  };
  const mail = {
    send: mailImpl?.send ?? jest.fn().mockResolvedValue(undefined),
  };
  const svc = new AuthSignupService(
    { user, verificationCode: code } as never,
    {
      hashPassword: jest.fn().mockResolvedValue('hash'),
      codeMatches: jest.fn().mockReturnValue(false),
    } as never,
    mail as never,
    { get: jest.fn() } as never,
  );
  return { svc, user, code, mail };
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
