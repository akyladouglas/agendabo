import * as Sentry from '@sentry/vue';
import type { App } from 'vue';
import { scrubEvent } from '@agendabo/schedule-core';
import { env } from './env';

/**
 * Tracker de erros da web (Fase 9, ADR-0016): SDK Sentry -> GlitchTip SaaS.
 * Sem `VITE_SENTRY_DSN` nao inicia (dev nao polui). A politica de privacidade
 * e a FUNCAO PURA do schedule-core (`scrubEvent`, userId-only) — a MESMA dos
 * processos do server, via alias ADR-005; nao ha regra duplicada aqui. No
 * login o authStore chama `setTrackerUser(id)` com o uuid interno da sessao
 * (o unico identificador permitido no tracker); no logout, null.
 */
export function setupErrorTracker(app: App): void {
  if (!env.sentryDsn) return;
  Sentry.init({
    app,
    dsn: env.sentryDsn,
    environment: env.sentryEnvironment ?? 'development',
    // tracing OFF por default (decisao #7 do humano); religar = ADR novo
    tracesSampleRate: 0,
    // P0-1a (defesa dupla): o browser nao lista anexos nos defaults, e o pinia
    // plugin so existe se nos registrarmos — jamais registrar (o estado dos
    // stores tem e-mail). Hint.attachments e zerado pelo scrubEvent de qualquer
    // forma. `normalizeDepth` limitado + max string length = o scrub varre uma
    // arvore previsivel (P2-12 do review).
    normalizeDepth: 3,
    maxValueLength: 250,
    // sendDefaultPii nao existe no @sentry/vue v11 (a ausencia e a politica):
    // o browser tambem nao manda PII default; o pente-fino e o scrubEvent.
    beforeSend: (event, hint) => scrubEvent(event as never, hint as never) as never,
  });
}

/** Marca o evento com o uuid interno do usuario logado (ou desmarca no logout). */
export function setTrackerUser(userId: string | null): void {
  if (!env.sentryDsn) return;
  Sentry.setUser(userId ? { id: userId } : null);
}
