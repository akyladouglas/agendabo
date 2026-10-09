import { Injectable, Logger } from '@nestjs/common';
import { AppointmentsService } from '../appointments/appointments.service';
import {
  ConsultaInterpreterService,
  type ConsultaPeriodo,
} from '../ai/consulta-interpreter.service';
import { BOT_MESSAGES, escapeHtml } from './messages';
import {
  formatAppointmentLines,
  formatPeriodoLabel,
  resolveIntervaloRange,
  resolveSimboloRange,
  type AppointmentRow,
  type SimboloConsulta,
} from './agenda-query';
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
