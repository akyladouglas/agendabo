import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { scrubEvent } from '@agendabo/schedule-core';
import type { Env } from '../../config/env.validation';

/**
 * Init do tracker de erros (Fase 9, ADR-0016): SDK Sentry apontando para o
 * GlitchTip SaaS — trocar de fornecedor e trocar o DSN, o codigo nao muda.
 *
 * Regras presas aqui:
 *  - SEM DSN no env => nao inicia (dev nao polui, teste nao envia nada);
 *  - tracing OFF por default (`SENTRY_TRACES_SAMPLE_RATE=0`) — performance
 *    monitoring nao e o objetivo da fase (decisao #7 do humano);
 *  - `beforeSend` = scrubEvent (userId-only — ADR-0016): NENHUM dado de
 *    usuario/conversa/segredo sai da maquina;
 *  - `tags.process` distingue os 4 processos que reportam no mesmo projeto.
 *
 * `env` vem do CHAMADOR ja validado (`validateEnv(process.env)` ou o
 * ConfigService) — nunca os valores crus do ambiente sem parse.
 */
export function initErrorTracker(env: Env, processName: string): void {
  const logger = new Logger('error-tracker');
  const dsn = env.SENTRY_DSN;
  if (!dsn) {
    logger.log('SENTRY_DSN ausente — tracker de erros desligado neste processo');
    return;
  }
  Sentry.init({
    dsn,
    environment: env.SENTRY_ENVIRONMENT,
    release: env.SENTRY_RELEASE,
    debug: env.NODE_ENV === 'development',
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    // nada de anonimato a mais: a politica e a funcao pura testada (spec A5)
    beforeSend: (event, hint) => {
      // hint: anexos sao ZERADOS dentro do scrubEvent (P0-1a) — nada binario
      // sai da maquina; produtores de anexo (extraErrorData/zod attachments)
      // nao estao nos defaults do node@11 (verificado no SDK).
      const out = scrubEvent(event as never, hint as never) as never;
      // segredo NUNCA viaja no evento; se o scrub dropou (null), registra o
      // motivo no log local (best-effort) para o operador ver o descarte
      if (out === null) {
        logger.warn('evento de erro descartado pelo scrub (so identidade)');
      }
      return out;
    },
    // O SDK nao coleta PII no node por default — a politica dura e o scrub.
    attachStacktrace: true,
    // nestIntegration: instrumentacao dos canais Nest (rotas/handlers). A
    // captura das excecoes de HTTP e ligada no bootstrap com o error handler
    // do express (abaixo) — sem isso, erro de rota morre no filtro do Nest.
    integrations: [Sentry.nestIntegration()],
  });
  Sentry.setTag('process', processName);
  logger.log(`tracker de erros ativo (${processName})`);
}

/**
 * Filtro global de exceções do SDK (o CANAL OFICIAL de captura no NestJS):
 * captura tudo que escapa dos handlers e NAO e HttpException esperada (erros
 * de programa como ZodError cru), registra no tracker e delega ao handler
 * padrao do Nest (o HTTP para o cliente nao muda). Chamar no bootstrap da API
 * depois de criar o app. No-op sem client (sem DSN).
 */
export function attachNestErrorFilter(app: INestApplication): void {
  if (!Sentry.getClient()) return;
  // subpath export do SDK (o indice nao reexporta o filtro)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { SentryGlobalFilter } = require('@sentry/nestjs/setup') as {
    SentryGlobalFilter: new (applicationRef: unknown) => never;
  };
  app.useGlobalFilters(new SentryGlobalFilter(app.getHttpAdapter()));
}

/**
 * Force o flush do SDK antes do processo morrer (os entrypoints standalone
 * chamam no handler de exit). Sem isso, o envelope de uma excecao fatal pode
 * morrer no buffer com o processo (best-effort com timeout curto).
 */
export async function flushErrorTracker(timeoutMs = 2000): Promise<void> {
  try {
    await Sentry.flush(timeoutMs);
  } catch {
    /* jamais bloqueia o shutdown */
  }
}
