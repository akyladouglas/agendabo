import { Injectable, Logger } from '@nestjs/common';
import { AppointmentsService } from '../appointments/appointments.service';
import {
  ConsultaInterpreterService,
  type ConsultaPeriodo,
} from '../ai/consulta-interpreter.service';
import { SharedAgendasService } from '../shared-agendas/shared-agendas.service';
import { SharedAgendaAuditService } from '../shared-agendas/shared-agenda-audit.service';
import { BOT_MESSAGES, escapeHtml } from './messages';
import {
  formatAppointmentLines,
  formatPeriodoLabel,
  resolveIntervaloRange,
  resolveSimboloRange,
  type AppointmentRow,
  type SimboloConsulta,
} from './agenda-query';
import { resolveSharedTarget, type SharedTargetLink } from './resolve-shared-target';
import type { BotUser } from './bot-access.service';

/** Limite da decisão #4: mais que isso, lista 10 e oferece o resto/período menor. */
export const AGENDA_QUERY_MAX_LIST = 10;

/** Decisão #8: a partir disso, resposta agregada (contagem) + oferta de detalhar. */
export const AGENDA_QUERY_AGGREGATE_MIN = 30;

/** Spec #14: o período é perguntado no máximo 2× por consulta. */
export const AGENDA_QUERY_MAX_PERIOD_PROMPTS = 2;

export interface AgendaQueryResult {
  replies: string[];
  /** true quando o bot perguntou o período — o próximo turno continua a consulta. */
  awaitingPeriod: boolean;
  /**
   * Nº de compromissos listados (Fase 9/observabilidade B2: o evento
   * `query_answered` guarda o TOTAL, nunca título/data). Ausente quando a
   * resposta foi só a pergunta de período (nada foi consultado ainda).
   */
  count?: number;
}

/**
 * Consulta de agenda sob demanda no bot (Fase 2, spec consultar-agenda-bot): orquestra
 * o turno de leitura — interpreta o período (ConsultaInterpreterService), resolve as
 * datas em schedule-core (agenda-query.ts puro), lista por intersecção
 * (AppointmentsService.listOverlapping) e monta a resposta PT-BR. Somente leitura.
 *
 * Alvo compartilhado (spec compartilhamento E.24, decisão D6): quando a interpretação
 * BEM-SUCEDIDA traz `alvo: 'compartilhada'`, a decisão de acesso é da pura
 * `resolveSharedTarget` (nome dito × vínculos recebidos ativos — ADR-004/008):
 * 1 ⇒ lista os `confirmed` do DONO no mesmo período (sem needs_review do dono,
 * mesma régua truncar 10/agregado, tz do CONVIDADO); N ⇒ lista numerada; 0/sem
 * vínculo ⇒ "sem acesso"; compartilhada sem nome ⇒ pergunta "De qual agenda?".
 * Sem vínculo ativo (ou alvo ausente/'minha') o caminho é o EXATO de hoje.
 *
 * Estado ("aguardando o período") NÃO mora aqui: é memória com TTL no dono do turno
 * (SchedulingFlowService — llm.md #5). Desistência ("tanto faz") é tratada por quem
 * chama, ANTES de chegar aqui (spec #14).
 */
@Injectable()
export class AgendaQueryService {
  private readonly logger = new Logger(AgendaQueryService.name);

  constructor(
    private readonly interpreter: ConsultaInterpreterService,
    private readonly appointments: AppointmentsService,
    /**
     * Compartilhamento (E.24). Opcional defensivamente (mocks antigos): sem ele,
     * alvo compartilhado vira "sem acesso" — nunca o caminho próprio (fail-closed:
     * o LLM pediu agenda alheia, a resposta segura é negar, não chutar a própria).
     */
    private readonly sharedAgendas?: SharedAgendasService,
    private readonly sharedAudit?: SharedAgendaAuditService,
  ) {}

  /** Resposta do 2º pedido de período sem sucesso (spec #14). */
  closePolitely(): string {
    return BOT_MESSAGES.consultaEncerrado;
  }

  async run(
    user: BotUser,
    input: {
      /** Texto do turno: a pergunta OU a resposta à pergunta do período. */
      text: string;
      offsetMinutes: number;
      now: Date;
      /** Etapa do fluxo de criar aberto (vai no prompt como contexto; spec #13). */
      inFlowStep?: string;
    },
  ): Promise<AgendaQueryResult> {
    const classified = await this.interpretPeriodo(user, input);
    if (!classified.ok) {
      if (classified.reason === 'fora_do_escopo') {
        // a intent já tinha roteado pra cá; sem período, a única saída segura é perguntar.
        this.logger.log(`bot: consulta de ${user.id} interpretada como fora_do_escopo`);
      }
      // spec #5: parse falho / confiança baixa / sem período => PERGUNTA, nunca chute.
      return { replies: [BOT_MESSAGES.consultaPerguntaPeriodo], awaitingPeriod: true };
    }

    const range = resolvePeriodoRange(classified, input.offsetMinutes, input.now);
    if (!range) {
      this.logger.warn(
        `bot: intervalo explícito inválido do LLM p/ ${user.id}: ` +
          `${JSON.stringify('intervalo' in classified ? classified.intervalo : null)} — perguntando o período`,
      );
      return { replies: [BOT_MESSAGES.consultaPerguntaPeriodo], awaitingPeriod: true };
    }

    // ---- alvo compartilhado (E.24): só quando o interpretation BEM-SUCEDIDO disse
    // 'compartilhada' — alvo ausente/'minha' seguem o caminho exato de hoje. ----
    if (classified.alvo === 'compartilhada') {
      return this.runSharedQuery(user, classified.alvo_nome, range, input);
    }

    // spec #8/#12: só compromissos DO USUÁRIO que TOCAM o período; cancelled nunca.
    const rows = await this.appointments.listOverlapping(user.id, range.start, range.end, [
      'confirmed',
      'needs_review',
    ]);
    return {
      replies: this.buildListReply(rows, range, input.offsetMinutes),
      awaitingPeriod: false,
      count: rows.length,
    };
  }

  /**
   * Caminho compartilhado (E.24): régua 1/N/0 determinística sobre os vínculos
   * RECEBIDOS ATIVOS do usuário. O acesso nunca é decisão do LLM: ele só extraiu
   * o candidato (`alvo`/`alvo_nome`) — ADR-004/008.
   */
  private async runSharedQuery(
    user: BotUser,
    alvoNome: string | undefined,
    range: { start: Date; end: Date },
    input: { offsetMinutes: number; now: Date },
  ): Promise<AgendaQueryResult> {
    if (!this.sharedAgendas) return { replies: [BOT_MESSAGES.sharedQueryNoAccess], awaitingPeriod: false };

    let links: SharedTargetLink[];
    try {
      links = await this.sharedAgendas.activeIncomingLinks(user.id, input.now);
    } catch (err) {
      this.logger.warn(`bot: consulta compartilhada p/ ${user.id} falhou ao ler vínculos: ${String(err)}`);
      return { replies: [BOT_MESSAGES.sharedQueryNoAccess], awaitingPeriod: false };
    }

    const target = resolveSharedTarget('compartilhada', alvoNome, links);
    switch (target.kind) {
      case 'none':
        // 0 matches ⇒ "sem acesso" (a régua da spec). Compartilhada SEM nome é o
        // alvo DUVIDOSO: pergunta "De qual agenda?" (E.24 — nunca chuta).
        return {
          replies: [
            alvoNome ? BOT_MESSAGES.sharedQueryNoAccess : BOT_MESSAGES.sharedQueryTargetQuestion,
          ],
          awaitingPeriod: false,
        };
      case 'ambiguous': {
        const linhas = target.names.map((n, i) => `${i + 1}. ${escapeHtml(n)}`).join('\n');
        return {
          replies: [BOT_MESSAGES.sharedQueryTargetAmbiguous(linhas)],
          awaitingPeriod: false,
        };
      }
      case 'single': {
        // agenda emprestada: SÓ confirmed do dono (B.13 — needs_review é privado;
        // sem marcador ⚠️). MESMA interseção, MESMA régua de formatação.
        const rows = await this.appointments.listOverlapping(
          target.link.ownerId,
          range.start,
          range.end,
          ['confirmed'],
        );
        // F.4: access_read (mesmo evento da leitura web) — best-effort (nunca lança).
        await this.sharedAudit?.registrar(user.id, 'access_read', {
          ownerId: target.link.ownerId,
          guestId: user.id,
          metadata: { count: rows.length },
        });
        return {
          replies: this.buildSharedListReply(target.link.ownerName, rows, range, input.offsetMinutes),
          awaitingPeriod: false,
          count: rows.length,
        };
      }
      case 'own':
        // inalcançável (alvo é 'compartilhada') — defensivo: cai no caminho próprio.
        return { replies: [BOT_MESSAGES.consultaPerguntaPeriodo], awaitingPeriod: true };
    }
  }

  /** Data de hoje no tz do usuário vai no bloco volatile do prompt (llm.md #4). */
  private async interpretPeriodo(
    user: BotUser,
    input: { text: string; now: Date; inFlowStep?: string },
  ): Promise<ConsultaPeriodo> {
    const todayLocal = new Intl.DateTimeFormat('pt-BR', {
      timeZone: user.timezone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(input.now);
    return this.interpreter.interpret(
      input.text,
      {
        todayLocal,
        inFlowStep: input.inFlowStep,
      },
      { userId: user.id },
    );
  }

  /** Resposta final: lista formatada no tz (decisões #3/#4/#8/#10 da spec). */
  private buildListReply(
    rows: AppointmentRow[],
    range: { start: Date; end: Date },
    offsetMinutes: number,
  ): string[] {
    if (rows.length === 0) return [BOT_MESSAGES.consultaVazia];

    const cabecalho = BOT_MESSAGES.consultaCabecalho(formatPeriodoLabel(range, offsetMinutes));

    if (rows.length >= AGENDA_QUERY_AGGREGATE_MIN) {
      // decisão #8: contagem + oferta — nunca despeja 30+ linhas.
      return [escapeHtml(`${cabecalho}\n${BOT_MESSAGES.consultaAgregado(rows.length)}`)];
    }

    // decisão #4: lista até 10 itens e oferece o resto (corte NUNCA mudo).
    const shown = rows.slice(0, AGENDA_QUERY_MAX_LIST);
    const rest = rows.length - shown.length;
    const lines = formatAppointmentLines(
      shown,
      offsetMinutes,
      BOT_MESSAGES.consultaMarcadorNeedsReview,
    );
    const out = [escapeHtml([cabecalho, '', ...lines].join('\n'))];
    if (rest > 0) out.push(BOT_MESSAGES.consultaTruncado(rest));
    return out;
  }

  /**
   * Lista da agenda EMPRESTADA: mesmo format/truncar 10/agregado do caminho
   * próprio, cabeçalho com a fonte e SEM o marcador needs_review (B.13: só
   * confirmed passa no where — o marcador nunca aparece, passamos rótulo vazio).
   */
  private buildSharedListReply(
    ownerName: string | null,
    rows: AppointmentRow[],
    range: { start: Date; end: Date },
    offsetMinutes: number,
  ): string[] {
    if (rows.length === 0) return [BOT_MESSAGES.consultaVazia];

    const rotulo = ownerName ?? 'seu contato'; // dono sem nome jamais chega aqui (vínculo não casa)
    const cabecalho = BOT_MESSAGES.consultaCabecalhoCompartilhada(
      rotulo,
      formatPeriodoLabel(range, offsetMinutes),
    );

    if (rows.length >= AGENDA_QUERY_AGGREGATE_MIN) {
      return [escapeHtml(`${cabecalho}\n${BOT_MESSAGES.consultaAgregado(rows.length)}`)];
    }
    const shown = rows.slice(0, AGENDA_QUERY_MAX_LIST);
    const rest = rows.length - shown.length;
    const lines = formatAppointmentLines(shown, offsetMinutes, '');
    const out = [escapeHtml([cabecalho, '', ...lines].join('\n'))];
    if (rest > 0) out.push(BOT_MESSAGES.consultaTruncado(rest));
    return out;
  }
}

/** Símbolo OU intervalo explícito -> intervalo UTC half-open (schedule-core decide). */
function resolvePeriodoRange(
  periodo: Extract<ConsultaPeriodo, { ok: true }>,
  offsetMinutes: number,
  now: Date,
): { start: Date; end: Date } | null {
  if ('simbolo' in periodo) {
    return resolveSimboloRange(periodo.simbolo as SimboloConsulta, now, offsetMinutes);
  }
  if ('intervalo' in periodo) {
    return resolveIntervaloRange(periodo.intervalo, offsetMinutes);
  }
  return null;
}
