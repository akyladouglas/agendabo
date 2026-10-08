import type { AxiosError } from 'axios';

/** Payload 409 da API (appointments/review): `{ message, conflictWith }`. */
export interface ConflictBody {
  message?: string;
  conflictWith?: { title: string; startsAt: string; endsAt: string } | null;
}

/**
 * 409 de conflito (D6/18): a mensagem formatada vive na API; quando o payload traz
 * `conflictWith`, quem exibe reformata o horário no fuso do usuário (a UI nunca
 * mostra o ISO cru). Retorna null para erros que NÃO são conflito.
 */
export function conflictMessage(
  err: unknown,
  formatRange?: (startsAt: Date, endsAt: Date) => string,
): string | null {
  const status = (err as AxiosError<ConflictBody> | null)?.response?.status;
  if (status !== 409) return null;
  const data = (err as AxiosError<ConflictBody>).response?.data;
  const c = data?.conflictWith;
  if (c && formatRange) {
    return `Conflito com "${c.title}" (${formatRange(new Date(c.startsAt), new Date(c.endsAt))})`;
  }
  return data?.message ?? 'Conflito com outro compromisso.';
}
