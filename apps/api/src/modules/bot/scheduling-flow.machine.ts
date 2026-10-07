import {
  findConflict,
  utcToZonedParts,
  zonedTimeToUtc,
  type AppointmentLike,
} from '@agendabo/schedule-core';
import {
  appointmentInputSchema,
  classifyIntentSchema,
  type BotIntent,
  type ClassifyIntentOutput,
} from '@agendabo/contracts';
import { BOT_MESSAGES, givesUp, parseNotesAnswer, parseYesNo } from './messages';
import type { BotUser } from './bot-access.service';

/**
 * Maquina de estados do fluxo de agendamento (spec criar-compromisso-bot).
 *
 * Domínio PURO e determinístico (roda no vitest): sem Nest, sem Prisma, sem Telegraf,
 * sem SDK. As bordas (LLM, Telegram, banco, relógio) entram por parâmetros/injeção:
 *  - `classify`: o que o LLM disse sobre o turno (IntentClassifierService na borda);
 *  - `existing`: compromissos confirmed futuros do usuário (query fica no service);
 *  - `now`: injetável (testing.md — nunca `new Date()` em regra de domínio).
 *
 * O LLM só dirige QUAL transição roda (ADR-008); conflito é 100% findConflict
 * (schedule-core) e o payload final passa por appointmentInputSchema antes de sair.
 */

export type FlowStep =
  | 'titulo'
  | 'dia'
  | 'hora'
  | 'fim'
  | 'conflito'
  | 'notas'
  | 'confirmacao'
  | 'confirmar_cancelamento'
  | 'confirmar_substituicao';

export interface FlowCandidate {
  title?: string;
  /** Meia-noite UTC DO DIA LOCAL escolhido (calendário do usuário). */
  day?: { year: number; month: number; day: number };
  startMinutes?: number;
  startUtc?: Date;
  endUtc?: Date;
  notes?: string | null;
  /** Tentativas de remarcar já usadas (decisão de produto #4: máx 3). */
  conflictTries: number;
  /** Snapshot p/ intenção `substituir_atual` (decisão de produto #9). */
  prev?: FlowCandidate;
  prevStep?: FlowStep;
}

export interface FlowSession {
  step: FlowStep;
  candidate: FlowCandidate;
  lastActivityAt: number;
  /** Passo "real" antes das perguntas sim/não de proteção (cancelar/substituir). */
  prevStep?: FlowStep;
}

export type BotReply =
  { kind: 'text'; text: string } | { kind: 'buttons'; text: string; buttons: string[] };

/** Resultado de um turno: respostas ao chat + o que persistir (service fino aplica). */
export interface FlowOutcome {
  replies: BotReply[];
  done?: boolean;
  create?: {
    title: string;
    startsAt: Date;
    endsAt: Date;
    notes: string | null;
    /** tz do usuário no instante da criação (metadata — banco guarda só UTC, ADR-002). */
    timezone: string;
  };
}

export interface HandleTurnInput {
  session: FlowSession;
  user: BotUser;
  text: string;
  /** Classificação LLM do turno (borda). `undefined` = não chamar o LLM neste turno. */
  classified?: { ok: true; intent: BotIntent; confidence: number } | { ok: false; reason: string };
  /** Compromissos confirmed futuros do usuário p/ findConflict (borda). */
  existing?: AppointmentLike[];
  /** Offset do tz do usuário (minutos leste de UTC) — medido na borda (ADR-002). */
  offsetMinutes: number;
  now: Date;
  /** callback de teste do botão de dia (calendário local do usuário). */
  dayChoice?: { year: number; month: number; day: number };
  /** callback de teste do teclado de hora ("14:30" local). */
  timeChoice?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RESCHEDULE_TRIES = 3;
const MINUTES_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Converte a classificacao bruta do LLM em zod (strip) e aplica o limiar (ADR-003). */
export function acceptedIntent(
  classified:
    { ok: true; intent: BotIntent; confidence: number } | { ok: false; reason: string } | undefined,
  minConfidence: number,
): ClassifyIntentOutput | null {
  if (!classified || !classified.ok) return null;
  const parsed = classifyIntentSchema.safeParse({
    intent: classified.intent,
    confidence: classified.confidence,
  });
  if (!parsed.success) return null;
  return parsed.data.confidence >= minConfidence ? parsed.data : null;
}

export class SchedulingFlowMachine {
  constructor(
    private readonly ttlMs: number,
    private readonly minConfidence: number,
  ) {}

  newSession(now: Date): FlowSession {
    return { step: 'titulo', candidate: { conflictTries: 0 }, lastActivityAt: now.getTime() };
  }

  isExpired(session: FlowSession, now: Date): boolean {
    return now.getTime() - session.lastActivityAt > this.ttlMs;
  }

  /** Mensagem inicial ao abrir o fluxo (etapa a). */
  startReplies(): BotReply[] {
    return [{ kind: 'text', text: BOT_MESSAGES.pedeTitulo }];
  }

  /** Teclado de dias: hoje + amanha + N proximos dias (atalho hoje/amanhã é determinístico). */
  dayButtons(offsetMinutes: number, now: Date, days = 7): string[] {
    const labels: string[] = [];
    for (let i = 0; i < days; i += 1) {
      const parts = utcToZonedParts(new Date(now.getTime() + i * DAY_MS), offsetMinutes);
      const label =
        i === 0
          ? BOT_MESSAGES.hojeLabel
          : i === 1
            ? BOT_MESSAGES.amanhaLabel
            : BOT_MESSAGES.diaLabel(parts, parts.year);
      labels.push(label);
    }
    return labels;
  }

  /** Teclado de horas cheias (passo hora → minuto livre). */
  hourButtons(): string[] {
    return Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);
  }

  async handleTurn(input: HandleTurnInput): Promise<FlowOutcome> {
    const { session } = input;
    session.lastActivityAt = input.now.getTime();

    // Guarda o passo "real" antes das perguntas sim/não de protecao, p/ voltar
    // ao mesmo lugar se o usuario negar (nada e re-perguntado a toa).
    if (session.step !== 'confirmar_cancelamento' && session.step !== 'confirmar_substituicao') {
      session.prevStep = session.step;
    }

    // Desistência por fala natural (spec 13): determinística e SEMPRE ganha — inclusive
    // sobre uma classificação de intenção (defesa contra falso positivo do LLM; o LLM
    // nunca descarta estado no chute, mas um "deixa pra lá" claro dispensa pergunta).
    if (
      session.step !== 'confirmar_cancelamento' &&
      session.step !== 'confirmar_substituicao' &&
      givesUp(input.text)
    ) {
      return this.cancel();
    }

    // Passo determinístico (teclado/callback): não passa por LLM — a fala do usuário
    // é que é roteada por intenção (spec #3, decisão de produto #2).
    if (session.step === 'dia' && input.dayChoice)
      return this.setDay(session, input.dayChoice, input);
    if (session.step === 'hora' && input.timeChoice)
      return this.setStart(session, input.timeChoice, input);

    const intent = acceptedIntent(input.classified, this.minConfidence);
    if (intent) {
      const routed = await this.routeIntent(session, intent.intent, input);
      if (routed) return routed;
    }

    return this.answerStep(session, input);
  }

  /**
   * roteia a intencao do turno. Retorna null quando a intencao nao muda o curso
   * (continuar_fluxo / fora_do_escopo) — o passo atual responde a mensagem como dado.
   */
  private async routeIntent(
    session: FlowSession,
    intent: BotIntent,
    input: HandleTurnInput,
  ): Promise<FlowOutcome | null> {
    switch (intent) {
      case 'cancelar':
        // nunca descarta no chute (spec #13): duvida => pergunta antes.
        if (session.step === 'confirmar_cancelamento') {
          // re-classificou cancelar com confianca alta durante a pergunta: confirma.
          return this.cancel();
        }
        session.step = 'confirmar_cancelamento';
        return { replies: [{ kind: 'text', text: BOT_MESSAGES.confirmarCancelamento }] };

      case 'criar':
        if (session.step === 'confirmar_substituicao') return this.cancel();
        // decisao de produto #9: descarta o atual SOMENTE com "sim" do usuário.
        session.step = 'confirmar_substituicao';
        return { replies: [{ kind: 'text', text: BOT_MESSAGES.confirmarSubstituicao }] };

      case 'substituir_atual':
        if (session.step === 'confirmar_substituicao') return this.cancel();
        session.step = 'confirmar_substituicao';
        return { replies: [{ kind: 'text', text: BOT_MESSAGES.confirmarSubstituicao }] };

      case 'remarcar':
        if (session.step === 'conflito') {
          session.step = 'dia';
          return {
            replies: [
              {
                kind: 'buttons',
                text: BOT_MESSAGES.pedeDia(input.text),
                buttons: this.dayButtons(input.offsetMinutes, input.now),
              },
            ],
          };
        }
        if (session.step === 'dia' || session.step === 'hora' || session.step === 'fim')
          return null;
        return {
          replies: [
            {
              kind: 'text',
              text: BOT_MESSAGES.pedeDia(session.candidate.title ?? 'o compromisso'),
            },
          ],
        };

      case 'continuar_fluxo':
      case 'fora_do_escopo':
        return null;

      case 'consultar':
        // Fase 2, decisão #5: consulta durante o criar é respondida pelo
        // SchedulingFlowService (borda LLM/banco) e o turno volta ao mesmo passo —
        // a máquina não tem estado de consulta. null = segue o fluxo do passo.
        return null;
    }
    return null;
  }

  /** Resposta ao passo atual: o texto do usuario e interpretado como DADO do passo. */
  private async answerStep(session: FlowSession, input: HandleTurnInput): Promise<FlowOutcome> {
    const text = input.text.trim();
    const c = session.candidate;

    switch (session.step) {
      case 'confirmar_cancelamento': {
        const yes = parseYesNo(text);
        if (yes === true || givesUp(text)) return this.cancel();
        if (yes === false) {
          // volta ao passo em que estava (candidato intacto — spec: nada é descartado)
          session.step = this.rewindStep(session);
          return { replies: [{ kind: 'text', text: 'Beleza, seguimos de onde paramos! 🙂' }] };
        }
        return { replies: [{ kind: 'text', text: BOT_MESSAGES.pediuEsclarecimento }] };
      }

      case 'confirmar_substituicao': {
        const yes = parseYesNo(text);
        if (yes === true) return this.cancel();
        if (yes === false) {
          session.step = this.rewindStep(session);
          return {
            replies: [{ kind: 'text', text: 'Beleza, continuamos o agendamento atual. 🙂' }],
          };
        }
        return { replies: [{ kind: 'text', text: BOT_MESSAGES.pediuEsclarecimento }] };
      }

      case 'titulo': {
        if (!text)
          return {
            replies: [{ kind: 'text', text: BOT_MESSAGES.naoEntendi + BOT_MESSAGES.pedeTitulo }],
          };
        c.title = text;
        session.step = 'dia';
        return {
          replies: [
            {
              kind: 'buttons',
              text: BOT_MESSAGES.pedeDia(text),
              buttons: this.dayButtons(input.offsetMinutes, input.now),
            },
          ],
        };
      }

      case 'dia': {
        const day = this.resolveDayShortcut(text, input);
        if (day) return this.setDay(session, day, input);
        // texto livre de dia é Fase 3: re-pergunta o teclado (spec fora de escopo).
        return {
          replies: [
            {
              kind: 'buttons',
              text: BOT_MESSAGES.naoEntendi + BOT_MESSAGES.pedeDia(c.title ?? 'o compromisso'),
              buttons: this.dayButtons(input.offsetMinutes, input.now),
            },
          ],
        };
      }

      case 'hora': {
        const minutes = parseTime(text);
        if (minutes === null) {
          const label = dayLabel(c.day, input.now, input.offsetMinutes);
          return {
            replies: [
              {
                kind: 'buttons',
                text: BOT_MESSAGES.naoEntendi + BOT_MESSAGES.pedeHora(label),
                buttons: this.hourButtons(),
              },
            ],
          };
        }
        return this.setStart(session, text, input);
      }

      case 'fim': {
        if (!c.startUtc || !c.day || c.startMinutes === undefined) return this.resetToTitle();
        const endUtc = this.resolveEnd(text, c.startUtc, input.offsetMinutes);
        if (!endUtc) {
          return { replies: [{ kind: 'text', text: BOT_MESSAGES.erroHorarioInvalido }] };
        }
        c.endUtc = endUtc;
        return this.checkConflict(session, input);
      }

      case 'conflito': {
        const t = this.normalize(text);
        if (/(abandon|desist|desisti|para por|esquece)/.test(t)) return this.cancel();
        if (/(aborta|abortar)/.test(t)) return this.abort();
        if (/cancela/.test(t))
          return session.candidate.conflictTries >= 1 ? this.abort() : this.cancel();
        const yes = parseYesNo(text);
        if (yes === false) return this.abort();
        // sem uma nova proposta de horário clara, re-pergunta o dia (ramo remarcar).
        session.step = 'dia';
        return {
          replies: [
            {
              kind: 'buttons',
              text:
                yes === true
                  ? BOT_MESSAGES.pedeDia('o novo horário')
                  : BOT_MESSAGES.naoEntendi + BOT_MESSAGES.pedeDia(c.title ?? 'o compromisso'),
              buttons: this.dayButtons(input.offsetMinutes, input.now),
            },
          ],
        };
      }

      case 'notas': {
        // resumo do candidato para a pergunta; texto vazio = replay do passo
        // (consulta do bot respondida — decisão #5 da Fase 2).
        const resumo = this.resumo(c, input);
        const text = input.text.trim();
        // spec 5: "nao"/vazio => null; qualquer outro texto => nota. Ruido puro
        // (texto que nao e nem sim/nao nem nota legivel) re-pergunta a pergunta.
        const yesNo = parseYesNo(text);
        if (text && yesNo === null) {
          // ambiguo: aceita como nota apenas texto "substantivo"; re-pergunta ruido curto
          if (text.length <= 3) {
            return {
              replies: [{ kind: 'text', text: BOT_MESSAGES.pedeNotas(resumo) }],
            };
          }
        }
        if (!text) {
          return { replies: [{ kind: 'text', text: BOT_MESSAGES.pedeNotas(resumo) }] };
        }
        const notes = parseNotesAnswer(text);
        c.notes = notes;
        session.step = 'confirmacao';
        return {
          replies: [
            {
              kind: 'buttons',
              text: BOT_MESSAGES.resumoFinal(this.resumo(c, input), notes ? notes : 'sem notas'),
              buttons: ['confirmar', 'alterar'],
            },
          ],
        };
      }

      case 'confirmacao': {
        const head = text.split(/\s+/)[0]?.toLowerCase() ?? '';
        if (/(confirm|sim|pode|ok|isso|bora|manda)/.test(head))
          return this.buildCreate(session, input);
        if (/(alter|corrige|muda|mudar|edita|edit)/.test(head)) {
          const target = this.alterTarget(text);
          if (!target)
            return { replies: [{ kind: 'text', text: BOT_MESSAGES.alterarNaoEntendido }] };
          return this.rewindTo(session, target, input);
        }
        return {
          replies: [{ kind: 'text', text: BOT_MESSAGES.naoEntendi + BOT_MESSAGES.alterarPergunta }],
        };
      }
    }
  }

  // ---------- transicoes de dados ----------

  /** Normaliza a fala p/ comparação determinística (minúsculas, sem acento). */
  private normalize(text: string): string {
    return text
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  /** Passo "real" anterior às perguntas sim/não de proteção (candidato intacto). */
  private rewindStep(session: FlowSession): FlowStep {
    return session.prevStep ?? 'titulo';
  }

  private cancel(): FlowOutcome {
    return { replies: [{ kind: 'text', text: BOT_MESSAGES.cancelado }], done: true };
  }

  private abort(): FlowOutcome {
    return { replies: [{ kind: 'text', text: BOT_MESSAGES.abortado }], done: true };
  }

  private resetToTitle(): FlowOutcome {
    return {
      replies: [{ kind: 'text', text: BOT_MESSAGES.naoEntendi + BOT_MESSAGES.pedeTitulo }],
    };
  }

  private setDay(
    session: FlowSession,
    day: { year: number; month: number; day: number },
    input: HandleTurnInput,
  ): FlowOutcome {
    const c = session.candidate;
    c.day = day;
    c.startMinutes = undefined;
    c.startUtc = undefined;
    c.endUtc = undefined;
    session.step = 'hora';
    const label = BOT_MESSAGES.diaLabel(day, utcToZonedParts(input.now, input.offsetMinutes).year);
    return {
      replies: [
        { kind: 'buttons', text: BOT_MESSAGES.pedeHora(label), buttons: this.hourButtons() },
      ],
    };
  }

  private setStart(session: FlowSession, timeText: string, input: HandleTurnInput): FlowOutcome {
    const c = session.candidate;
    const minutes = parseTime(timeText);
    if (!c.day || minutes === null) {
      return {
        replies: [
          {
            kind: 'buttons',
            text: BOT_MESSAGES.naoEntendi + BOT_MESSAGES.pedeHora(''),
            buttons: this.hourButtons(),
          },
        ],
      };
    }
    c.startMinutes = minutes;
    // o "dia" e calendario LOCAL do usuario; zonedTimeToUtc converte com o offset (ADR-002).
    c.startUtc = zonedTimeToUtc(
      { ...c.day, hour: Math.floor(minutes / 60), minute: minutes % 60 },
      input.offsetMinutes,
    );
    c.endUtc = undefined;
    session.step = 'fim';
    return { replies: [{ kind: 'text', text: BOT_MESSAGES.pedeFim }] };
  }

  /** "15:30" (pos-início) | "1h30"/"45min"/"90" (duração) | "1h" → Date UTC; null = inválido. */
  private resolveEnd(text: string, startUtc: Date, offsetMinutes: number): Date | null {
    const t = text.trim().toLowerCase().replace(/\s+/g, '');
    const hm = t.match(/^(\d{1,2})h(\d{2})?(min)?$/);
    if (hm && !t.match(/^(\d{1,2}):(\d{2})$/)) {
      const hours = Number(hm[1]);
      const mins = Number(hm[2] ?? 0);
      const dur = hours * 60 + mins;
      return dur > 0 ? new Date(startUtc.getTime() + dur * 60_000) : null;
    }
    const min = t.match(/^(\d+)\s*(min|m)?$/);
    if (min && !MINUTES_RE.test(t)) {
      const dur = Number(min[1]);
      return dur > 0 ? new Date(startUtc.getTime() + dur * 60_000) : null;
    }
    const clock = parseTime(t);
    if (clock === null) return null;
    const parts = utcToZonedParts(startUtc, offsetMinutes);
    const endUtc = zonedTimeToUtc(
      { ...parts, hour: Math.floor(clock / 60), minute: clock % 60 },
      offsetMinutes,
    );
    if (endUtc.getTime() === startUtc.getTime()) return null; // spec 12: fim == inicio e invalido
    if (endUtc.getTime() < startUtc.getTime()) endUtc.setTime(endUtc.getTime() + DAY_MS); // atravessa a meia-noite
    return endUtc;
  }

  /** Conflito 100% schedule-core (spec #16) — o LLM nunca passa por aqui. */
  private async checkConflict(session: FlowSession, input: HandleTurnInput): Promise<FlowOutcome> {
    const { candidate: c } = session;
    const candidate = { startsAt: c.startUtc!, endsAt: c.endUtc! };
    const result = findConflict(candidate, input.existing ?? [], { now: input.now });
    if (!result.conflict || !result.with) {
      session.step = 'notas';
      return { replies: [{ kind: 'text', text: BOT_MESSAGES.pedeNotas(this.resumo(c, input)) }] };
    }
    c.conflictTries += 1;
    session.step = 'conflito';
    const existente = {
      title: result.with.title,
      range: this.formatRange(result.with.startsAt, result.with.endsAt, input.offsetMinutes),
    };
    const text = BOT_MESSAGES.conflito(existente);
    const finalText =
      c.conflictTries >= MAX_RESCHEDULE_TRIES
        ? `${text}\n\n${BOT_MESSAGES.conflitoLimiteAtingido}`
        : text;
    return { replies: [{ kind: 'buttons', text: finalText, buttons: ['remarcar', 'abortar'] }] };
  }

  /** Valida o payload final com zod (spec #18) e devolve o create p/ o service aplicar. */
  private buildCreate(session: FlowSession, input: HandleTurnInput): FlowOutcome {
    const c = session.candidate;
    const parsed = appointmentInputSchema.safeParse({
      title: c.title,
      startsAt: c.startUtc,
      endsAt: c.endUtc,
      notes: c.notes ?? undefined,
    });
    if (!parsed.success || !c.title || !c.startUtc || !c.endUtc) {
      // maquina de estados nao deveria chegar aqui; loga e re-pergunta (spec nota tecnica).
      return {
        replies: [{ kind: 'text', text: BOT_MESSAGES.naoEntendi + BOT_MESSAGES.alterarPergunta }],
      };
    }
    const outcome: FlowOutcome = {
      replies: [
        {
          kind: 'text',
          text: BOT_MESSAGES.criado(
            parsed.data.title,
            this.formatRange(parsed.data.startsAt, parsed.data.endsAt, input.offsetMinutes),
          ),
        },
      ],
      done: true,
      create: {
        title: parsed.data.title,
        startsAt: parsed.data.startsAt,
        endsAt: parsed.data.endsAt,
        notes: parsed.data.notes ?? null,
        timezone: input.user.timezone,
      },
    };
    return outcome;
  }

  /** "alterar X" no resumo final: volta ao passo correspondente mantendo o resto. */
  private rewindTo(
    session: FlowSession,
    target: 'titulo' | 'dia' | 'hora' | 'fim' | 'notas',
    input: HandleTurnInput,
  ): FlowOutcome {
    const c = session.candidate;
    session.step = target;
    switch (target) {
      case 'titulo':
        return { replies: [{ kind: 'text', text: BOT_MESSAGES.pedeTitulo }] };
      case 'dia':
        return {
          replies: [
            {
              kind: 'buttons',
              text: BOT_MESSAGES.pedeDia(c.title ?? 'o compromisso'),
              buttons: this.dayButtons(input.offsetMinutes, input.now),
            },
          ],
        };
      case 'hora':
        return {
          replies: [
            {
              kind: 'buttons',
              text: BOT_MESSAGES.pedeHora(dayLabel(c.day, input.now, input.offsetMinutes)),
              buttons: this.hourButtons(),
            },
          ],
        };
      case 'fim':
        return { replies: [{ kind: 'text', text: BOT_MESSAGES.pedeFim }] };
      case 'notas':
        return { replies: [{ kind: 'text', text: BOT_MESSAGES.pedeNotas(this.resumo(c, input)) }] };
    }
  }

  private alterTarget(text: string): 'titulo' | 'dia' | 'hora' | 'fim' | 'notas' | null {
    const t = text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    for (const [key, step] of Object.entries(BOT_MESSAGES.alterarMapa)) {
      if (t.includes(key)) return step;
    }
    return null;
  }

  /** Atalho determinístico hoje/amanhã/resposta de teclado, no tz do usuário (spec #7). */
  private resolveDayShortcut(
    text: string,
    input: HandleTurnInput,
  ): { year: number; month: number; day: number } | null {
    const t = text
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    const local = (shiftMs: number) =>
      utcToZonedParts(new Date(input.now.getTime() + shiftMs), input.offsetMinutes);
    if (t === 'hoje') return pick(local(0));
    if (t === 'amanha' || t === 'amanha.') return pick(local(DAY_MS));
    if (t === 'depois de amanha' || t === 'depois de amanha.') {
      return pick(local(2 * DAY_MS));
    }
    // resposta do teclado inline ("08/10", "08/10/2027") — offset-invariante:
    // o calendario local ja estava no rotulo quando o botao foi desenhado.
    const m = t.match(/^(\d{2})\/(\d{2})(?:\/(\d{4}))?$/);
    if (m) {
      const today = local(0);
      return { year: m[3] ? Number(m[3]) : today.year, month: Number(m[2]), day: Number(m[1]) };
    }
    return null;
  }

  /** "Título — seg 14:00–15:30" no timezone do usuário (ADR-002). */
  resumo(c: FlowCandidate, input: HandleTurnInput): string {
    if (!c.startUtc || !c.endUtc) return c.title ?? '';
    return `${c.title ?? ''} — ${this.formatRange(c.startUtc, c.endUtc, input.offsetMinutes)}`;
  }

  private formatRange(startsAt: Date, endsAt: Date, offsetMinutes: number): string {
    const s = utcToZonedParts(startsAt, offsetMinutes);
    const e = utcToZonedParts(endsAt, offsetMinutes);
    const weekday = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][
      new Date(Date.UTC(s.year, s.month - 1, s.day)).getUTCDay()
    ];
    const sameDay = s.year === e.year && s.month === e.month && s.day === e.day;
    const start = `${weekday} ${pad(s.day)}/${pad(s.month)} ${pad(s.hour)}:${pad(s.minute)}`;
    const end = sameDay
      ? `${pad(e.hour)}:${pad(e.minute)}`
      : `${
          ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][
            new Date(Date.UTC(e.year, e.month - 1, e.day)).getUTCDay()
          ]
        } ${pad(e.day)}/${pad(e.month)} ${pad(e.hour)}:${pad(e.minute)}`;
    return `${start}–${end}`;
  }
}

function parseTime(text: string): number | null {
  const m = text.trim().match(MINUTES_RE);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function pick(p: { year: number; month: number; day: number }): {
  year: number;
  month: number;
  day: number;
} {
  return { year: p.year, month: p.month, day: p.day };
}

function dayLabel(
  day: { year: number; month: number; day: number } | undefined,
  now: Date,
  offsetMinutes: number,
): string {
  if (!day) return '';
  return BOT_MESSAGES.diaLabel(day, utcToZonedParts(now, offsetMinutes).year);
}
