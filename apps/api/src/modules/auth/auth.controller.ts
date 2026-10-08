import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { AuthSignupService, EmailNotConfirmedError } from './auth-signup.service';
import { AuthPasswordResetService, ResetTokenInvalidError } from './auth-password-reset.service';
import { REFRESH_COOKIE } from './auth.service';
import { Public } from './public.decorator';
import type { Env } from '../../config/env.validation';

const REFRESH_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/auth',
};

@Controller('auth')
export class AuthController {
  constructor(
    private readonly signupService: AuthSignupService,
    private readonly passwordResetService: AuthPasswordResetService,
    private readonly config: ConfigService<Env, true>,
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
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    try {
      const result = await this.signupService.login(body);
      res.cookie(REFRESH_COOKIE, result.refreshToken, {
        ...REFRESH_COOKIE_OPTS,
        maxAge: this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 86_400_000,
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
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = (req.cookies as Record<string, string | undefined>)[REFRESH_COOKIE];
    const result = await this.signupService.refresh(token);
    res.cookie(REFRESH_COOKIE, result.refreshToken, {
      ...REFRESH_COOKIE_OPTS,
      maxAge: this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 86_400_000,
    });
    return { accessToken: result.accessToken };
  }

  @Public()
  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(REFRESH_COOKIE, REFRESH_COOKIE_OPTS);
    return { ok: true };
  }
}
