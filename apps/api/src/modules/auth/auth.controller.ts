import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
  AuthSignupService,
  EmailNotConfirmedError,
  SessionExpiredError,
} from './auth-signup.service';
import { AuthPasswordResetService, ResetTokenInvalidError } from './auth-password-reset.service';
import { AuthSessionsService } from './auth-sessions.service';
import { REFRESH_COOKIE } from './auth.service';
import { Public } from './public.decorator';
import { CurrentUser } from '../../shared/identity/current-user.decorator';

const REFRESH_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  // path raiz de propósito: em dev a web chama a API pelo proxy do vite
  // (`/api/auth/...`). Um cookie com Path=/auth NAO cobre /api/auth/* e o
  // F5 ia para o login (bug do F5, smoke 2026-10-08). As rotas de refresh
  // são públicas e o valor e opaco de uso unico — escopo raiz nao amplia nada.
  path: '/',
};

/** Shape da request com o cookie de refresh (express + cookie-parser no main.ts). */
type RequestWithCookies = Request & { cookies?: Record<string, string | undefined> };

/** Metadados da sessão vindos da requisição (spec sessão-24h: ip só registrado, D4). */
function sessionMeta(req: Request): { ip: string | null; userAgent: string | null } {
  return { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null };
}

function refreshCookie(req: RequestWithCookies): string | undefined {
  return req.cookies?.[REFRESH_COOKIE];
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly signupService: AuthSignupService,
    private readonly passwordResetService: AuthPasswordResetService,
    private readonly sessionsService: AuthSessionsService,
  ) {}

  @Public()
  @Post('signup')
  async signup(@Body() body: unknown) {
    try {
      return await this.signupService.signup(body);
    } catch (err) {
      if (err instanceof Error && err.constructor.name === 'EmailAlreadyInUseError') {
        // So conta CONFIRMADA e conflito (pendente retoma o codigo no service).
        // Message do service e a de dominio; o corpo JSON garante `code` p/ a UI.
        throw new HttpException(
          { message: 'Este email ja esta cadastrado', code: 'email_taken' },
          409,
        );
      }
      if (err instanceof Error && err.constructor.name === 'TelegramAlreadyInUseError') {
        throw new HttpException(
          {
            message: 'Este telegramId ja esta cadastrado em outra conta',
            code: 'telegram_taken',
          },
          409,
        );
      }
      throw err;
    }
  }

  @Public()
  @Post('resend-code')
  resendCode(@Body() body: unknown) {
    return this.signupService.resendCode(body);
  }

  /**
   * POST /auth/forgot-password ("Esqueci a senha"): resposta SEMPRE 202 {},
   * qualquer que seja o e-mail (anti-enumeration, spec regras 2/8). O service
   * decide tudo e retorna void; aqui nao ha nenhum `if` de regra.
   */
  @Public()
  @Post('forgot-password')
  @HttpCode(202)
  async forgotPassword(@Body() body: unknown): Promise<Record<string, never>> {
    await this.passwordResetService.requestReset(body);
    return {};
  }

  /**
   * POST /auth/reset-password: 204 vazio no sucesso (sem login automatico);
   * token inexistente/usado/expirado e TODOS os sabores do mesmo 410 generico
   * (spec regra 11). 400 zod fica com o ValidationPipe (erro de entrada).
   */
  @Public()
  @Post('reset-password')
  @HttpCode(204)
  async resetPassword(@Body() body: unknown): Promise<void> {
    try {
      await this.passwordResetService.completeReset(body);
    } catch (err) {
      if (err instanceof ResetTokenInvalidError) {
        throw new HttpException(
          {
            message: 'Link inválido ou expirado. Solicite um novo.',
            code: 'reset_token_invalid',
          },
          410,
        );
      }
      throw err;
    }
  }

  @Public()
  @Post('verify-code')
  verifyCode(@Body() body: unknown) {
    return this.signupService.confirmEmail(body);
  }

  @Public()
  @Post('login')
  async login(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const result = await this.signupService.login(body, sessionMeta(req));
      // maxAge = vida REAL do token (D6 do plano): com o default de 24h o cookie
      // morre junto com o teto da cadeia, não em 30 dias.
      res.cookie(REFRESH_COOKIE, result.refreshToken, {
        ...REFRESH_COOKIE_OPTS,
        maxAge: result.refreshExpiresAt.getTime() - Date.now(),
      });
      return { accessToken: result.accessToken, user: result.user };
    } catch (err) {
      if (err instanceof Error && err.constructor.name === 'InvalidCredentialsError') {
        throw new UnauthorizedException('Email ou senha invalidos');
      }
      if (err instanceof EmailNotConfirmedError) {
        throw new HttpException(
          'Email ainda nao confirmado — confirme o codigo recebido para fazer login',
          403,
        );
      }
      throw err;
    }
  }

  @Public()
  @Post('refresh')
  async refresh(@Req() req: RequestWithCookies, @Res({ passthrough: true }) res: Response) {
    try {
      const result = await this.signupService.refresh(refreshCookie(req), sessionMeta(req));
      res.cookie(REFRESH_COOKIE, result.refreshToken, {
        ...REFRESH_COOKIE_OPTS,
        maxAge: result.refreshExpiresAt.getTime() - Date.now(),
      });
      // devolve `user` junto (shape de sessao do login): o bootstrap da web
      // restaura a sessao no F5 so com esta chamada (bug do F5, smoke 2026-10-08).
      return { accessToken: result.accessToken, user: result.user };
    } catch (err) {
      // Teto absoluto atingido (spec sessão-24h): corpo com `code` para o
      // forceLogout da web (toast "Sua sessão expirou. Entre novamente.").
      if (err instanceof SessionExpiredError) {
        throw new HttpException(
          {
            statusCode: 401,
            code: 'session_expired',
            message: 'Sua sessão expirou. Entre novamente.',
          },
          401,
        );
      }
      throw err;
    }
  }

  /**
   * POST /auth/logout — bug corrigido (spec sessão-24h decisão 2/D3): resolve o
   * usuário PELO cookie de refresh e apaga TODOS os tokens dele no banco antes do
   * clearCookie (um refresh copiado sobrevivia ao "Sair"). Continua @Public() e
   * NUNCA 401: cookie ausente/desconhecido só limpa o cookie.
   */
  @Public()
  @Post('logout')
  async logout(@Req() req: RequestWithCookies, @Res({ passthrough: true }) res: Response) {
    await this.sessionsService.revokeAllByRefreshToken(refreshCookie(req));
    res.clearCookie(REFRESH_COOKIE, REFRESH_COOKIE_OPTS);
    return { ok: true };
  }

  /**
   * GET /auth/sessions — lista as sessões ativas da conta (guard global exige
   * Bearer). `current` vem do cookie de refresh da chamada (opcional — D5).
   * Verbo GET registrado no plano D2 (o "POST" da spec lido como rota de listagem;
   * reversível pelo humano).
   */
  @Get('sessions')
  listSessions(@CurrentUser() user: { id: string }, @Req() req: RequestWithCookies) {
    return this.sessionsService.listSessions(user.id, refreshCookie(req));
  }

  /** DELETE /auth/sessions — revoga todas as OUTRAS sessões (mantém a chamada). */
  @Delete('sessions')
  @HttpCode(200)
  revokeOtherSessions(@CurrentUser() user: { id: string }, @Req() req: RequestWithCookies) {
    return this.sessionsService.revokeOthers(user.id, refreshCookie(req));
  }
}
