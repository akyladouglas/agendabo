/**
 * Fábrica central de query keys do TanStack Query. Toda invalidacao/consulta
 * usa estas chaves — nunca strings soltas.
 */
export const qk = {
  me: ['me'] as const,
  /**
   * Compartilhamento (spec C.17 / decisão D9): a chave TEM a dimensão de FONTE —
   * `owner = null` é a agenda própria (sentinela 'me'), `owner = <uuid>` a
   * emprestada. Cache nunca mistura itens de agendas diferentes.
   */
  appointments: (from: string, to: string, owner?: string | null) =>
    ['appointments', owner ?? 'me', from, to] as const,
  /** Prefixo amplo p/ invalidar todas as janelas de uma vez (todas as fontes). */
  appointmentsAll: ['appointments'] as const,
  review: ['review'] as const,
  profile: ['profile'] as const,
  /** Sessao 24h: GET /auth/sessions (dispositivos logados). */
  sessions: ['sessions'] as const,
  /** Fase 9 (página Admin): flags de papel, eventos do bot, custo de LLM, usuários. */
  obsMe: ['obs', 'me'] as const,
  botEvents: (params: Record<string, string | number | undefined>) =>
    ['bot-events', params] as const,
  llmUsage: (params: Record<string, string | undefined>) => ['llm-usage', params] as const,
  adminUsers: ['admin', 'users'] as const,
  /** GET /shared-agendas — vínculos enviados + recebidos (spec D.21). */
  sharedAgendas: ['shared-agendas'] as const,
  /** GET /shared-agendas/audit — histórico paginado POR vínculo (spec F.4). */
  sharedAudit: (linkId: string, cursor: string | null) =>
    ['shared-audit', linkId, cursor] as const,
};
