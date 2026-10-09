import { Logger } from '@nestjs/common';
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
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    // nada de anonimato a mais: a politica e a funcao pura testada (spec A5)
    beforeSend: (event) => scrubEvent(event as never) as never,
    // O SDK NAO coleta PII por default no node (sendDefaultPii nao existe no
    // v11 — a ausencia e a politica); o pente-fino duro e o scrub acima.
    attachStacktrace: true,
  });
  Sentry.setTag('process', processName);
  logger.log(`tracker de erros ativo (${processName})`);
}
