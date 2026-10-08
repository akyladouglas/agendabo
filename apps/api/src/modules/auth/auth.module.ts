import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthPasswordResetService } from './auth-password-reset.service';
import { AuthSignupService } from './auth-signup.service';
import { AuthService } from './auth.service';
import { MailService } from './mail.service';
import type { Env } from '../../config/env.validation';

@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
      }),
    }),
  ],
  controllers: [AuthController],
  // TelegramClientService vem do TelegramModule (@Global): o aviso "senha alterada"
  // do reset fala com shared/telegram, nunca com modules/bot (grafo CROSS_MODULE_EDGES).
  providers: [AuthService, AuthSignupService, AuthPasswordResetService, MailService],
  exports: [AuthService],
})
export class AuthModule {}
