import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { Env } from '../../config/env.validation';
import {
  loginInputSchema,
  resendCodeInputSchema,
  signupInputSchema,
  verifyCodeInputSchema,
} from '@agendabo/contracts';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { AuthService } from './auth.service';
import { MailService } from './mail.service';
import { evaluateResendQuota, generateNumericCode, sha256Hex } from './verification-code';

const CODE_TTL_MS = 15 * 60_000;

/** Erros de dominio mapeados para HTTP pela controller. */
export class EmailAlreadyInUseError extends Error {}
export class InvalidCredentialsError extends Error {}
export class EmailNotConfirmedError extends Error {}

@Injectable()
export class AuthSignupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly mail: MailService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Cadastro (3.1): cria conta pendente + envia primeiro codigo (nao conta como reenvio). */
  async signup(raw: unknown) {
    const input = signupInputSchema.parse(raw);

    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw new EmailAlreadyInUseError();

    const passwordHash = await this.auth.hashPassword(input.password);
    await this.prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        telegramId: input.telegramId,
        timezone: input.timezone,
      },
    });
    await this.sendNewCode(input.email);

    return { email: input.email, codeExpiresInSeconds: CODE_TTL_MS / 1000 };
  }

  /** POST /auth/resend-code — quota de 3 reenvios/30min persistida (3.1.1). */
  async resendCode(raw: unknown) {
    const { email } = resendCodeInputSchema.parse(raw);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new NotFoundException('Conta nao encontrada');
    if (user.emailConfirmedAt) return { email, alreadyConfirmed: true as const };

    const sends = await this.prisma.verificationCode.findMany({
      where: { email, sentAt: { gt: new Date(Date.now() - 60 * 60_000) } }, // margem > janela
      select: { sentAt: true },
      orderBy: { sentAt: 'asc' },
    });
    const quota = evaluateResendQuota(
      sends.map((s) => s.sentAt),
      new Date(),
    );
    if (!quota.allowed) {
      throw new HttpException(
        {
          message: 'Limite de reenvios atingido. Tente novamente mais tarde.',
          reenviosRestantes: quota.reenviosRestantes,
          retryAfterSeconds: quota.retryInMs ? Math.ceil(quota.retryInMs / 1000) : null,
        },
        429,
      );
    }
    await this.sendNewCode(email);
    return {
      email,
      reenviosRestantes: Math.max(0, quota.reenviosRestantes - 1),
      codeExpiresInSeconds: CODE_TTL_MS / 1000,
    };
  }

  /** POST /auth/verify-code — valida codigo correto/nao expirado/nao usado. */
  async confirmEmail(raw: unknown) {
    const input = verifyCodeInputSchema.parse(raw);
    const active = await this.prisma.verificationCode.findFirst({
      where: { email: input.email, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { sentAt: 'desc' },
    });
    if (!active || !this.auth.codeMatches(input.code, active.codeHash)) {
      throw new UnauthorizedException('Codigo invalido ou expirado');
    }

    await this.prisma.$transaction([
      this.prisma.verificationCode.update({
        where: { id: active.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.verificationCode.updateMany({
        where: { email: input.email, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { email: input.email },
        data: { emailConfirmedAt: new Date() },
      }),
    ]);
    // "conta criada com sucesso, faca login" — a mensagem vive no front (3.1.1)
    return { confirmed: true as const };
  }

  /** Login (3.2): credenciais + email confirmado. */
  async login(raw: unknown) {
    const input = loginInputSchema.parse(raw);
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (!user || !(await this.auth.verifyPassword(user.passwordHash, input.password))) {
      throw new InvalidCredentialsError();
    }
    if (!user.emailConfirmedAt) throw new EmailNotConfirmedError();

    const refresh = this.auth.newRefreshToken();
    try {
      await this.prisma.refreshToken.create({
        data: {
          tokenHash: refresh.tokenHash,
          userId: user.id,
          expiresAt: new Date(
            Date.now() + this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 86_400_000,
          ),
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('token em uso, tente novamente');
      }
      throw err;
    }

    const accessToken = await this.auth.signAccessToken({
      id: user.id,
      email: user.email,
      telegramId: user.telegramId,
    });
    return {
      accessToken,
      refreshToken: refresh.token,
      user: {
        id: user.id,
        email: user.email,
        timezone: user.timezone,
        resumoDiarioHora: user.resumoDiarioHora,
      },
    };
  }

  /** POST /auth/refresh — rotaciona o refresh token (cookie httpOnly). */
  async refresh(rawToken: string | undefined) {
    if (!rawToken) throw new UnauthorizedException();
    const tokenHash = this.auth.hashRefreshToken(rawToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!stored || stored.expiresAt <= new Date()) throw new UnauthorizedException();

    const next = this.auth.newRefreshToken();
    await this.prisma.$transaction([
      this.prisma.refreshToken.delete({ where: { id: stored.id } }),
      this.prisma.refreshToken.create({
        data: {
          tokenHash: next.tokenHash,
          userId: stored.userId,
          expiresAt: new Date(
            Date.now() + this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 86_400_000,
          ),
        },
      }),
    ]);

    const accessToken = await this.auth.signAccessToken({
      id: stored.user.id,
      email: stored.user.email,
      telegramId: stored.user.telegramId,
    });
    return { accessToken, refreshToken: next.token, user: stored.user };
  }

  private async sendNewCode(email: string): Promise<void> {
    const code = generateNumericCode();
    await this.prisma.verificationCode.create({
      data: { email, codeHash: sha256Hex(code), expiresAt: new Date(Date.now() + CODE_TTL_MS) },
    });
    await this.mail.send({
      to: email,
      subject: 'Seu codigo do Agendabo',
      text:
        `Seu codigo de confirmacao: ${code}\n` +
        `Valido por 15 minutos. Se voce nao pediu, ignore este email.`,
    });
  }
}
