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
import { verificationCodeEmailHtml } from './verification-email';
import { evaluateResendQuota, generateNumericCode, sha256Hex } from './verification-code';

const CODE_TTL_MS = 15 * 60_000;

/** Erros de dominio mapeados para HTTP pela controller. */
export class EmailAlreadyInUseError extends Error {}
export class TelegramAlreadyInUseError extends Error {}
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

  /** Cadastro (3.1): cria conta pendente + envia primeiro codigo (nao conta como reenvio).
   *  Falha de email NAO desfaz a conta nem explode o cadastro: o codigo fica criado e
   *  valido; a resposta sinaliza `mailDelivered:false` para a UI orientar o "Reenviar".
   *  Email ja cadastrado SEM confirmar (ex.: voltou do /confirmar e reenviou o form)
   *  NAO e conflito: reenvia o codigo e segue para a confirmacao (codigo novo, +1 quota). */
  async signup(raw: unknown) {
    const input = signupInputSchema.parse(raw);

    const [byEmail, byTelegram] = await Promise.all([
      this.prisma.user.findUnique({ where: { email: input.email } }),
      this.prisma.user.findUnique({ where: { telegramId: input.telegramId } }),
    ]);
    if (byEmail && byEmail.emailConfirmedAt) throw new EmailAlreadyInUseError();
    // telegramId e o vinculo do bot — unico por CONTA CONFIRMADA. Pendentes podem
    // ser "reivindicados" (o proprio usuario refazendo o cadastro) OU sobrescritos
    // se outro email pendente estiver segurando o id.
    if (byTelegram && byTelegram.emailConfirmedAt) {
      throw new TelegramAlreadyInUseError();
    }
    if (byEmail) {
      // Conta pendente (ex.: voltou do /confirmar e reenviou o form) NAO e
      // conflito: libera o telegramId que estiver preso e retoma gerando codigo novo.
      if (byTelegram && byTelegram.id !== byEmail.id) {
        await this.prisma.user.update({
          where: { id: byTelegram.id },
          data: { telegramId: null },
        });
      }
      await this.prisma.user.update({
        where: { id: byEmail.id },
        data: { telegramId: input.telegramId },
      });
      const mailDelivered = await this.sendNewCode(input.email);
      return {
        email: input.email,
        codeExpiresInSeconds: CODE_TTL_MS / 1000,
        mailDelivered,
        pendingResumed: true as const,
      };
    }

    const passwordHash = await this.auth.hashPassword(input.password);
    try {
      await this.prisma.user.create({
        data: {
          email: input.email,
          passwordHash,
          telegramId: input.telegramId,
          timezone: input.timezone,
          name: input.name ?? null,
        },
      });
    } catch (err) {
      // Corrida nos unique de email/telegramId — mesma semantica das checagens acima.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const target = JSON.stringify(err.meta?.target ?? '');
        if (target.includes('telegramId')) throw new TelegramAlreadyInUseError();
        throw new EmailAlreadyInUseError();
      }
      throw err;
    }
    const mailDelivered = await this.sendNewCode(input.email);

    return {
      email: input.email,
      codeExpiresInSeconds: CODE_TTL_MS / 1000,
      mailDelivered,
    };
  }

  /** POST /auth/resend-code — quota de 3 reenvios/30min persistida (3.1.1). */
  async resendCode(raw: unknown) {
    const { email } = resendCodeInputSchema.parse(raw);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new NotFoundException('Conta nao encontrada');
    if (user.emailConfirmedAt) return { email, alreadyConfirmed: true as const };

    const sends = await this.prisma.verificationCode.findMany({
      // so codigos de CADASTRO contam na quota (a tabela passou a guardar tbem
      // tokens de reset — spec esqueci-a-senha; sem o filtro, reset-mails
      // inflariam os 3 reenvios/30min do cadastro)
      where: {
        email,
        kind: 'email_verification',
        sentAt: { gt: new Date(Date.now() - 60 * 60_000) },
      }, // margem > janela
      select: { sentAt: true, expiresAt: true, usedAt: true },
      orderBy: { sentAt: 'asc' },
    });
    const quota = evaluateResendQuota(sends, new Date());
    // Codigo pendente expirado = reenvio gratuito (unica saida; senao a conta
    // pendente ficaria presa na quota).
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
    const mailDelivered = await this.sendNewCode(email);
    return {
      email,
      reenviosRestantes: quota.expired ? 3 : Math.max(0, quota.reenviosRestantes - 1),
      codeExpiresInSeconds: CODE_TTL_MS / 1000,
      mailDelivered,
    };
  }

  /** POST /auth/verify-code — valida codigo correto/nao expirado/nao usado. */
  async confirmEmail(raw: unknown) {
    const input = verifyCodeInputSchema.parse(raw);
    const active = await this.prisma.verificationCode.findFirst({
      where: {
        email: input.email,
        kind: 'email_verification', // token de reset NUNCA confirma e-mail
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
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
        // matar SÓ os codigos de cadastro pendentes — token de reset do mesmo
        // e-mail nao tem nada a ver com a confirmacao (spec esqueci-a-senha)
        where: { email: input.email, kind: 'email_verification', usedAt: null },
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
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
    });
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
        name: user.name,
        timezone: user.timezone,
        resumoDiarioHora: user.resumoDiarioHora,
        resumoDiarioAtivo: user.resumoDiarioAtivo,
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
    // Shape de sessao filtrado (loginResultSchema): nunca devolver passwordHash.
    return {
      accessToken,
      refreshToken: next.token,
      user: {
        id: stored.user.id,
        email: stored.user.email,
        name: stored.user.name,
        timezone: stored.user.timezone,
        resumoDiarioHora: stored.user.resumoDiarioHora,
        resumoDiarioAtivo: stored.user.resumoDiarioAtivo,
      },
    };
  }

  /** true = email entregue; false = codigo criado mas o envio falhou (logado; a
   *  chamada decide como avisar — signup segue vivo, resend lança MailDeliveryError). */
  private async sendNewCode(email: string): Promise<boolean> {
    const code = generateNumericCode();
    await this.prisma.verificationCode.create({
      data: {
        email,
        kind: 'email_verification',
        codeHash: sha256Hex(code),
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      },
    });
    try {
      await this.mail.send({
        to: email,
        subject: 'Seu código do Agendabô',
        text:
          `Seu código de confirmação: ${code}\n` +
          `Válido por 15 minutos. Se você não pediu, ignore este e-mail.`,
        html: verificationCodeEmailHtml(code),
      });
      return true;
    } catch (err) {
      process.stderr.write(`[mail] envio falhou para ${email}: ${(err as Error).message}\n`);
      return false;
    }
  }
}
