/**
 * Regra pura do teto absoluto de sessão (spec sessão-24h, decisão humana nº 1):
 * a cadeia de refresh tokens morre em `loginAt + absoluteTtlMs` independentemente
 * de atividade. A cada rotação o novo token HERDA o `loginAt` e recebe
 * `expiresAt = min(now + refreshTtlMs, teto)`. Regra de data → TDD obrigatório
 * (testing.md): tempo entra TODO por parâmetro, nada de `Date.now()` aqui.
 */

export interface SessionExpiryInput {
  /** Instante atual (injetado pela borda — nunca lido do relógio real aqui). */
  now: Date;
  /** Instante do LOGIN que originou a cadeia (herdado a cada rotação). */
  loginAt: Date;
  /** Teto absoluto da sessão (SESSION_ABSOLUTE_TTL_HOURS em ms). */
  absoluteTtlMs: number;
  /** TTL deslizante do refresh (REFRESH_TOKEN_TTL_DAYS em ms) — só teto, nunca além dele. */
  refreshTtlMs: number;
}

export interface SessionExpiryResult {
  /** true quando `now >= loginAt + absoluteTtlMs` — a cadeia morreu, não rotaciona. */
  expired: boolean;
  /** `min(now + refreshTtlMs, teto)` — o expiresAt real do novo token (maxAge do cookie). */
  expiresAt: Date;
}

/**
 * `expired = now >= cap` (exatamente no cap já está morta — decisão da spec:
 * "agora >= teto" morre). Fora disso o expiresAt é o refresh TTL CAPADO no teto.
 */
export function computeSessionExpiry(input: SessionExpiryInput): SessionExpiryResult {
  const cap = input.loginAt.getTime() + input.absoluteTtlMs;
  const nowMs = input.now.getTime();
  if (nowMs >= cap) {
    return { expired: true, expiresAt: new Date(cap) };
  }
  return { expired: false, expiresAt: new Date(Math.min(nowMs + input.refreshTtlMs, cap)) };
}
