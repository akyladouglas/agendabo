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
};
