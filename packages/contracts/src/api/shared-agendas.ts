import { z } from 'zod';
import { isoDateSchema } from '../primitives';
import { emailSchema } from '../entities/user';

/**
 * Contratos do compartilhamento de agenda entre usuarios (par, somente leitura)
 * — spec `.ia/specs/compartilhamento/compartilhamento-agenda-par.spec.md`
 * (blocos A, B.12-13, E.24, F.2/F.4) e plano
 * `ia-docs/plans/compartilhamento-agenda-par.plan.md` (decisoes D2/D3/D5/D10).
 *
 * Regra central da feature: o convidado ve a agenda EMPRESTADA do dono e nunca
 * escreve nela. Por isso NENHUM schema de escrita de compromisso ganha dono
 * (B.15) e o payload emprestado (`sharedAppointmentSchema`) e um subconjunto
 * SEM os campos de revisao do dono (`rawText`/`reviewReason`) e sem
 * `notificationRules` (B.13 / decisao P5).
 */

/** Status do vinculo (spec A.1). Espelha a coluna varchar-checkada `shared_agendas.status`. */
export const sharedAgendaStatusSchema = z.enum(['pending', 'active', 'revoked']);
export type SharedAgendaStatus = z.infer<typeof sharedAgendaStatusSchema>;

/** Papel do convidado no vinculo — fixo `read` no v1 (spec A.1, decisao P1). */
export const sharedAgendaReadRoleSchema = z.literal('read');
export type SharedAgendaReadRole = z.infer<typeof sharedAgendaReadRoleSchema>;

/** Posicao do usuario na listagem (spec A.10): quem enviou vs. quem recebeu. */
export const sharedAgendaRoleSchema = z.enum(['owner', 'guest']);
export type SharedAgendaRole = z.infer<typeof sharedAgendaRoleSchema>;

/**
 * POST /shared-agendas — o dono convida pelo EMAIL (spec A.2). Borda strict.
 * `emailSchema` (trim+lowercase) — mesma normalizacao do cadastro; sem isso,
 * "Email@Upper" nunca casaria com o e-mail normalizado do guest (M1/review).
 */
export const sharedInviteInputSchema = z
  .object({
    email: emailSchema,
  })
  .strict();
export type SharedInviteInput = z.infer<typeof sharedInviteInputSchema>;

/**
 * POST /shared-agendas/accept e /decline — o token opaco vai no BODY (decisao
 * D10: convidado = a propria sessao; o token e a unica coisa que atravessa a
 * URL, na tela /convite-agenda?token=). NAO ha id de vinculo em query (A.7).
 */
export const sharedInviteTokenSchema = z
  .object({
    token: z.string().min(16).max(128),
  })
  .strict();
export type SharedInviteTokenInput = z.infer<typeof sharedInviteTokenSchema>;

/**
 * Item da listagem GET /shared-agendas (spec A.10).
 *
 * `contraparte` carrega `email?` e `name?` AMBOS opcionais porque a exibicao e
 * assimetrica (decisao A2 da spec): na lista de ENVIADOS o convidado so aparece
 * por EMAIL enquanto o convite nao estiver ativo (o nome da conta so aparece
 * quando ativo); na lista de RECEBIDOS mostra-se o NOME do dono. O service
 * preenche os campos conforme a regra; a UI decide o que mostrar por `papel` +
 * `status` — o contrato nao obriga um nem outro.
 */
export const sharedAgendaListItemSchema = z.object({
  id: z.string().uuid(),
  /**
   * UUID do DONO da agenda no vinculo (coluna `ownerId` de shared_agendas) —
   * permite a web montar `GET /appointments?owner=<ownerId>` na leitura
   * emprestada (B.12; decisao humana 2026-10-12). `optional()` para nao quebrar
   * itens onde nao se aplica; o consumidor web trata fallback.
   */
  ownerId: z.string().uuid().optional(),
  /** Posicao do usuario que pediu a lista nesse vinculo. */
  papel: sharedAgendaRoleSchema,
  status: sharedAgendaStatusSchema,
  contraparte: z.object({
    email: z.string().email().optional(),
    name: z.string().nullable().optional(),
  }),
  inviteSentAt: isoDateSchema.nullable(),
  inviteExpiresAt: isoDateSchema.nullable(),
  createdAt: isoDateSchema,
  acceptedAt: isoDateSchema.nullable(),
  revokedAt: isoDateSchema.nullable(),
});
export type SharedAgendaListItem = z.infer<typeof sharedAgendaListItemSchema>;

/** GET /shared-agendas — enviados (enviei) + recebidos (recebi). Sem paginacao no v1 (F.6). */
export const sharedAgendaListSchema = z.object({
  sent: z.array(sharedAgendaListItemSchema),
  received: z.array(sharedAgendaListItemSchema),
});
export type SharedAgendaList = z.infer<typeof sharedAgendaListSchema>;

/**
 * Kinds da auditoria de compartilhamento (spec F.4) — a lista exata da spec,
 * em constante testavel (F.4 exige isso). Espelha a coluna `kind` de
 * `shared_agenda_audit_events`.
 */
export const SHARED_AUDIT_KINDS = [
  'invite_created',
  'invite_resent',
  'invite_email_failed',
  'invite_accepted',
  'invite_declined',
  'invite_expired_auto',
  'access_revoked',
  'guest_left',
  'access_read',
  'write_denied',
  'shared_section_built',
] as const;
export const sharedAuditKindSchema = z.enum(SHARED_AUDIT_KINDS);
export type SharedAuditKind = z.infer<typeof sharedAuditKindSchema>;

/**
 * Metadata da auditoria por kind (spec F.4): zod `.strict()` em CADA variante,
 * SOMENTE uuids/inteiros/booleanos/enums/timestamps ISO — NUNCA string livre de
 * conteudo (titulo/nota/fala/email de compromisso). Chave desconhecida = 400:
 * conteudo disfarçado nao entra na tabela (mesmo padrao do ADR-0017 em
 * `observability.ts`).
 */
export const sharedAuditMetadataSchemas = {
  /** Convite criado para o par (ids apenas no evento via colunas ownerId/guestId). */
  invite_created: z.object({}).strict(),
  /**
   * Reenvio na mesma linha do par (D13): `invitesInWindow` = convites contados
   * na janela de 30min apos este envio (informativo; a decisao e do service).
   */
  invite_resent: z.object({ invitesInWindow: z.number().int().min(0).optional() }).strict(),
  /** Resend falhou (log interno + 202 uniforme — spec A.6). */
  invite_email_failed: z.object({}).strict(),
  invite_accepted: z.object({}).strict(),
  invite_declined: z.object({}).strict(),
  /** Convite pendente pego expirado por leitor/acao (decisao D4 — sem cron). */
  invite_expired_auto: z.object({}).strict(),
  /** Dono revogou vinculo ativo (spec A.9). */
  access_revoked: z.object({}).strict(),
  /** Convidado saiu do compartilhamento (spec A.9). */
  guest_left: z.object({}).strict(),
  /** `count` = compromissos confirmados devolvidos na leitura emprestada. */
  access_read: z.object({ count: z.number().int().min(0) }).strict(),
  /** Bot negou escrita na agenda emprestada (spec E.25). */
  write_denied: z.object({}).strict(),
  /** `count` = itens do dono na secao compartilhada do digest (decisao D8). */
  shared_section_built: z.object({ count: z.number().int().min(0) }).strict(),
} as const satisfies Record<SharedAuditKind, z.ZodType>;

/**
 * Parse na borda de escrita (service fino, padrao `parseBotEventMetadata`):
 * metadata validada AANTES de gravar; kind desconhecido nem chega aqui (o enum
 * fecha antes).
 */
export function parseSharedAuditMetadata(kind: SharedAuditKind, metadata: unknown): unknown {
  return sharedAuditMetadataSchemas[kind].parse(metadata);
}

/**
 * GET /shared-agendas/audit (spec F.4) — so o dono ou o convidado do vinculo veem
 * os proprios eventos (autorizacao no service; o uuid do vinculo e filtro, nao
 * identidade do chamador). Paginacao por cursor opaco.
 */
export const sharedAuditQuerySchema = z.object({
  sharedAgendaId: z.string().uuid(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type SharedAuditQuery = z.infer<typeof sharedAuditQuerySchema>;

/** Pagina de auditoria (leitura). `metadata` ja foi validada na escrita; aqui e espelho. */
export const sharedAuditPageSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      occurredAt: isoDateSchema,
      kind: sharedAuditKindSchema,
      metadata: z.unknown(),
    }),
  ),
  nextCursor: z.string().nullable(),
});
export type SharedAuditPage = z.infer<typeof sharedAuditPageSchema>;

/**
 * Compromisso na agenda EMPRESTADA (spec B.13, decisao D3): subconjunto de
 * `appointmentSchema` (entities/appointment) SEM `rawText`/`reviewReason`
 * (fila de revisao do dono e privada — decisao P5) e SEM `notificationRules`
 * (o convidado nao gerencia lembrete de nada). `status` e tipado com o enum
 * completo para nao divergir do entity, mas o service NUNCA emite
 * `needs_review`: o where do lado convidado fixa `confirmed` (B.13). O zod de
 * resposta faz strip: mesmo que a consulta errasse, campo de revisao nao
 * sobrevive ao parse na web (ausencia estrutural).
 */
export const sharedAppointmentSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200),
  startsAt: isoDateSchema,
  endsAt: isoDateSchema,
  notes: z.string().max(2000).nullable(),
  status: z.enum(['confirmed', 'needs_review']),
  createdAt: isoDateSchema,
});
export type SharedAppointmentDto = z.infer<typeof sharedAppointmentSchema>;

/** Resposta de GET /appointments?owner= (mesmo shape `{ items }` da list propria). */
export const sharedAppointmentListResultSchema = z.object({
  items: z.array(sharedAppointmentSchema),
});
export type SharedAppointmentListResult = z.infer<typeof sharedAppointmentListResultSchema>;
