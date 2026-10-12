import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import {
  sharedAgendaListSchema,
  sharedInviteInputSchema,
  sharedInviteTokenSchema,
  type SharedAgendaList,
} from '@agendabo/contracts';
import type { Env } from '../../config/env.validation';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { TelegramClientService } from '../../shared/telegram/telegram-client.service';
import { randomToken, sha256Hex } from '../auth/auth.service';
import { MailService } from '../auth/mail.service';
import { SharedAgendaAuditService } from './shared-agenda-audit.service';
import { sharedAgendaInviteEmailHtml } from './shared-agenda-invite-email';
import {
  effectiveStatus,
  evaluateInviteQuota,
  inviteIsLive,
  INVITE_TTL_MS,
  INVITE_WINDOW_MS,
} from './shared-invite';

/**
 * Erro de dominio do convite (spec A.5): inexistente/usado/expirado/para-outro
 * caem TODOS aqui — o controller mapeia para o 410 generico
 * `shared_invite_invalid` (mesmo padrao de `ResetTokenInvalidError`). A web
 * mostra o MESMO card unico em qualquer sabor.
 */
export class SharedInviteInvalidError extends Error {}

/**
 * Normalizacao de email na comparacao de autoconvite (defesa em profundidade):
 * a coluna `email` do banco e gravada pela `emailSchema` dos contracts
 * (trim+lowercase), mas comparamos os dois lados normalizados para o caso de
 * linha historica com caixa diferente. O zod do input NAO e lowercase, entao
 * `email` cru pode chegar com caixa — o findUnique por email segue o padrao do
 * signup/reset (busca exata, coluna normalizada).
 */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Resultado do convite — 'ignored' engloba TODOS os sabores silenciosos (D5). */
export type InviteOutcome = 'created' | 'resent' | 'ignored';

/**
 * Mensagens fixas do aviso A.3 (revogação/saída) — SEM conteudo de compromisso
 * (so estado do vinculo). VIVAS em `BOT_MESSAGES.sharedAccessEnded/sharedGuestLeft`
 * (os unicos consumidores do grafo sao modules/bot e modules/notifications); o
 * shared-agendas NAO importa modules/bot (aresta nunca declarada no grafo),
 * entao o texto e duplicado AQUI com comentario-fonte. Se a string mudar, mude
 * la e ca juntas (testes dos dois lados travam divergencia).
 */
const SHARED_ACCESS_ENDED = (ownerName: string) =>
  `O acesso à agenda de ${ownerName} foi encerrado.`;
const SHARED_GUEST_LEFT = (guestName: string) =>
  `${guestName} saiu do compartilhamento da sua agenda.`;
// T5 (review): a trava de divergência mora em `shared-strings-lock.service.spec`
// (importa os dois lados e compara com exemplo parametrizado — um muda, o outro
// falha). As constantes continuam AQUI (o grafo não muda: shared-agendas nunca
// importa modules/bot).
export { SHARED_ACCESS_ENDED, SHARED_GUEST_LEFT };

/** Escapa texto dinâmico p/ parse_mode HTML do Telegram (gotcha 6). */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Linha minima que a pura `effectiveStatus`/quota precisa (Prisma: status/role sao varchar). */
type LinkRow = {
  id: string;
  status: string;
  role: string;
  tokenHash: string | null;
  inviteSentAt: Date | null;
  inviteExpiresAt: Date | null;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  ownerId: string;
  guestId: string;
};

/**
 * Compartilhamento de agenda (spec bloco A; plano D1/D4/D5/D10/D13). Orquestracao
 * pura: decisoes de quota/validade moram em `shared-invite.ts` (puro, TDD);
 * aqui é Prisma/mail/auditoria. O aviso A.3 (mensagem LEVE do bot a quem perdeu o
 * acesso) mora no `revoke` — best-effort via TelegramClientService, sem nenhum
 * conteudo de compromisso na mensagem.
 *
 * Anti-enumeration por construcao (F.1): `invite` retorna sempre o mesmo shape
 * para o controller (202 `{}`) e os casos silenciosos (autoconvite, email
 * inexistente, nao confirmado, quota, P2002, linha active) NAO tem nenhum
 * efeito observavel — nem auditoria (a tabela de auditoria é visivel na UI;
 * um evento "tentativa contra email inexistente" seria oracle e nao tem
 * guestId real para carregar na metadata da F.4).
 */
@Injectable()
export class SharedAgendasService {
  private readonly logger = new Logger(SharedAgendasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: SharedAgendaAuditService,
    private readonly config: ConfigService<Env, true>,
    /** Aviso A.3 (revoke): Telegram e @Global; a mensagem nunca carrega conteudo de compromisso. */
    private readonly telegram: TelegramClientService,
  ) {}

  /**
   * POST /shared-agendas — o dono convida pelo email. Anti-enumeration (A.2):
   * qualquer entrada produz a mesma resposta HTTP (202 `{}` no controller);
   * o retorno distingue apenas caminhos INTERNOS (nenhum efeito nos 'ignored').
   * Casos (spec A.2-A.6 + decisoes da Etapa 2):
   *  - autoconvite / email inexistente / nao confirmado: 'ignored', zero efeito;
   *  - linha `active` do par: 'ignored' (decisao de execucao — a spec nao pede
   *    "reconvite" de vinculo ativo; reenvio e so de pendente);
   *  - pending VIVA: reenvio — quota primeiro; negada = 'ignored' sem nenhum
   *    efeito (D5); permitida = MESMA linha com token novo (o link antigo morre);
   *  - pending MORTA (expirada na hora — D4): reconvite na mesma linha + traco
   *    `invite_expired_auto` (aceitavel duplicar se o dono "reenviar" 2x na
   *    janela — documentado no teste);
   *  - `revoked`: volta a `pending` com token novo (mesma linha — A.9);
   *  - sem linha: create `pending` role `read`; corrida no indice parcial unico
   *    do tokenHash (P2002) = 'ignored' silencioso (padrao password-reset I1).
   * E-mail SEMPRE best-effort (A.6): falha = audit `invite_email_failed` +
   * log interno; o token fica criado e o 202 e o mesmo.
   */
  async invite(actorUserId: string, raw: unknown, now: Date = new Date()): Promise<InviteOutcome> {
    const { email } = sharedInviteInputSchema.parse(raw);

    const session = await this.prisma.user.findUnique({
      where: { id: actorUserId },
      select: { id: true, email: true, name: true },
    });
    // sessao existe (guard garante) — o select e defensivo; sem ele nao ha como
    // montar o e-mail do dono com seguranca (escapeHtml do nome).
    if (!session) return 'ignored';

    // autoconvite: falha silenciosa (A.3). Comparacao pos-zod com os dois
    // lados normalizados (defesa em profundidade — ver normalizeEmail).
    if (normalizeEmail(email) === normalizeEmail(session.email)) return 'ignored';

    const guest = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, emailConfirmedAt: true },
    });
    // inexistente ou pendente de confirmacao: mesmo silencio (A.2/P5-inverso, A.11).
    if (!guest || !guest.emailConfirmedAt) return 'ignored';

    const existing = await this.prisma.sharedAgenda.findFirst({
      where: { ownerId: session.id, guestId: guest.id },
    });

    if (existing) {
      const status = effectiveStatus(existing, now);
      if (status === 'active') return 'ignored'; // decisao de execucao (documentada acima)

      // pending VIVA (reenvio), pending MORTA (expirada — D4) e revoked (A.9)
      // seguem o MESMO caminho: quota primeiro (D5: negada = zero efeito),
      // depois reconvite na MESMA linha.
      if (!(await this.quotaAllows(existing.ownerId, existing.guestId, now))) {
        return 'ignored';
      }
      if (status === 'revoked' && existing.status === 'pending') {
        // D4: pisei em convite expirado → traco de auditoria (melhor esforco;
        // duplicata e aceitavel se o dono "reenviar" 2x na janela — documentado).
        // actor=null: foi o sistema que descobriu a expiracao ao ser chamado de novo.
        await this.audit.registrar(null, 'invite_expired_auto', {
          ownerId: existing.ownerId,
          guestId: existing.guestId,
        });
      }

      const token = randomToken();
      const hash = sha256Hex(token);
      await this.prisma.sharedAgenda.update({
        where: { id: existing.id },
        data: {
          status: 'pending',
          tokenHash: hash,
          inviteSentAt: now,
          inviteExpiresAt: new Date(now.getTime() + INVITE_TTL_MS),
          revokedAt: null,
        },
      });
      const invitesInWindow = (await this.sendsOfPair(existing.ownerId, existing.guestId, now))
        .length;
      await this.audit.registrar(session.id, 'invite_resent', {
        ownerId: existing.ownerId,
        guestId: existing.guestId,
        metadata: { invitesInWindow },
      });
      await this.sendInviteEmail(guest.email, session, token, existing);
      return 'resent';
    }

    // sem linha: primeiro convite do par sempre passa na quota (a serie esta
    // vazia por construcao), mas a quota e a pura decide (testabilidade).
    if (!(await this.quotaAllows(session.id, guest.id, now))) return 'ignored';

    const token = randomToken();
    const hash = sha256Hex(token);
    let created: LinkRow;
    try {
      created = (await this.prisma.sharedAgenda.create({
        data: {
          ownerId: session.id,
          guestId: guest.id,
          role: 'read',
          status: 'pending',
          tokenHash: hash,
          inviteSentAt: now,
          inviteExpiresAt: new Date(now.getTime() + INVITE_TTL_MS),
        },
      })) as LinkRow;
    } catch (err) {
      // Corrida no indice parcial unico do tokenHash pendente: silenciada —
      // um 500 seria oracle de existencia do par (padrao password-reset I1).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return 'ignored';
      }
      throw err;
    }
    await this.audit.registrar(session.id, 'invite_created', {
      ownerId: session.id,
      guestId: guest.id,
    });
    await this.sendInviteEmail(guest.email, session, token, created);
    return 'created';
  }

  /**
   * POST /shared-agendas/accept (A.7) — 204 no sucesso. convidado = a sessao;
   * token no body (D10). Busca SIMPLES por hash (decidir a validade na pura
   * permite o traco `invite_expired_auto`); TODOS os sabores — inexistente,
   * para-outro-convidado, morto, CAS perdido (corrida) — caem no MESMO
   * `SharedInviteInvalidError` (A.5). CAS condicional a token ainda vivo
   * espelha o consumo do reset (I2/I4).
   */
  async accept(tokenInput: unknown, sessionUserId: string, now: Date = new Date()): Promise<void> {
    const { token } = sharedInviteTokenSchema.parse(tokenInput);
    const hash = sha256Hex(token);

    const row = await this.prisma.sharedAgenda.findFirst({ where: { tokenHash: hash } });
    if (!row || row.guestId !== sessionUserId) {
      throw new SharedInviteInvalidError();
    }
    if (!inviteIsLive(row, now)) {
      // D4: convite morto encontrado pelo aceite → traco (melhor esforco) +
      // a MESMA falha generica. Traco idempotente por linha: so grava quando
      // ainda nao existe `invite_expired_auto` deste vinculo (null actor).
      await this.registrarExpiracaoAutomatica(row);
      throw new SharedInviteInvalidError();
    }

    const consumed = await this.prisma.sharedAgenda.updateMany({
      where: { id: row.id, status: 'pending', tokenHash: hash, inviteExpiresAt: { gt: now } },
      data: { status: 'active', acceptedAt: now, tokenHash: null, inviteExpiresAt: null },
    });
    if (consumed.count === 0) throw new SharedInviteInvalidError(); // corrida consumiu antes

    await this.audit.registrar(sessionUserId, 'invite_accepted', {
      ownerId: row.ownerId,
      guestId: row.guestId,
    });
  }

  /**
   * POST /shared-agendas/decline (A.8) — 204. pending → revoked (`revokedAt`).
   * Mesma busca/guard/mesma falha generica do aceite.
   */
  async decline(tokenInput: unknown, sessionUserId: string, now: Date = new Date()): Promise<void> {
    const { token } = sharedInviteTokenSchema.parse(tokenInput);
    const hash = sha256Hex(token);

    const row = await this.prisma.sharedAgenda.findFirst({ where: { tokenHash: hash } });
    if (!row || row.guestId !== sessionUserId) {
      throw new SharedInviteInvalidError();
    }
    if (!inviteIsLive(row, now)) {
      await this.registrarExpiracaoAutomatica(row);
      throw new SharedInviteInvalidError();
    }

    const updated = await this.prisma.sharedAgenda.updateMany({
      where: { id: row.id, status: 'pending', tokenHash: hash, inviteExpiresAt: { gt: now } },
      data: { status: 'revoked', revokedAt: now, tokenHash: null, inviteExpiresAt: null },
    });
    if (updated.count === 0) throw new SharedInviteInvalidError();

    await this.audit.registrar(sessionUserId, 'invite_declined', {
      ownerId: row.ownerId,
      guestId: row.guestId,
    });
  }

  /**
   * POST /shared-agendas/:id/revoke (A.9) — 204, efeito imediato. Dono OU
   * convidado encerram; audit `access_revoked` (dono) vs `guest_left`
   * (convidado). Linha inexistente ou de terceiros: 404 generico (sem oraculo).
   * Casos de pendente (decisao da Etapa 2):
   *  - pending VIVA: so o DONO pode cancelar o convite (convidado usa decline
   *    pelo token — sem token o convidado nao revoga pendente);
   *  - pending MORTA (effective=revoked): ja era — 404, nao ha o que revogar;
   *  - active real: os dois lados.
   * Aviso A.3 (decidido pelo humano): SÓ quem PERDEU o acesso recebe mensagem
   * leve do bot — dono revogou ⇒ convidado recebe `sharedAccessEnded(‹dono›)`;
   * convidado saiu ⇒ dono recebe `sharedGuestLeft(‹convidado›)`. Somente no
   * caminho `active` (cancelar PENDING pelo dono nao notifica ninguem: nunca
   * houve acesso). Best-effort: sem telegramId do lado perdedor = pula
   * silencioso; falha do Telegram = log, nunca estoura o 204.
   */
  async revoke(sessionUserId: string, id: string, now: Date = new Date()): Promise<void> {
    const row = await this.prisma.sharedAgenda.findUnique({ where: { id } });
    if (!row || (row.ownerId !== sessionUserId && row.guestId !== sessionUserId)) {
      throw new NotFoundException();
    }
    const status = effectiveStatus(row, now);
    if (status === 'revoked') throw new NotFoundException(); // expirado ja foi recusado (A.5)

    const isOwner = row.ownerId === sessionUserId;
    if (status === 'pending' && !isOwner) throw new NotFoundException();

    await this.prisma.sharedAgenda.update({
      where: { id: row.id },
      data: { status: 'revoked', revokedAt: now, tokenHash: null, inviteExpiresAt: null },
    });
    await this.audit.registrar(sessionUserId, isOwner ? 'access_revoked' : 'guest_left', {
      ownerId: row.ownerId,
      guestId: row.guestId,
    });
    if (status !== 'active') return; // pending cancelado pelo dono: nenhum acesso nasceu, ninguém é avisado

    // A.3: quem PERDEU o acesso é o outro lado do vínculo (dono revogou →
    // convidado recebe `sharedAccessEnded(‹nome do dono›)`; convidado saiu →
    // dono recebe `sharedGuestLeft(‹nome do convidado›)`). O NOME CITADO na
    // mensagem é o do ATOR (é ele quem "faz" o gesto) — vem do actorId, nunca da
    // linha; o perdedor é carregado por telegramId+nome. Sem telegramId do
    // perdedor → pula silencioso (spec A.3). Best-effort: falha do Telegram é
    // log, nunca estoura o 204 (padrao sendInviteEmail).
    const loserId = isOwner ? row.guestId : row.ownerId;
    try {
      const [loser, actor] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: loserId },
          select: { telegramId: true },
        }),
        this.prisma.user.findUnique({
          where: { id: sessionUserId },
          select: { name: true, email: true },
        }),
      ]);
      if (!loser?.telegramId) return;
      const actorName = actor?.name?.trim() || actor?.email || 'Alguém';
      const text = isOwner ? SHARED_ACCESS_ENDED(actorName) : SHARED_GUEST_LEFT(actorName);
      await this.telegram.sendMessage(loser.telegramId, escapeHtml(text));
    } catch (err) {
      this.logger.warn(`shared-agendas: aviso A.3 do revoke falhou p/ ${loserId}: ${String(err)}`);
    }
  }

  /**
   * GET /shared-agendas — vinculos do usuario (A.10). Status pelo
   * `effectiveStatus` (D4: pendente morto aparece `revoked` — A2/A5).
   * Asimetria A2: ENVIADOS mostram SEMPRE o email do convidado (nome NUNCA —
   * nem quando ativo: a regra so libera, nao obriga); RECEBIDOS mostram o nome
   * do dono (email do dono nao e necessario para reconhecer).
   */
  async list(sessionUserId: string, now: Date = new Date()): Promise<SharedAgendaList> {
    const rows = await this.prisma.sharedAgenda.findMany({
      where: { OR: [{ ownerId: sessionUserId }, { guestId: sessionUserId }] },
      orderBy: { createdAt: 'desc' },
    });

    const counterpartIds = new Set<string>();
    for (const row of rows) {
      counterpartIds.add(row.ownerId === sessionUserId ? row.guestId : row.ownerId);
    }
    const users =
      counterpartIds.size > 0
        ? await this.prisma.user.findMany({
            where: { id: { in: [...counterpartIds] } },
            select: { id: true, email: true, name: true },
          })
        : [];
    const byId = new Map(users.map((u) => [u.id, u]));

    const toList = (role: 'owner' | 'guest') =>
      rows
        .filter((row) =>
          role === 'owner' ? row.ownerId === sessionUserId : row.guestId === sessionUserId,
        )
        .map((row) => {
          const counterpartId = role === 'owner' ? row.guestId : row.ownerId;
          const counterpart = byId.get(counterpartId);
          return {
            id: row.id,
            // uuid do dono da LINHA em todo item (sent e received): dado do
            // proprio par, nao vaza terceiro. A web usa para `?owner=` (B.12).
            ownerId: row.ownerId,
            papel: role,
            status: effectiveStatus(row, now),
            contraparte:
              role === 'owner'
                ? counterpart
                  ? { email: counterpart.email }
                  : {} // contraparte sumiu do banco (FK cascade): so timestamps
                : { name: counterpart?.name ?? null },
            inviteSentAt: row.inviteSentAt,
            inviteExpiresAt: row.inviteExpiresAt,
            createdAt: row.createdAt,
            acceptedAt: row.acceptedAt,
            revokedAt: row.revokedAt,
          };
        });

    // zod da borda (contratos): o shape que sai e o que a web faz safeParse.
    return sharedAgendaListSchema.parse({ sent: toList('owner'), received: toList('guest') });
  }

  /**
   * Helper para a ETAPA 3 (leitura da agenda emprestada): vinculo
   * dono=ownerId → convidado=guestId ATIVO (efetivo) ou null. A decisao de
   * erro (403 `shared_access_invalid` uniforme) fica com a Etapa 3 — aqui so
   * a resolucao deterministica do vinculo.
   */
  async activeLinkBetween(
    ownerId: string,
    guestId: string,
    now: Date = new Date(),
  ): Promise<{ id: string } | null> {
    const row = await this.prisma.sharedAgenda.findFirst({
      where: { ownerId, guestId, status: 'active' },
      select: { id: true, status: true, inviteExpiresAt: true },
    });
    if (!row) return null;
    return effectiveStatus(row, now) === 'active' ? { id: row.id } : null;
  }

  /**
   * Helper para a ETAPA 4 (digest E.23 + consulta E.24): vinculos RECEBIDOS
   * ATIVOS do usuario (dono + nome do dono para o Matching deterministico de
   * alvo e para o cabecalho "Agenda de X"). Ordem estavel (createdAt asc — a
   * ordem dos vinculos nao muda entre execucoes). `active` no banco e imutavel
   * (aceite ⇒ active sem timestamps de expiracao; so revoke sai), entao o
   * filtro de status e suficiente — `effectiveStatus` so degradaria pending.
   * Dono sem nome: `ownerName` null (a pura de alvo nunca casa nulo; o
   * chamador decide o rotulo de exibicao — nunca o e-mail do dono vaza aqui).
   */
  async activeIncomingLinks(
    guestId: string,
    now?: Date,
  ): Promise<{ id: string; ownerId: string; ownerName: string | null }[]> {
    void now; // assinatura simetrica com activeLinkBetween (agora default)
    const rows = await this.prisma.sharedAgenda.findMany({
      where: { guestId, status: 'active' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, ownerId: true },
    });
    if (rows.length === 0) return [];
    const owners = await this.prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.ownerId) } },
      select: { id: true, name: true },
    });
    const nameById = new Map(owners.map((u) => [u.id, u.name]));
    return rows.map((r) => ({ id: r.id, ownerId: r.ownerId, ownerName: nameById.get(r.ownerId) ?? null }));
  }

  // ---------------------------------------------------------------------------

  /**
   * Serie da quota do par (D13): linha `sharedAgendaAuditEvent` (kinds
   * `invite_created`/`invite_resent` — os unicos com metadata que contam;
   * carga defensiva tolera metadata ausente). A linha do par NAO entra na
   * serie: o envio que ela representa tambem gerou um evento do par, e a
   * tabela é a serie (decisao da Etapa 2). Carga com margem > janela (padrao
   * resendCode): a contagem fina é da pura.
   */
  private async sendsOfPair(ownerId: string, guestId: string, now: Date) {
    return this.prisma.sharedAgendaAuditEvent.findMany({
      where: {
        ownerId,
        guestId,
        kind: { in: ['invite_created', 'invite_resent'] },
        occurredAt: { gte: new Date(now.getTime() - 2 * INVITE_WINDOW_MS) },
      },
      select: { occurredAt: true },
      orderBy: { occurredAt: 'asc' },
    });
  }

  /** Quota do par pela pura (série = eventos de convite do par na janela). */
  private async quotaAllows(ownerId: string, guestId: string, now: Date): Promise<boolean> {
    const sends = (await this.sendsOfPair(ownerId, guestId, now)).map((e) => ({
      sentAt: e.occurredAt,
    }));
    return evaluateInviteQuota(sends, now).allowed;
  }

  /** E-mail do convite: best-effort (A.6). Falha = audit + log interno, nunca estoura. */
  private async sendInviteEmail(
    toEmail: string,
    session: { id: string; email: string; name: string | null },
    token: string,
    link: { ownerId: string; guestId: string },
  ): Promise<void> {
    const webOrigin = this.config.get('WEB_ORIGIN', { infer: true });
    const linkUrl = `${webOrigin}/convite-agenda?token=${token}`;
    const ownerName = session.name ?? session.email;
    try {
      await this.mail.send({
        to: toEmail,
        subject: 'Convidaram você para ver uma agenda',
        text:
          `${ownerName} quer compartilhar a agenda dele com você no Agendabo (somente leitura).\n` +
          `Abra este link para ver o convite (valido por 24 horas):\n${linkUrl}\n` +
          `Se voce nao reconhece ${ownerName}, é só ignorar este e-mail — nada muda na sua conta.`,
        html: sharedAgendaInviteEmailHtml(linkUrl, ownerName),
      });
    } catch (err) {
      // Log APENAS interno (o email do destinatario so aparece aqui — padrao
      // password-reset); o token fica criado e a resposta continua 202 (A.6).
      // O token cru NUNCA vai para o log.
      process.stderr.write(
        `[mail] envio de convite de compartilhamento falhou para ${toEmail}: ${(err as Error).message}\n`,
      );
      await this.audit.registrar(null, 'invite_email_failed', {
        ownerId: link.ownerId,
        guestId: link.guestId,
      });
    }
  }

  /** Traco `invite_expired_auto` idempotente por vinculo (D4) — melhor esforco. */
  private async registrarExpiracaoAutomatica(row: LinkRow): Promise<void> {
    const existing = await this.prisma.sharedAgendaAuditEvent.findFirst({
      where: {
        ownerId: row.ownerId,
        guestId: row.guestId,
        kind: 'invite_expired_auto',
        // serie da INVITATION atual da linha: eventos com occurredAt >= o
        // envio corrente. Explicite `inviteSentAt` (ou 0) — sem now implicito
        // (a pura/regra nao le o relogio; testes congelam tudo).
        occurredAt: { gte: row.inviteSentAt ?? new Date(0) },
      },
      select: { id: true },
    });
    if (existing) return;
    await this.audit.registrar(null, 'invite_expired_auto', {
      ownerId: row.ownerId,
      guestId: row.guestId,
    });
  }
}
