export const env = {
  apiBaseUrl: import.meta.env.VITE_API_URL ?? '/api',
  /** Fase 9 (observabilidade): DSN do tracker (GlitchTip via SDK Sentry — ADR-0016).
   *  Ausente = tracker desligado (dev não polui; build sem segredo funciona). */
  sentryDsn: import.meta.env.VITE_SENTRY_DSN as string | undefined,
  sentryEnvironment: import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined,
} as const;
