import { measureTzOffset } from './tz';

/**
 * Borda de filtros de data (página Admin): o usuário escolhe DIAS CIVIS no
 * fuso dele; a API espera UTC. `localEndOfDayUtc` converte "até o dia X" para
 * o último instante do dia civil do usuário em UTC (23:59:59.999 local → UTC).
 * Convenção de sinal idêntica a `localDateTimeToUtc` do tz.ts:
 * `utc = local_wallclock − offset`. O offset é o observado no meio-dia local
 * (técnica DST-safe do tz.ts: meio-dia local nunca cai em transição de fuso).
 * Só mede offset via Intl — nenhum cálculo de período/conflito aqui.
 */
export function localEndOfDayUtc(dateKey: string, timezone: string): string {
  const noonUtc = Date.parse(`${dateKey}T12:00:00Z`);
  const offsetMs = measureTzOffset(timezone, new Date(noonUtc)) * 60_000;
  return new Date(Date.parse(`${dateKey}T23:59:59.999Z`) - offsetMs).toISOString();
}
