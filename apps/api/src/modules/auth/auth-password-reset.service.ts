import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { forgotPasswordInputSchema, resetPasswordInputSchema } from '@agendabo/contracts';
import type { Env } from '../../config/env.validation';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { TelegramClientService } from '../../shared/telegram/telegram-client.service';
import { AuthService, randomToken, sha256Hex } from './auth.service';
import { MailService } from './mail.service';
import { passwordResetEmailHtml } from './password-reset-email';
import { evaluateResetQuota, RESET_TOKEN_TTL_MS, RESET_WINDOW_MS } from './password-reset';

/**
 * Erro de dominio do reset (spec regra 11): inexistente/usado/expirado caem TODOS
 * aqui — o controller mapeia para o 410 generico `reset_token_invalid`, nunca ha
 * como distinguir os tres sabores pela resposta.
 */
export class ResetTokenInvalidError extends Error {}

/**
 * Mensagem de seguranca enviada ao Telegram POS reset concluido (decisao do
 * humano no Aberto #3 da spec esqueci-a-senha). Texto FIXO sem dado de usuario:
 * nao precisa de escapeHtml (gotcha 6 e do bot repetir texto digitado).
 */
const PASSWORD_CHANGED_NOTICE =
  '🔐 Sua senha da sua conta do Agendabô foi alterada. Se não foi você, redefina a senha imediatamente e fale com o suporte.';

/**
 * "Esqueci a senha" (spec esqueci-a-senha): requestReset + completeReset.
 * Anti-enumeration por construcao: `requestReset` retorna void para QUALQUER
 * entrada e a unica falha de `completeReset` e o erro de dominio generico.
 * Quota/validade moram em `password-reset.ts` (puro, TDD); aqui e so
 * orquestracao (Prisma, email, revogacao de sessoes, aviso Telegram).
 */
@Injectable()
export class AuthPasswordResetService {
  private readonly logger = new Logger(AuthPasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly mail: MailService,
    private readonly telegram: TelegramClientService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * POST /auth/forgot-password — SEMPRE void (o controller responde 202 uniforme).
   * - email inexistente ou pendente de confirmacao: nada acontece (regra 3);
   * - quota estourada (2 envios/10min): silenciosa, sem email e sem linha nova (regra 4);
   * - token novo invalida os pendentes anteriores do email (regra 6);
   * - falha do Resend: log interno + nada muda na resposta (regra 8, D3) — o
   *   token fica criado e valido 1h; a quota conta o envio falho (decisao aceita).
   * O relógio entra por parâmetro (testing.md: `now` injetável em regra de quota);
   * na borda HTTP ele e o `new Date()` — os testes de servico o congelam.
   */
  async requestReset(raw: unknown, now: Date = new Date()): Promise<void> {
    const { email } = forgotPasswordInputSchema.parse(raw);

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.emailConfirmedAt) return;

    // Margem > janela (padrao resendCode): a quota em si e da pura com `now` injetavel.
    const sends = await this.prisma.verificationCode.findMany({
      where: {
        email,
        kind: 'password_reset',
        sentAt: { gte: new Date(now.getTime() - 2 * RESET_WINDOW_MS) },
      },
      select: { sentAt: true },
      orderBy: { sentAt: 'asc' },
    });
    if (!evaluateResetQuota(sends, now).allowed) return;

    const token = randomToken();
    try {
      await this.prisma.$transaction([
        // uso unico por email: so o token mais novo vale (espelha confirmEmail do signup)
        this.prisma.verificationCode.updateMany({
          where: { email, kind: 'password_reset', usedAt: null },
          data: { usedAt: now },
        }),
        this.prisma.verificationCode.create({
          data: {
            email,
            kind: 'password_reset',
            codeHash: sha256Hex(token), // o token cru NUNCA e persistido
            expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS),
          },
        }),
      ]);
    } catch (err) {
      // Corrida: outro pedido simultaneo criou linha no indice unico parcial de
      // code_hash. Silenciar PRESERVA a resposta uniforme (I1 do review: um 500
      // aqui seria oracle de existencia de conta). O token do outro pedido vale.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return;
      }
      throw err;
    }

    const webOrigin = this.config.get('WEB_ORIGIN', { infer: true });
    const link = `${webOrigin}/redefinir-senha?token=${token}`;
    try {
      await this.mail.send({
        to: email,
        subject: 'Redefinir sua senha do Agendabô',
        text:
          `Alguem pediu a redefinicao da senha da conta ${email} no Agendabo.\n` +
          `Abra este link para escolher uma senha nova (valido por 1 hora):\n${link}\n` +
          `Se voce nao pediu, ignore este e-mail — nada muda na sua conta.`,
        html: passwordResetEmailHtml(link),
      });
    } catch (err) {
      // Log APENAS interno (o email do destinatario so aparece aqui, igual ao
      // padrao sendNewCode); a resposta continua o mesmo 202 (regra 8).
      process.stderr.write(
        `[mail] envio de reset falhou para ${email}: ${(err as Error).message}\n`,
      );
    }
  }

  /**
   * POST /auth/reset-password — 204 no sucesso (sem login automatico, D4/regra 10).
   * Busca por hash + comparacao em tempo constante (defesa em profundidade);
   * transacao: usedAt (+ demais pendentes do email), passwordHash novo e DELETE
   * dos refresh_tokens do usuario (D6: sessoes antigas morrem na proxima renovacao).
   * Aviso Telegram e best-effort POS-transacao: falha aqui nunca desfaz o reset.
   * O relógio passa POR PARÂMETRO para a pura `resetTokenIsLive` (testing.md);
   * os testes de serviço o congelam nesta borda.
   */
  async completeReset(raw: unknown): Promise<void> {
    await this.consumeReset(raw, new Date());
  }

  /** Núcleo do reset com o `now` da borda injetável (mesma técnica do dispatch). */
  async consumeReset(raw: unknown, now: Date): Promise<void> {
    const { token, password } = resetPasswordInputSchema.parse(raw);

    const hash = sha256Hex(token);
    const stored = await this.prisma.verificationCode.findFirst({
      where: {
        kind: 'password_reset',
        codeHash: hash,
        usedAt: null,
        // token MORTO (inexistente ou expirado) sai pela mesma porta e com o
        // mesmo custo — nunca chega ao argon2/usuario (I3 do review: sem oracle
        // temporal entre "expirado" e "inexistente").
        expiresAt: { gt: now },
      },
    });
    if (!stored) {
      throw new ResetTokenInvalidError();
    }
    // defesa em profundidade: a linha ja veio pelo hash, mas compara em tempo constante
    if (!this.auth.codeMatches(token, stored.codeHash)) {
      throw new ResetTokenInvalidError();
    }

    const user = await this.prisma.user.findUnique({
      where: { email: stored.email },
    });
    if (!user) throw new ResetTokenInvalidError();

    // CAS anti-corrida (I2/I4 do review): CONSUMIR o token e a primeira operacao
    // da transacao, condicional a ainda estar vivo. Se outra requisicao consumiu
    // entre o findFirst e aqui, count === 0 -> mesmo erro generico, e a troca de
    // senha NUNCA roda por cima de um token morto.
    const passwordHash = await this.auth.hashPassword(password);
    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.verificationCode.updateMany({
        where: {
          id: stored.id,
          usedAt: null,
          kind: 'password_reset',
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });
      if (consumed.count === 0) throw new ResetTokenInvalidError();
      // uso unico por email: qualquer outro token pendente do email morre junto
      await tx.verificationCode.updateMany({
        where: { email: stored.email, kind: 'password_reset', usedAt: null },
        data: { usedAt: now },
      });
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash },
      });
      // D6: senha esquecida e sinal de possivel compromise — mata as sessoes
      await tx.refreshToken.deleteMany({ where: { userId: user.id } });
    });

    if (user.telegramId) {
      try {
        await this.telegram.sendMessage(user.telegramId, PASSWORD_CHANGED_NOTICE);
      } catch (err) {
        // padrao MailService: best-effort, log interno, nunca desfaz o reset
        this.logger.error(
          `aviso Telegram de senha alterada falhou para o usuario ${user.id}: ${String(err)}`,
        );
      }
    }
  }
}
