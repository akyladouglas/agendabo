import { describe, expect, it } from 'vitest';
import {
  SchedulingFlowMachine,
  type FlowSession,
  type HandleTurnInput,
} from './scheduling-flow.machine';
import type { BotUser } from './bot-access.service';
import type { AppointmentLike } from '@agendabo/schedule-core';

/**
 * Fase 4 (spec llm-avancado): testes da máquina ANTES de mexer nela (risco de regressão
 * do plano). Cobre o atalho do criar (bloco A / regra 6), os passos `confirmar_edicao`/
 * `confirmar_cancelamento_compromisso`/`escolher_candidata` e o aviso de needs_review.
 */

const NOW = new Date('2026-10-06T15:00:00Z'); // 12:00 em America/Sao_Paulo (-180)
const OFFSET = -180;
const TTL = 30 * 60_000;
const MIN_CONF = 0.7;

const user: BotUser = { id: 'u1', telegramId: '111', timezone: 'America/Sao_Paulo' };

function machine(): SchedulingFlowMachine {
  return new SchedulingFlowMachine(TTL, MIN_CONF);
}

function session(overrides: Partial<FlowSession> = {}): FlowSession {
  return {
    step: 'titulo',
    candidate: { conflictTries: 0 },
    lastActivityAt: NOW.getTime(),
    ...overrides,
  };
}

function baseInput(
  overrides: Partial<HandleTurnInput> = {},
): Omit<HandleTurnInput, 'session' | 'text'> {
  return { user, existing: [], offsetMinutes: OFFSET, now: NOW, ...overrides };
}

function texts(outcome: { replies: Array<{ kind: string; text: string }> }): string {
  return outcome.replies.map((r) => r.text).join('\n');
}

const intent = (intentName: string, confidence = 0.95) => ({
  ok: true as const,
  intent: intentName as never,
  confidence,
});

/** Candidato do atalho: qui 08/10 14:00–15:00 local (-03:00). */
function extracted(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Consulta',
    startUtc: new Date('2026-10-08T17:00:00Z'),
    endUtc: new Date('2026-10-08T18:00:00Z'),
    dateEvidence: 'quinta que vem umas 14h',
    ...overrides,
  };
}

const dentista: AppointmentLike = {
  id: 'a1',
  title: 'Consulta dentista',
  startsAt: new Date('2026-10-08T17:00:00Z'), // 14:00 local de qui
  endsAt: new Date('2026-10-08T18:00:00Z'), // 15:00 local
};

describe('Máquina Fase 4 — atalho do criar (spec A4/A5, D2)', () => {
  it('extração aceita: pula dia/hora/fim e a confirmação final; pergunta notas com o resumo do que entendeu', async () => {
    const m = machine();
    const s = session();
    const out = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: 'quero marcar consulta quinta que vem umas 14h por 1 hora',
      extracted: { kind: 'aceito', data: extracted() },
    });
    expect(s.step).toBe('notas');
    expect(s.candidate.title).toBe('Consulta');
    expect(s.candidate.startUtc?.toISOString()).toBe('2026-10-08T17:00:00.000Z');
    expect(texts(out)).toContain('Entendi');
    expect(texts(out)).toContain('14:00'); // tz do usuário, não UTC
    expect(texts(out)).toContain('anotar');
    expect(texts(out)).not.toContain('Confirmo?'); // a fala já é a confirmação (regra A4)
  });

  it('extração aceita COM conflito: findConflict roda antes das notas e pergunta remarcar/abortar', async () => {
    const m = machine();
    const s = session();
    const out = await m.handleTurn({
      ...baseInput({ existing: [dentista] }),
      session: s,
      text: 'marca consulta quinta 14h',
      extracted: { kind: 'aceito', data: extracted() },
    });
    expect(s.step).toBe('conflito');
    expect(texts(out)).toContain('Consulta dentista');
    expect(texts(out)).toContain('14:00');
    const buttons = out.replies.flatMap((r) => (r.kind === 'buttons' ? r.buttons : []));
    expect(buttons).toEqual(expect.arrayContaining(['remarcar', 'abortar']));
  });

  it('extração com quando parcial (só título): pula o que tem, pergunta só a HORA (decisão #5)', async () => {
    const m = machine();
    const s = session();
    const out = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: 'quero marcar consulta quinta que vem',
      extracted: {
        kind: 'quando_parcial',
        data: { title: 'Consulta', day: { year: 2026, month: 10, day: 8 } },
      },
    });
    expect(s.step).toBe('hora');
    expect(s.candidate.title).toBe('Consulta');
    expect(s.candidate.day).toEqual({ year: 2026, month: 10, day: 8 });
    expect(texts(out)).toContain('08/10');
    expect(texts(out)).toContain('que horas');
  });

  it('falha de extração com título na fala: cai no guiado e pergunta o dia (spec A5)', async () => {
    const m = machine();
    const s = session();
    const out = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: 'quero marcar consulta',
      extracted: { kind: 'falhou', reason: 'parse', titleHint: 'consulta' },
    });
    expect(s.step).toBe('dia');
    expect(s.candidate.title).toBe('consulta');
    expect(texts(out)).toContain('Em que dia');
  });

  it('falha de extração sem título: fluxo abre em título como sempre (spec A5)', async () => {
    const m = machine();
    const s = session();
    const out = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: 'quero marcar uma consulta',
      extracted: { kind: 'falhou', reason: 'no_tool_use' },
    });
    expect(s.step).toBe('titulo');
    expect(texts(out)).toContain('Como eu chamo');
  });

  it('fraco: needs_review com aviso citando a evidência, sessão encerra, NADA de create/outbox (regra 6/D7)', async () => {
    const m = machine();
    const s = session();
    const out = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: 'mais ou menos uma consulta quinta',
      extracted: {
        kind: 'fraco',
        data: {
          title: 'consulta',
          startUtc: new Date('2026-10-08T17:00:00Z'),
          endUtc: new Date('2026-10-08T18:00:00Z'),
          dateEvidence: 'mais ou menos... quinta',
        },
        reviewReason: 'confianca_baixa',
        rawText: 'mais ou menos uma consulta quinta',
      },
    });
    expect(out.done).toBe(true);
    expect(out.create).toBeUndefined();
    expect(out.needsReview).toBeDefined();
    expect(out.needsReview?.title).toBe('consulta');
    expect(out.needsReview?.rawText).toBe('mais ou menos uma consulta quinta');
    expect(out.needsReview?.reviewReason).toContain('confianca_baixa');
    expect(out.needsReview?.startsAt.toISOString()).toBe('2026-10-08T17:00:00.000Z');
    expect(texts(out)).toContain('⚠️');
    expect(texts(out)).toContain('mais ou menos... quinta'); // cita a evidência (Aberto #1→a)
  });

  it('suspeito (aceito-no-passado): needs_review com reviewReason de passado', async () => {
    const m = machine();
    const s = session();
    const out = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: 'anota aí a consulta de ontem às 9h',
      extracted: {
        kind: 'suspeito',
        data: {
          title: 'Consulta',
          startUtc: new Date('2026-10-05T12:00:00Z'),
          endUtc: new Date('2026-10-05T13:00:00Z'),
        },
        reviewReason: 'data_no_passado',
        rawText: 'anota aí a consulta de ontem às 9h',
      },
    });
    expect(out.done).toBe(true);
    expect(out.needsReview?.reviewReason).toContain('data_no_passado');
  });

  it('atalho aceita o resto do fluxo: notas → lembrete → create SEM "confirmo?" extra (Gherkin R1)', async () => {
    const m = machine();
    const s = session();
    await m.handleTurn({
      ...baseInput(),
      session: s,
      text: 'consulta quinta 14h por 1 hora',
      extracted: { kind: 'aceito', data: extracted() },
    });
    await m.handleTurn({ ...baseInput(), session: s, text: 'não' }); // notas
    await m.handleTurn({
      ...baseInput(),
      session: s,
      text: 'sem lembrete',
      reminder: { ok: true, regras: [{ type: 'none' }] },
    });
    expect(s.step).toBe('confirmacao'); // resumo final normal (fases 1/3 intactas)
    const fin = await m.handleTurn({ ...baseInput(), session: s, text: 'confirmar' });
    expect(fin.done).toBe(true);
    expect(fin.create).toEqual({
      title: 'Consulta',
      startsAt: new Date('2026-10-08T17:00:00Z'),
      endsAt: new Date('2026-10-08T18:00:00Z'),
      notes: null,
      notificationRules: [],
      timezone: 'America/Sao_Paulo',
    });
  });
});

describe('Máquina Fase 4 — confirmar_edicao (spec C12)', () => {
  function editSession(): FlowSession {
    return session({
      step: 'confirmar_edicao',
      candidate: {
        title: 'Reunião',
        startUtc: new Date('2026-10-08T17:00:00Z'),
        endUtc: new Date('2026-10-08T18:00:00Z'),
        conflictTries: 0,
        edit: {
          action: 'editar',
          appointmentId: 'r1',
          fromTitle: 'Reunião',
          fromStartUtc: new Date('2026-10-08T17:00:00Z'),
          fromEndUtc: new Date('2026-10-08T18:00:00Z'),
          toStartUtc: new Date('2026-10-09T19:00:00Z'),
          toEndUtc: new Date('2026-10-09T20:00:00Z'),
          tries: 0,
        },
      },
    });
  }

  it('"sim" emite update com o patch (nada mudou antes disto — D5)', async () => {
    const m = machine();
    const s = editSession();
    const out = await m.handleTurn({ ...baseInput(), session: s, text: 'sim' });
    expect(out.done).toBe(true);
    expect(out.update).toMatchObject({
      appointmentId: 'r1',
      patch: {
        startsAt: new Date('2026-10-09T19:00:00Z'),
        endsAt: new Date('2026-10-09T20:00:00Z'),
      },
    });
    expect(texts(out)).toContain('Reunião');
    expect(texts(out)).toContain('16:00'); // 19:00Z = 16:00 -03:00
  });

  it('"não": nada muda, nenhum update, turno encerra educadamente', async () => {
    const m = machine();
    const s = editSession();
    const out = await m.handleTurn({ ...baseInput(), session: s, text: 'não' });
    expect(out.done).toBe(true);
    expect(out.update).toBeUndefined();
    expect(texts(out)).toContain('nada mudei');
  });

  it('texto ambíguo re-pergunta a confirmação (parseYesNo padrão)', async () => {
    const m = machine();
    const s = editSession();
    const out = await m.handleTurn({ ...baseInput(), session: s, text: 'sei lá' });
    expect(s.step).toBe('confirmar_edicao');
    expect(out.done).toBeUndefined();
    expect(texts(out)).toContain('Confirmo');
  });

  it('conflito no "sim" (service reporta): mostra conflitante + re-pergunta o horário novo, máx 3 (spec C13)', async () => {
    const m = machine();
    const s = editSession();
    s.candidate.edit!.tries = 1;
    const out = await m.handleTurn({
      ...baseInput({ existing: [dentista] }),
      session: s,
      text: 'agora choca',
      editConflict: {
        title: 'Daily da equipe',
        startsAt: new Date('2026-10-09T19:00:00Z'),
        endsAt: new Date('2026-10-09T20:00:00Z'),
      },
    });
    expect(s.step).toBe('edit_propor');
    expect(texts(out)).toContain('Daily da equipe');
    expect(texts(out)).toContain('16:00');
    // 3ª tentativa com conflito de novo → sugere desistir mas ainda aceita tentar
    s.candidate.edit!.tries = 3;
    s.step = 'edit_propor';
    // Passo `edit_propor` (pós-conflito): fala sem quando utilizável → re-posta a
    // pergunta COM o conflitante e a saída de desistir (máx 3 — spec C13). Zero LLM.
    const out2 = await m.handleTurn({
      ...baseInput({ existing: [dentista] }),
      session: s,
      text: 'muda pro mesmo lugar',
      editConflict: {
        title: 'Daily da equipe',
        startsAt: new Date('2026-10-09T19:00:00Z'),
        endsAt: new Date('2026-10-09T20:00:00Z'),
      },
    });
    expect(s.step).toBe('edit_propor');
    expect(texts(out2)).toContain('desistir');
  });
});

describe('Máquina Fase 4 — escolher_candidata (spec B11, decisão #4)', () => {
  function candidatesSession(): FlowSession {
    return session({
      step: 'escolher_candidata',
      candidate: {
        conflictTries: 0,
        edit: {
          action: 'cancelar',
          descricao: 'reunião',
          intervalRange: {
            start: new Date('2026-10-08T03:00:00Z'),
            end: new Date('2026-10-09T03:00:00Z'),
          },
          candidates: [
            {
              id: 'c1',
              title: 'Reunião produto',
              startsAt: new Date('2026-10-08T14:00:00Z'),
              endsAt: new Date('2026-10-08T15:00:00Z'),
            },
            {
              id: 'c2',
              title: 'Reunião semanal',
              startsAt: new Date('2026-10-08T18:00:00Z'),
              endsAt: new Date('2026-10-08T19:00:00Z'),
            },
          ],
          tries: 0,
        },
      },
    });
  }

  it('"1" resolve a primeira candidata deterministicamente (zero LLM) e vai à confirmação de cancelar', async () => {
    const m = machine();
    const s = candidatesSession();
    const out = await m.handleTurn({ ...baseInput(), session: s, text: '1' });
    expect(s.step).toBe('confirmar_cancelamento_compromisso');
    expect(s.candidate.edit?.appointmentId).toBe('c1');
    expect(texts(out)).toContain('Reunião produto');
    expect(texts(out)).toContain('11:00'); // 14:00Z = 11:00 -03:00
    expect(texts(out)).toContain('(sim / não)');
  });

  it('número fora da lista re-pergunta; candidato intacto', async () => {
    const m = machine();
    const s = candidatesSession();
    const out = await m.handleTurn({ ...baseInput(), session: s, text: '7' });
    expect(s.step).toBe('escolher_candidata');
    expect(s.candidate.edit?.appointmentId).toBeUndefined();
    expect(texts(out)).toContain('1');
    expect(texts(out)).toContain('2');
  });

  it('escolha por texto (título da candidata) também resolve sem LLM', async () => {
    const m = machine();
    const s = candidatesSession();
    await m.handleTurn({ ...baseInput(), session: s, text: 'reunião semanal' });
    expect(s.step).toBe('confirmar_cancelamento_compromisso');
    expect(s.candidate.edit?.appointmentId).toBe('c2');
  });
});

describe('Máquina Fase 4 — confirmar_cancelamento_compromisso (spec D14)', () => {
  function cancelSession(): FlowSession {
    return session({
      step: 'confirmar_cancelamento_compromisso',
      candidate: {
        conflictTries: 0,
        edit: {
          action: 'cancelar',
          appointmentId: 'c1',
          fromTitle: 'Consulta dentista',
          fromStartUtc: new Date('2026-10-08T17:00:00Z'),
          fromEndUtc: new Date('2026-10-08T18:00:00Z'),
          tries: 0,
        },
      },
    });
  }

  it('"sim" emite cancelar (service apaga + invalida outbox)', async () => {
    const m = machine();
    const s = cancelSession();
    const out = await m.handleTurn({ ...baseInput(), session: s, text: 'sim' });
    expect(out.done).toBe(true);
    expect(out.cancelAppointment).toMatchObject({ appointmentId: 'c1' });
    expect(texts(out)).toContain('Consulta dentista');
  });

  it('"não": nada muda', async () => {
    const m = machine();
    const s = cancelSession();
    const out = await m.handleTurn({ ...baseInput(), session: s, text: 'não' });
    expect(out.done).toBe(true);
    expect(out.cancelAppointment).toBeUndefined();
  });

  it('ambíguo re-pergunta', async () => {
    const m = machine();
    const s = cancelSession();
    const out = await m.handleTurn({ ...baseInput(), session: s, text: 'hm' });
    expect(s.step).toBe('confirmar_cancelamento_compromisso');
    expect(out.done).toBeUndefined();
  });
});

describe('Máquina Fase 4 — roteamento com fluxo aberto (spec regra 9)', () => {
  it('editar_compromisso/cancelar_compromisso com fluxo aberto: proteção "descartar o atual?" primeiro', async () => {
    const m = machine();
    const s = session({ step: 'notas', candidate: { title: 'Atual', conflictTries: 0 } });
    for (const intentName of ['editar_compromisso', 'cancelar_compromisso'] as const) {
      s.step = 'notas';
      const out = await m.handleTurn({
        ...baseInput(),
        session: s,
        text: 'muda aquilo',
        classified: intent(intentName),
      });
      expect(s.step).toBe('confirmar_substituicao');
      expect(texts(out)).toContain('descartar');
    }
  });

  it('proteção preservada em confirmar_substituicao (re-classificou): re-posta a pergunta, nada descarta', async () => {
    const m = machine();
    const s = session({
      step: 'confirmar_substituicao',
      prevStep: 'notas',
      candidate: { title: 'Atual', conflictTries: 0 },
    });
    const out = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: 'muda aquilo',
      classified: intent('editar_compromisso'),
    });
    expect(s.step).toBe('confirmar_substituicao'); // a pergunta continua de pé
    expect(out.done).toBeUndefined(); // nada descartado, nada salvo
    expect(texts(out)).toContain('descartar');
  });
});
