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
import { newLoginEmail } from './new-login-email';
import { computeSessionExpiry } from './session-expiry';
import { evaluateResendQuota, generateNumericCode, sha256Hex } from './verification-code';

const CODE_TTL_MS = 15 * 60_000;

/** Erros de dominio mapeados para HTTP pela controller. */
export class EmailAlreadyInUseError extends Error {}
export class TelegramAlreadyInUseError extends Error {}
export class InvalidCredentialsError extends Error {}
export class EmailNotConfirmedError extends Error {}
/**
 * Spec sessão-24h (decisão humana nº 1): a cadeia de refresh morreu no teto
 * absoluto (`loginAt + SESSION_ABSOLUTE_TTL`). A controller mapeia para o 401
 * com `code: 'session_expired'` — a web faz forceLogout com aviso.
 */
export class SessionExpiredError extends Error {}

/** Metadados da requisição gravados na sessão (D4 do plano: ip só registrado). */
export interface SessionMeta {
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuthSignupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly mail: MailService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Borda do relógio (D1 do plano): injectable em teste via subclass/spy — a
   *  regra de data em si mora na pura `computeSessionExpiry`. */
  protected now(): Date {
    return new Date();
  }

  /** TTLs (ms) lidos do env: deslizante do refresh + teto absoluto da cadeia. */
  private sessionTtlsMs(): { refreshTtlMs: number; absoluteTtlMs: number } {
    return {
      refreshTtlMs: this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 86_400_000,
      absoluteTtlMs: this.config.get('SESSION_ABSOLUTE_TTL_HOURS', { infer: true }) * 3_600_000,
    };
  }

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
    // D-P7 (Fase 9 / ADR-0017): o PRIMEIRO usuario do sistema nasce admin.
    // count()+create na MESMA transacao reduz a janela, mas a trava REAL e o
    // indice parcial unico `users_single_admin_unique` (migracao fase9): na
    // corrida dos dois "primeiros", o perdedor leva P2002 NO INDICE e re-tenta
    // como nao-admin — nunca 500, nunca dois admins.
    try {
      await this.prisma.$transaction(async (tx) => {
        const admins = await tx.user.count({ where: { isAdmin: true } });
        await tx.user.create({
          data: {
            email: input.email,
            passwordHash,
            telegramId: input.telegramId,
            timezone: input.timezone,
            name: input.name ?? null,
            isAdmin: admins === 0,
          },
        });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const target = JSON.stringify(err.meta?.target ?? '');
        if (target.includes('users_single_admin_unique')) {
          // perdedor da corrida do primeiro-admin: a conta dele e valida, so
          // nao e admin (a constraint fez o trabalho — re-tenta sem isAdmin).
          await this.prisma.user.create({
            data: {
              email: input.email,
              passwordHash,
              telegramId: input.telegramId,
              timezone: input.timezone,
              name: input.name ?? null,
              isAdmin: false,
            },
          });
        } else {
          // Corrida nos unique de email/telegramId — mesma semantica das checagens acima.
          if (target.includes('telegramId')) throw new TelegramAlreadyInUseError();
          throw new EmailAlreadyInUseError();
        }
      } else {
        throw err;
      }
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

  /** Login (3.2): credenciais + email confirmado. A linha de refresh que nasce
   *  aqui É a sessão (spec sessão-24h): loginAt/ip/userAgent + expiresAt capado
   *  no teto absoluto. Login NÃO revoga as outras sessões (múltiplos devices é o
   *  objetivo). `refreshExpiresAt` é o expiresAt REAL — a controller usa como
   *  maxAge do cookie (D6 do plano). */
  async login(raw: unknown, meta: SessionMeta = {}) {
    const input = loginInputSchema.parse(raw);
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
    });
    if (!user || !(await this.auth.verifyPassword(user.passwordHash, input.password))) {
      throw new InvalidCredentialsError();
    }
    if (!user.emailConfirmedAt) throw new EmailNotConfirmedError();

    const now = this.now();
    // Sessões ANTES deste login (fingerprint prévio do dispositivo — decisão 3).
    const priorSessions = await this.prisma.refreshToken.findMany({
      where: { userId: user.id, expiresAt: { gt: now } },
      select: { userAgent: true },
    });

    const refresh = this.auth.newRefreshToken();
    const { refreshTtlMs, absoluteTtlMs } = this.sessionTtlsMs();
    const expiresAt = computeSessionExpiry({
      now,
      loginAt: now,
      absoluteTtlMs,
      refreshTtlMs,
    }).expiresAt;
    try {
      await this.prisma.refreshToken.create({
        data: {
          tokenHash: refresh.tokenHash,
          userId: user.id,
          expiresAt,
          loginAt: now,
          ip: meta.ip ?? null,
          userAgent: meta.userAgent ?? null,
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
    // Alerta de dispositivo novo: best-effort apos o login bem-sucedido (falha de
    // email NUNCA quebra o login — padrao sendNewCode). Await interno com try/catch.
    await this.maybeSendNewLoginAlert({
      email: user.email,
      priorSessions,
      meta,
      at: now,
    });
    return {
      accessToken,
      refreshToken: refresh.token,
      /** expiresAt REAL da linha criada — maxAge do cookie na controller (D6). */
      refreshExpiresAt: expiresAt,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        timezone: user.timezone,
        resumoDiarioHora: user.resumoDiarioHora,
        resumoDiarioAtivo: user.resumoDiarioAtivo,
        // Fase 9 (observabilidade): a web marca os eventos do tracker com o uuid
        // interno (unico identificador permitido — ADR-0016) e o isAdmin so
        // controla visibilidade de rota; os dados continuam guardados no server.
        isAdmin: user.isAdmin,
      },
    };
  }

  /**
   * POST /auth/refresh — rotaciona o refresh token (cookie httpOnly) DENTRO do
   * teto absoluto da cadeia (spec sessão-24h, decisão humana nº 1): o novo token
   * HERDA o `loginAt` e recebe `expiresAt = min(now + refreshTtl, loginAt + teto)`.
   * Passou do teto → a linha MORRE no banco e `SessionExpiredError` sobe (a
   * controller faz o 401 `session_expired`). Token pré-teto sem loginAt (sessões
   * criadas antes da migration) ganha `loginAt = now` — vive no máximo 24h após
   * o deploy, aceito na spec.
   */
  async refresh(rawToken: string | undefined, meta: SessionMeta = {}) {
    if (!rawToken) throw new UnauthorizedException();
    const now = this.now();
    const tokenHash = this.auth.hashRefreshToken(rawToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!stored || stored.expiresAt <= now) throw new UnauthorizedException();

    const { refreshTtlMs, absoluteTtlMs } = this.sessionTtlsMs();
    const loginAt = stored.loginAt ?? now; // linha pré-migration: o login é agora
    const expiry = computeSessionExpiry({ now, loginAt, absoluteTtlMs, refreshTtlMs });
    if (expiry.expired) {
      // cadeia morta: a linha sobrevivente não tem propósito — apaga e responde 401.
      await this.prisma.refreshToken.delete({ where: { id: stored.id } });
      throw new SessionExpiredError();
    }

    const next = this.auth.newRefreshToken();
    await this.prisma.$transaction([
      this.prisma.refreshToken.delete({ where: { id: stored.id } }),
      this.prisma.refreshToken.create({
        data: {
          tokenHash: next.tokenHash,
          userId: stored.userId,
          expiresAt: expiry.expiresAt,
          loginAt, // HERDADO — é isso que faz o teto valer para a cadeia toda
          ip: meta.ip ?? stored.ip,
          userAgent: meta.userAgent ?? stored.userAgent,
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
      /** expiresAt REAL do novo token — maxAge do cookie na controller (D6). */
      refreshExpiresAt: expiry.expiresAt,
      user: {
        id: stored.user.id,
        email: stored.user.email,
        name: stored.user.name,
        timezone: stored.user.timezone,
        resumoDiarioHora: stored.user.resumoDiarioHora,
        resumoDiarioAtivo: stored.user.resumoDiarioAtivo,
        isAdmin: stored.user.isAdmin,
      },
    };
  }

  /**
   * E-mail de alerta de novo login (spec sessão-24h, decisão humana nº 3 / D4):
   * fingerprint é o user-agent (ip flutua — alarme falso). Regras:
   * - nenhuma sessão prévia (primeiro login) → nada;
   * - login sem user-agent → nada (sem fingerprint não há comparação honesta);
   * - alguma sessão prévia com o MESMO user-agent → mesmo dispositivo, nada;
   * - senão → e-mail com ip/UA/data-hora + aviso de encerrar sessões.
   * Falha de e-mail NUNCA quebra o login (padrão sendNewCode: try/catch + stderr).
   */
  private async maybeSendNewLoginAlert(input: {
    email: string;
    priorSessions: { userAgent: string | null }[];
    meta: SessionMeta;
    at: Date;
  }): Promise<void> {
    if (input.priorSessions.length === 0) return;
    const ua = input.meta.userAgent;
    if (!ua) return;
    if (input.priorSessions.some((s) => s.userAgent === ua)) return;
    try {
      await this.mail.send(
        newLoginEmail({
          to: input.email,
          ip: input.meta.ip ?? null,
          userAgent: ua,
          at: input.at,
        }),
      );
    } catch (err) {
      process.stderr.write(
        `[mail] alerta de novo login falhou para ${input.email}: ${(err as Error).message}\n`,
      );
    }
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
