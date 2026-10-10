/**
 * Fábrica central de query keys do TanStack Query. Toda invalidacao/consulta
 * usa estas chaves — nunca strings soltas.
 */
export const qk = {
  me: ['me'] as const,
  appointments: (from: string, to: string) => ['appointments', from, to] as const,
  /** Prefixo amplo p/ invalidar todas as janelas de uma vez. */
  appointmentsAll: ['appointments'] as const,
  review: ['review'] as const,
  profile: ['profile'] as const,
  /** Fase 9 (página Admin): flags de papel, eventos do bot, custo de LLM, usuários. */
  obsMe: ['obs', 'me'] as const,
  botEvents: (params: Record<string, string | number | undefined>) =>
    ['bot-events', params] as const,
  llmUsage: (params: Record<string, string | undefined>) => ['llm-usage', params] as const,
  adminUsers: ['admin', 'users'] as const,
};
