/**
 * Regras puras do convite de compartilhamento de agenda (spec
 * `.ia/specs/compartilhamento/compartilhamento-agenda-par.spec.md` A.4/A.5;
 * decisoes D4/D12/D13 do plano). Espelho de `password-reset.ts`: `now`/janela/
 * teto por parametro, zero I/O — TDD obrigatorio pela regra de testing
 * (quota/data). Nada aqui toca Prisma/relógio real.
 *
 * Diferenca honesta vs. o reset: aqui a quota e POR PAR ORDENADO (a linha
 * `shared_agendas` persiste entre reconvites — D13), a serie da janela e
 * montada pelo service (`inviteSentAt` da linha + eventos de auditoria
 * `invite_created`/`invite_resent` do par). Quota estourada = SILÊNCIO total
 * (202 uniforme — D5), entao a unica acao possivel e nenhum efeito.
 */

/** TTL do convite: 24 horas (spec A.5, [Aberto #1]: nao respondido em 24h = recusa automatica). */
export const INVITE_TTL_MS = 24 * 3600_000;

/** Janela deslizante da quota de convite: 30 minutos (spec A.4). */
export const INVITE_WINDOW_MS = 30 * 60_000;

/** Teto da janela: máx. 3 convites por par ordenado (spec A.4, literal). */
export const MAX_INVITES_PER_PAIR_PER_WINDOW = 3;

export interface InviteQuotaResult {
  allowed: boolean;
  /** Envios ainda disponíveis na janela (0 quando bloqueado). */
  restantes: number;
  /** Quando o próximo envio libera (null se permitido); a UI nunca mostra isto — quota é invisível (D5). */
  retryInMs: number | null;
}

/**
 * Quota de convites do par: conta TODOS os `sentAt` da janela deslizante
 * (espelho exato de `evaluateResetQuota` — janela estrita `> windowStart`,
 * sem "original grátis"). A serie entra pronta (Service monta de
 * `inviteSentAt` + auditoria; testes congelam `now`).
 */
export function evaluateInviteQuota(
  sends: readonly { sentAt: Date }[],
  now: Date,
  windowMs: number = INVITE_WINDOW_MS,
  maxSends: number = MAX_INVITES_PER_PAIR_PER_WINDOW,
): InviteQuotaResult {
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

/** O minimo que a pura precisa da linha (a coluna `status` é varchar no Prisma — D11). */
export interface InviteRow {
  status: string;
  inviteExpiresAt: Date | null;
}

/**
 * Convite VIVO: só `pending` com `inviteExpiresAt` estritamente no futuro
 * (exactly-now = morto, mesma régua de `resetTokenIsLive`). active/revoked
 * nunca sao convite vivo. Expiracao checada NA HORA (D4) — sem cron.
 */
export function inviteIsLive(row: InviteRow, now: Date): boolean {
  return (
    row.status === 'pending' &&
    row.inviteExpiresAt !== null &&
    row.inviteExpiresAt.getTime() > now.getTime()
  );
}

/**
 * Status efetivo para QUALQUER leitor (lista/aceite/revogação — spec A.5):
 * `pending` NA0 vivo (expirado na hora) é tratado como `revoked` sem escrever
 * nada. O kind `invite_expired_auto` é gravado pelo SERVICE quando pisa na
 * linha morta (D4 — melhor esforço, o tipo do retorno é o enum dos contracts).
 */
export function effectiveStatus(row: InviteRow, now: Date): 'pending' | 'active' | 'revoked' {
  if (row.status === 'pending' && !inviteIsLive(row, now)) return 'revoked';
  if (row.status === 'active') return 'active';
  if (row.status === 'pending') return 'pending';
  return 'revoked';
}
