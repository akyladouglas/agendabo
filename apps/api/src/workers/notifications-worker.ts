/**
 * Processo do WORKER de notificações (ADR-009 / D1 do plano da Fase 3). Sobe o
 * AppModule (gate de env + DI) mas NÃO liga HTTP nem long-polling: consome a fila
 * BullMQ `notifications-dispatch` e delega cada job ao DispatchService (toda a
 * lógica de disparo mora lá — aqui é só a ligação BullMQ → serviço, handler fino).
 *
 * Por que processo próprio: o worker pode viver tanto quanto um lembrete (dias),
 * e o bot precisa de long-polling único (gotcha 5); misturar os dois num processo
 * só significaria escolher qual dos dois sobrevive ao restart (ADR-009).
 *
 * Uso: `pnpm dev:worker` (raiz) / `pnpm --filter @agendabo/api dev:worker`.
 */
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Worker } from 'bullmq';
import { AppModule } from '../app.module';
import { DispatchService } from '../modules/notifications/dispatch.service';
import { NOTIFICATIONS_QUEUE } from '../modules/notifications/notifications.queue';
import type { DispatchJobData } from '../modules/notifications/outbox.service';
import type { Env } from '../config/env.validation';
import { loadRootEnv } from '../config/load-root-env';
import { readValidatedEnv } from '../config/env.validation';
import { initErrorTracker, flushErrorTracker } from '../shared/observability/error-tracker';

async function bootstrap(): Promise<void> {
  const logger = new Logger('NotificationsWorker');
  loadRootEnv();
  initErrorTracker(readValidatedEnv(), 'worker');
  // NestFactory.create (não listen()): sem HTTP neste processo. O AppModule traz o
  // gateway do bot, mas nada chama startLongPolling aqui — e os @Cron ficam sem
  // SchedulerRegistry ( só registrado no AppModule.bootstrap, o entrypoint da
  // API): o cron de digest pertence ao processo da API/bot, nunca a este (D1).
  const app = await NestFactory.create(AppModule);
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const url = new URL(config.get('REDIS_URL', { infer: true }));
  const connection = {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
    maxRetriesPerRequest: null,
  };

  const dispatch = app.get(DispatchService);

  const worker = new Worker<DispatchJobData>(
    NOTIFICATIONS_QUEUE,
    async (job) => {
      const result = await dispatch.dispatch({ outboxId: job.data.outboxId });
      logger.log(`job ${job.id ?? '-'} (outbox ${job.data.outboxId}): ${JSON.stringify(result)}`);
      return result;
    },
    {
      connection,
      // Reexecução automática em backoff; o DISPATCH decide a parar quando esgotar
      // NOTIFY_MAX_ATTEMPTS (marca `failed` e para de lançar — spec regra 14).
      settings: { backoffStrategy: (attempts: number) => Math.min(1000 * 2 ** attempts, 60_000) },
    },
  );
  worker.on('failed', (job, err) => {
    logger.warn(`job ${job?.id ?? '-'} falhou (irá repetir): ${err.message}`);
  });

  logger.log(`worker de notificações ouvindo a fila "${NOTIFICATIONS_QUEUE}". Ctrl+C para sair.`);

  const shutdown = async (code: number): Promise<void> => {
    try {
      await worker.close();
      await app.close();
    } finally {
      await flushErrorTracker();
      process.exit(code);
    }
  };
  process.once('SIGINT', () => void shutdown(0));
  process.once('SIGTERM', () => void shutdown(0));
  // falha fatal (ex.: Redis morto no boot): da tempo do SDK flush-ear o
  // envelope antes de morrer e SAI COM CODE 1 (crash visivel, nao maquiado).
  process.on('unhandledRejection', (reason) => {
    logger.error(`falha nao tratada: ${String(reason)}`);
    void shutdown(1);
  });
}

void bootstrap();
