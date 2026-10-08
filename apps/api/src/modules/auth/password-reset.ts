/**
 * Regras puras do "Esqueci a senha" (spec esqueci-a-senha): quota do link de
 * reset e constantes de validade. `now`/janela/teto por parâmetro — TDD
 * obrigatório pela regra de testing (quota/data). Nada aqui toca Prisma/relógio real.
 *
 * Diferença honesta vs. `evaluateResendQuota` do cadastro: lá o envio mais antigo
 * da janela é o "original" (não conta como reenvio) e código expirado libera
 * reenvio gratuito; aqui a janela é fixa e TODA linha de `password_reset` conta
 * (2 pedidos por 10min, ponto final) — e a resposta é sempre 202 uniforme, então
 * a única ação possível quando estoura é SILÊNCIO (decisão D5 da spec).
 */

/** Janela deslizante da quota de reset: 10 minutos. */
export const RESET_WINDOW_MS = 10 * 60_000;

/** Teto da janela: máx. 2 envios de link de reset por e-mail. */
export const MAX_RESETS_PER_WINDOW = 2;

/** TTL do magic link de reset: 1 hora (decisão D2/Aberto #1 da spec). */
export const RESET_TOKEN_TTL_MS = 60 * 60_000;

export interface ResetQuotaResult {
  allowed: boolean;
  /** Envios ainda disponíveis na janela (0 quando bloqueado). */
  restantes: number;
  /** Quando o próximo envio libera (null se permitido); a UI nunca mostra isto — quota é invisível aqui. */
  retryInMs: number | null;
}

/**
 * Quota de envios do link de reset: conta TODOS os `sentAt` da janela deslizante
 * (diferente do resend do cadastro: sem "original grátis", sem caso `expired`).
 */
export function evaluateResetQuota(
  sends: readonly { sentAt: Date }[],
  now: Date,
  windowMs: number = RESET_WINDOW_MS,
  maxSends: number = MAX_RESETS_PER_WINDOW,
): ResetQuotaResult {
  const windowStart = now.getTime() - windowMs;
  const inWindow = sends
    .map((s) => s.sentAt.getTime())
    .filter((t) => t > windowStart)
    .sort((a, b) => a - b);

  const restantes = Math.max(0, maxSends - inWindow.length);
  if (restantes > 0) {
    return { allowed: true, restantes, retryInMs: null };
  }

  // Janela cheia: libera quando o envio mais antigo da janela sair dela.
  const oldestInWindow = inWindow[0] ?? now.getTime();
  const retryInMs = Math.max(0, oldestInWindow + windowMs - now.getTime());
  return { allowed: false, restantes: 0, retryInMs };
}

/** Validade do token: `expiresAt` estritamente no futuro (agora == expirado). */
export function resetTokenIsLive(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() > now.getTime();
}
