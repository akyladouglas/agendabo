import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import type { RedisOptions } from 'ioredis';
import { validateEnv, type Env } from './config/env.validation';
import { AiModule } from './modules/ai/ai.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { AuthModule } from './modules/auth/auth.module';
import { BotModule } from './modules/bot/bot.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ObservabilidadeModule } from './modules/observabilidade/observabilidade.module';
import { UsersModule } from './modules/users/users.module';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './shared/prisma/prisma.module';
import { TelegramModule } from './shared/telegram/telegram.module';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';

/**
 * Monolito modular (ADR-000). Camadas: controller -> service -> repository(Prisma).
 * Bot/LLM nunca decidem conflito — chamam schedule-core via services (ADR-003).
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (raw) => validateEnv(raw) as Record<string, unknown>,
      envFilePath: ['.env', '../../.env'],
    }),
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const url = new URL(config.get('REDIS_URL', { infer: true }));
        return {
          connection: {
            host: url.hostname,
            port: Number(url.port || 6379),
            password: url.password || undefined,
            maxRetriesPerRequest: null,
          } satisfies RedisOptions,
        };
      },
    }),
    PrismaModule,
    TelegramModule,
    AuthModule,
    UsersModule,
    AppointmentsModule,
    BotModule,
    NotificationsModule,
    AiModule,
    ObservabilidadeModule,
  ],
  controllers: [HealthController],
  providers: [
    // Deny-by-default: toda rota exige JWT, exceto as marcadas com @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
