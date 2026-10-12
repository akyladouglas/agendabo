import type { SharedAgendaListItem, SharedAgendaStatus, SharedAuditKind } from '@agendabo/contracts';
import { formatDateTimeInTz } from './tz';

/**
 * Exibição pura do compartilhamento (spec D.21/F.4) — sem query, sem estado:
 * rotação PT do status, rótulo do histórico, e a ASSIMETRIA de privacidade da
 * decisão A2: lista de ENVIADOS mostra SEMPRE o email do convidado (o nome da
 * conta nunca aparece, nem ativo); RECEBIDOS mostra o NOME do dono. A função é
 * única e o papel é argumento — a UI não tem como vazar o nome de um enviado.
 */

/** Rótulo PT do status (a coluna é `pending | active | revoked` — spec A.1). */
export function sharedStatusLabel(status: SharedAgendaStatus): string {
  switch (status) {
    case 'pending':
      return 'pendente';
    case 'active':
      return 'ativo';
    case 'revoked':
      return 'revogado';
  }
}

/**
 * Status estendido do item (D.21): pendente ganha "· expira ‹data/hora›" no fuso
 * do VISUALIZADOR (exibição na borda — `formatDateTimeInTz` é tz do usuário).
 * Sem `inviteExpiresAt` (defensivo: pendente vivo sempre tem) = só o rótulo.
 */
export function sharedStatusLine(item: SharedAgendaListItem, timezone: string): string {
  const base = sharedStatusLabel(item.status);
  if (item.status === 'pending' && item.inviteExpiresAt) {
    return `${base} · expira ${formatDateTimeInTz(item.inviteExpiresAt, timezone)}`;
  }
  return base;
}

/** Nome do dono para exibição (recebidos) — sem nome vira texto neutro, nunca "null"/email. */
export function sharedOwnerName(item: SharedAgendaListItem): string {
  const name = item.contraparte.name?.trim();
  return name || 'Alguém';
}

/** Identificação da contraparte na lista de ENVIADOS (A2): SEMPRE o email. */
export function sharedInviteeEmail(item: SharedAgendaListItem): string {
  return item.contraparte.email ?? '—';
}

/**
 * Identificação da contraparte POR PAPEL (decisão A2 — o papel é argumento, a UI
 * não tem como escolher errado): enviado ⇒ SEMPRE o email; recebido ⇒ o nome.
 */
export function sharedCounterpartLabel(item: SharedAgendaListItem): string {
  return item.papel === 'owner' ? sharedInviteeEmail(item) : sharedOwnerName(item);
}

/** Os 11 kinds da auditoria (SHARED_AUDIT_KINDS) em PT-BR (spec F.4 / D.21). */
export const SHARED_AUDIT_KIND_LABELS: Record<SharedAuditKind, string> = {
  invite_created: 'convite enviado',
  invite_resent: 'convite reenviado',
  invite_email_failed: 'e-mail do convite falhou',
  invite_accepted: 'convite aceito',
  invite_declined: 'convite recusado',
  invite_expired_auto: 'convite expirado',
  access_revoked: 'acesso encerrado pelo dono',
  guest_left: 'convidado saiu do compartilhamento',
  access_read: 'leitura da agenda',
  write_denied: 'tentativa de escrita negada',
  shared_section_built: 'seção do resumo montada',
};

/** Rótulo do evento de auditoria (kind desconhecido não passa do zod da query). */
export function sharedAuditKindLabel(kind: SharedAuditKind): string {
  return SHARED_AUDIT_KIND_LABELS[kind] ?? kind;
}

/**
 * Detalhe do evento de auditoria: a metadata é `.strict()` e só carrega
 * quantidades (F.4 — nunca conteúdo); aqui só traduz `count`/`invitesInWindow`.
 */
export function sharedAuditDetail(kind: SharedAuditKind, metadata: unknown): string {
  const m = metadata as { count?: number; invitesInWindow?: number } | null;
  if (kind === 'access_read' || kind === 'shared_section_built') {
    return typeof m?.count === 'number' ? `${m.count} compromisso${m.count === 1 ? '' : 's'}` : '';
  }
  if (kind === 'invite_resent') {
    return typeof m?.invitesInWindow === 'number' ? `${m.invitesInWindow}º envio na janela` : '';
  }
  return '';
}
