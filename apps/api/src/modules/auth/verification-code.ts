import { createHash, randomBytes } from 'node:crypto';

/** SHA-256 hex — hash do codigo de verificacao (guardado em VerificationCode.codeHash). */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Rate-limit persistido de reenvio de codigo (3.1.1 / ADR-002): no maximo
 * MAX_RESENDS_PER_WINDOW REENVIOS por janela deslizante de 30 min por email.
 * `sentAts` sao os timestamps de TODOS os envios daquele email; o envio mais
 * antigo da janela e tratado como o original (nao conta como reenvio).
 */
export const RESEND_WINDOW_MS = 30 * 60_000;
export const MAX_RESENDS_PER_WINDOW = 3;

export interface ResendQuotaResult {
  allowed: boolean;
  reenviosRestantes: number;
  /** true = a conta tem codigo pendente Porem expirado: reenviar e a unica saida,
   *  entao nao cobramos quota (senão o usuario ficaria preso — decide por idade,
   *  o que vale tbm para conta criada antes de existir resend). */
  expired: boolean;
  /** Quando o proximo reenvio libera (null se permitido/sem historico). */
  retryInMs: number | null;
}

export function evaluateResendQuota(
  sends: readonly { sentAt: Date; expiresAt: Date; usedAt: Date | null }[],
  now: Date,
  windowMs: number = RESEND_WINDOW_MS,
  maxResends: number = MAX_RESENDS_PER_WINDOW,
): ResendQuotaResult {
  const active = sends.find((s) => !s.usedAt && s.expiresAt.getTime() > now.getTime());
  if (!active) {
    return { allowed: true, reenviosRestantes: maxResends, expired: true, retryInMs: null };
  }

  const windowStart = now.getTime() - windowMs;
  const inWindow = sends
    .map((s) => s.sentAt.getTime())
    .filter((t) => t > windowStart)
    .sort((a, b) => a - b);

  const reenviosUsados = Math.max(0, inWindow.length - 1);
  const reenviosRestantes = Math.max(0, maxResends - reenviosUsados);

  if (reenviosRestantes > 0) {
    return { allowed: true, reenviosRestantes, expired: false, retryInMs: null };
  }

  // Janela cheia: libera quando o envio mais antigo da janela sair dela.
  const oldestInWindow = inWindow[0] ?? now.getTime();
  const retryInMs = Math.max(0, oldestInWindow + windowMs - now.getTime());
  return { allowed: false, reenviosRestantes: 0, expired: false, retryInMs };
}

/** Codigo numerico de 6 digitos com CSPRNG. */
export function generateNumericCode(): string {
  return String(randomBytes(3).readUIntBE(0, 3) % 1_000_000).padStart(6, '0');
}
