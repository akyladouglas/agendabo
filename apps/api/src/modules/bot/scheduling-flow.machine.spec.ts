import { describe, expect, it } from 'vitest';
import {
  SchedulingFlowMachine,
  type FlowSession,
  type HandleTurnInput,
} from './scheduling-flow.machine';
import type { BotUser } from './bot-access.service';
import type { AppointmentLike } from '@agendabo/schedule-core';

/**
 * Transições da máquina de estados do agendamento (spec criar-compromisso-bot,
 * regras 3–13). Domínio puro: relógio (`now`), existing (banco) e intenção (LLM)
 * entram injetados — nada de Nest/Prisma/Telegraf aqui (testing.md).
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

describe('SchedulingFlowMachine - fluxo feliz (spec 3+4+6)', () => {
  it('título → dia (hoje) → hora → fim → sem conflito → notas → confirma → create UTC', async () => {
    const m = machine();
    const s = session();

    // (a) título
    const r1 = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: 'Reunião',
      classified: intent('continuar_fluxo'),
    });
    expect(s.step).toBe('dia');
    expect(texts(r1)).toContain('Reunião');

    // (b) dia via teclado: hoje
    const r2 = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: '',
      dayChoice: { year: 2026, month: 10, day: 6 },
    });
    expect(s.step).toBe('hora');
    expect(texts(r2)).toContain('começa');

    // (b) hora local 14:30
    await m.handleTurn({ ...baseInput(), session: s, text: '14:30' });
    expect(s.step).toBe('fim');

    // (c) fim "1h" => duração
    const r4 = await m.handleTurn({ ...baseInput(), session: s, text: '1h' });
    expect(s.step).toBe('notas'); // sem conflito
    expect(texts(r4)).toContain('anotar');

    // (e) notas: pergunta duvidosa re-pergunta; "não" => notes null
    const r5a = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: 'hm',
      classified: intent('continuar_fluxo'),
    });
    expect(s.step).toBe('notas');
    expect(texts(r5a)).toContain('anotar');
    const r5 = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: 'não',
      classified: intent('continuar_fluxo'),
    });
    expect(s.step).toBe('lembrete'); // Fase 3: notas → lembrete (spec criar-compromisso regra 5)
    expect(texts(r5)).toContain('Como eu te lembro');

    // (e.5) lembrete: "não" (atalho determinístico) => sem lembrete => resumo final
    const rL = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: 'não',
      classified: intent('continuar_fluxo'),
      reminder: { ok: true, regras: [{ type: 'none' }] },
    });
    expect(s.step).toBe('confirmacao');
    expect(rL.replies[0]).toMatchObject({ kind: 'buttons', buttons: ['confirmar', 'alterar'] });

    // (f/g) confirmação única => create
    const r6 = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: 'confirmar',
      classified: intent('continuar_fluxo'),
    });
    expect(r6.done).toBe(true);
    expect(r6.create).toEqual({
      title: 'Reunião',
      // 14:30 e 15:30 em -03:00 => UTC
      startsAt: new Date('2026-10-06T17:30:00Z'),
      endsAt: new Date('2026-10-06T18:30:00Z'),
      notes: null,
      notificationRules: [],
      timezone: 'America/Sao_Paulo',
    });
    expect(texts(r6)).toContain('14:30'); // exibe no tz do usuário, não UTC (spec 14)
  });

  it('lembrete: atalho "3 dias antes" vira before_days:3 no create (Fase 3, spec regra 2)', async () => {
    const m = machine();
    const s: FlowSession = {
      step: 'lembrete',
      candidate: {
        title: 'Consulta',
        day: { year: 2026, month: 10, day: 9 },
        startMinutes: 14 * 60,
        startUtc: new Date('2026-10-09T17:00:00Z'),
        endUtc: new Date('2026-10-09T18:00:00Z'),
        notes: null,
        conflictTries: 0,
      },
      lastActivityAt: NOW.getTime(),
    };
    const out = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: '3 dias antes',
      reminder: { ok: true, regras: [{ type: 'before_days', value: 3 }] },
    });
    expect(s.step).toBe('confirmacao');
    expect(texts(out)).toContain('3 dias'); // linha ⏰ no resumo final
    const yes = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: 'confirmar',
      classified: intent('continuar_fluxo'),
    });
    expect(yes.create?.notificationRules).toEqual([{ type: 'before_days', value: 3 }]);
  });

  it('lembrete: multi-regra do LLM passa inteira para o create (Fase 3, decisao #2)', async () => {
    const m = machine();
    const s: FlowSession = {
      step: 'lembrete',
      candidate: {
        title: 'Prova',
        day: { year: 2026, month: 10, day: 20 },
        startMinutes: 13 * 60,
        startUtc: new Date('2026-10-20T16:00:00Z'),
        endUtc: new Date('2026-10-20T19:00:00Z'),
        notes: null,
        conflictTries: 0,
      },
      lastActivityAt: NOW.getTime(),
    };
    await m.handleTurn({
      ...baseInput(),
      session: s,
      text: '2 horas antes e 1 dia antes',
      reminder: {
        ok: true,
        regras: [
          { type: 'before_hours', value: 2 },
          { type: 'before_days', value: 1 },
        ],
      },
    });
    const yes = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: 'confirmar',
      classified: intent('continuar_fluxo'),
    });
    expect(yes.create?.notificationRules).toEqual([
      { type: 'before_hours', value: 2 },
      { type: 'before_days', value: 1 },
    ]);
  });

  it('lembrete: veredito !ok (parse falho) RE-PERGUNTA e nao grava nada (Fase 3, spec regra 4)', async () => {
    const m = machine();
    const s: FlowSession = {
      step: 'lembrete',
      candidate: {
        title: 'X',
        startUtc: new Date('2026-10-09T17:00:00Z'),
        endUtc: new Date('2026-10-09T18:00:00Z'),
        conflictTries: 0,
      },
      lastActivityAt: NOW.getTime(),
    };
    const out = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: 'blablabla',
      reminder: { ok: false, reason: 'unparseable' },
    });
    expect(s.step).toBe('lembrete');
    expect(s.candidate.reminderRules).toBeUndefined();
    expect(out.done).toBeUndefined();
    expect(out.create).toBeUndefined();
  });

  it('lembrete: regra retroativa avisa no resumo mas mantem a regra (Fase 3, spec regra 7)', async () => {
    const m = machine();
    // agora = 06/10 12:00 local; compromisso 07/10 14:00 => "3 dias antes" ja passou
    const s: FlowSession = {
      step: 'lembrete',
      candidate: {
        title: 'Almoco',
        day: { year: 2026, month: 10, day: 7 },
        startMinutes: 14 * 60,
        startUtc: new Date('2026-10-07T17:00:00Z'),
        endUtc: new Date('2026-10-07T18:00:00Z'),
        notes: null,
        conflictTries: 0,
      },
      lastActivityAt: NOW.getTime(),
    };
    const out = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: '3 dias antes',
      reminder: { ok: true, regras: [{ type: 'before_days', value: 3 }] },
    });
    expect(s.step).toBe('confirmacao');
    expect(texts(out)).toContain('3 dias'); // regra continua no resumo
    expect(texts(out)).toContain('não vai disparar'); // aviso de gatilho retroativo
  });

  it('lembrete: "sem lembrete" grava none e o create vem sem regras (Fase 3, spec regra 3)', async () => {
    const m = machine();
    const s: FlowSession = {
      step: 'lembrete',
      candidate: {
        title: 'X',
        startUtc: new Date('2026-10-09T17:00:00Z'),
        endUtc: new Date('2026-10-09T18:00:00Z'),
        notes: null,
        conflictTries: 0,
      },
      lastActivityAt: NOW.getTime(),
    };
    await m.handleTurn({
      ...baseInput(),
      session: s,
      text: 'sem lembrete',
      reminder: { ok: true, regras: [{ type: 'none' }] },
    });
    const yes = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: 'confirmar',
      classified: intent('continuar_fluxo'),
    });
    expect(yes.create?.notificationRules).toEqual([]);
  });

  it('confirmacao: "alterar o lembrete" volta ao passo lembrete (rewind Fase 3)', async () => {
    const m = machine();
    const s: FlowSession = {
      step: 'confirmacao',
      candidate: {
        title: 'X',
        startUtc: new Date('2026-10-09T17:00:00Z'),
        endUtc: new Date('2026-10-09T18:00:00Z'),
        notes: null,
        reminderRules: [{ type: 'none' }],
        conflictTries: 0,
      },
      lastActivityAt: NOW.getTime(),
    };
    const out = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: 'alterar o lembrete',
      classified: intent('continuar_fluxo'),
    });
    expect(s.step).toBe('lembrete');
    expect(out.replies[0]).toMatchObject({ kind: 'buttons' });
  });

  it('notas: "anotar: levar o orçamento" salva só o texto (spec regra 5)', async () => {
    const m = machine();
    const s: FlowSession = {
      step: 'notas',
      candidate: {
        title: 'Consulta',
        day: { year: 2026, month: 10, day: 6 },
        startMinutes: 14 * 60,
        startUtc: new Date('2026-10-06T17:00:00Z'),
        endUtc: new Date('2026-10-06T18:00:00Z'),
        conflictTries: 0,
      },
      lastActivityAt: NOW.getTime(),
    };

    await m.handleTurn({
      ...baseInput(),
      session: s,
      text: 'anotar: levar o orçamento',
      classified: intent('continuar_fluxo'),
    });
    // passo `lembrete` no meio (Fase 3): "sem lembrete" fecha o passo
    await m.handleTurn({
      ...baseInput(),
      session: s,
      text: 'sem lembrete',
      classified: intent('continuar_fluxo'),
      reminder: { ok: true, regras: [{ type: 'none' }] },
    });
    const out = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: 'confirmar',
      classified: intent('continuar_fluxo'),
    });
    expect(out.create?.notes).toBe('levar o orçamento');
  });
});

describe('SchedulingFlowMachine — conflito (spec 7–11)', () => {
  const dentista: AppointmentLike = {
    id: 'a1',
    title: 'Consulta dentista',
    startsAt: new Date('2026-10-06T17:00:00Z'), // 14:00 local
    endsAt: new Date('2026-10-06T18:00:00Z'), // 15:00 local
  };

  async function toFim(m: SchedulingFlowMachine) {
    const s = session({
      step: 'fim',
      candidate: {
        title: 'Reunião',
        day: { year: 2026, month: 10, day: 6 },
        startMinutes: 14 * 60 + 30,
        startUtc: new Date('2026-10-06T17:30:00Z'),
        conflictTries: 0,
      },
    });
    return {
      s,
      out: await m.handleTurn({
        ...baseInput({ existing: [dentista] }),
        session: s,
        text: '15:30',
      }),
    };
  }

  it('conflito cita título + horário do existente no tz do usuário e pergunta remarcar/abortar (1.1)', async () => {
    const m = machine();
    const { s, out } = await toFim(m);
    expect(s.step).toBe('conflito');
    expect(texts(out)).toContain('Consulta dentista');
    expect(texts(out)).toContain('14:00');
    expect(texts(out)).toContain('15:00');
    expect(out.create).toBeUndefined();
    const buttons = out.replies.flatMap((r) => (r.kind === 'buttons' ? r.buttons : []));
    expect(buttons).toEqual(expect.arrayContaining(['remarcar', 'abortar']));
  });

  it('encostado (15:00–16:00) NÃO conflita e segue para notas (spec 8)', async () => {
    const m = machine();
    const s = session({
      step: 'fim',
      candidate: {
        title: 'Almoço',
        day: { year: 2026, month: 10, day: 6 },
        startMinutes: 15 * 60,
        startUtc: new Date('2026-10-06T18:00:00Z'),
        conflictTries: 0,
      },
    });
    await m.handleTurn({
      ...baseInput({ existing: [dentista] }),
      session: s,
      text: '16:00',
    });
    expect(s.step).toBe('notas');
  });

  it('remarcar re-executa a checagem com o novo horário livre e segue (spec 10)', async () => {
    const m = machine();
    const { s } = await toFim(m);
    // usuário escolhe remarcar via intenção
    await m.handleTurn({
      ...baseInput({ existing: [dentista] }),
      session: s,
      text: 'quero remarcar',
      classified: intent('remarcar'),
    });
    expect(s.step).toBe('dia');
    await m.handleTurn({
      ...baseInput({ existing: [dentista] }),
      session: s,
      text: '',
      dayChoice: { year: 2026, month: 10, day: 6 },
    });
    await m.handleTurn({ ...baseInput({ existing: [dentista] }), session: s, text: '16:00' });
    const out = await m.handleTurn({
      ...baseInput({ existing: [dentista] }),
      session: s,
      text: '17:00',
    });
    expect(s.step).toBe('notas'); // 16–17 livre
    expect(texts(out)).toContain('anotar');
  });

  it('abortar no ramo de conflito: nada é salvo e o fluxo termina (spec 11)', async () => {
    const m = machine();
    const { s } = await toFim(m);
    const out = await m.handleTurn({
      ...baseInput({ existing: [dentista] }),
      session: s,
      text: 'abortar',
      classified: intent('continuar_fluxo'),
    });
    expect(out.done).toBe(true);
    expect(out.create).toBeUndefined();
    expect(texts(out)).toContain('abortado');
  });

  it('após 3 tentativas o bot sugere abortar mas ainda aceita tentar (spec decisão 4)', async () => {
    const m = machine();
    const { s } = await toFim(m);
    s.candidate.conflictTries = 3;
    s.step = 'fim';
    const out = await m.handleTurn({
      ...baseInput({ existing: [dentista] }),
      session: s,
      text: '15:30',
    });
    expect(texts(out)).toContain('abortar');
    expect(texts(out)).toContain('tentar');
  });
});

describe('SchedulingFlowMachine — validações e cancelamento (spec 12–13)', () => {
  it('fim <= início: re-pergunta o horário e nada muda (spec 12)', async () => {
    const m = machine();
    const s = session({
      step: 'fim',
      candidate: {
        title: 'X',
        day: { year: 2026, month: 10, day: 6 },
        startMinutes: 14 * 60,
        startUtc: new Date('2026-10-06T17:00:00Z'),
        conflictTries: 0,
      },
    });
    // fim == inicio => re-pergunta com erro, nada e criado nem descartado (spec 12).
    const out = await m.handleTurn({ ...baseInput(), session: s, text: '14:00' });
    expect(s.step).toBe('fim');
    expect(texts(out)).toContain('depois do início');
    expect(out.create).toBeUndefined();
    expect(out.done).toBeUndefined();
  });

  it('duração 0 ("0min") é inválida: re-pergunta com erro, nada é criado/descartado (spec 12)', async () => {
    const m = machine();
    const s = session({
      step: 'fim',
      candidate: {
        title: 'X',
        day: { year: 2026, month: 10, day: 6 },
        startMinutes: 14 * 60,
        startUtc: new Date('2026-10-06T17:00:00Z'),
        conflictTries: 0,
      },
    });
    const out = await m.handleTurn({ ...baseInput(), session: s, text: '0min' });
    expect(s.step).toBe('fim');
    expect(texts(out)).toContain('depois do início');
    expect(out.done).toBeUndefined();
    expect(out.create).toBeUndefined();
  });

  it('cancelar com confiança ALTA em qualquer etapa: descarta e nada salva (spec 13)', async () => {
    const m = machine();
    const s = session({ step: 'notas' });
    const out = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: 'deixa pra lá',
      classified: intent('cancelar', 0.9),
    });
    expect(out.done).toBe(true);
    expect(out.create).toBeUndefined();
    expect(texts(out)).toContain('cancelei');
  });

  it('classificação falha (parse) NÃO permite transição destrutiva: texto vira dado do passo (spec 13)', async () => {
    const m = machine();
    const s = session({ step: 'notas' });
    const out = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: 'deixa quieta',
      classified: { ok: false, reason: 'low_confidence' },
    });
    // sem intencao aceita, o texto e tratado como DADO do passo (vira nota) — o fluxo
    // continua e nada e descartado no chute; o proximo passo (lembrete, Fase 3) vem e
    // a confirmacao so chega depois dela (spec: nunca no chute).
    expect(s.step).toBe('lembrete');
    expect(s.candidate.notes).toBe('deixa quieta');
    expect(out.done).toBeUndefined();
    expect(out.create).toBeUndefined();
  });

  it('cancelar ambíguo (classificado cancelar, mas usuário pode negar na pergunta)', async () => {
    const m = machine();
    const s = session({ step: 'notas', candidate: { title: 'X', conflictTries: 0 } });
    const out = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: 'deixa quieta',
      classified: intent('cancelar', 0.75),
    });
    expect(s.step).toBe('confirmar_cancelamento');
    expect(texts(out)).toContain('cancelar este compromisso, certo?');
    // usuário nega: volta para o passo anterior, nada é descartado
    const back = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: 'não',
      classified: intent('continuar_fluxo'),
    });
    expect(s.step).toBe('notas'); // volta exatamente ao passo em que estava
    expect(back.done).toBeUndefined();
  });

  it('substituir_atual: pergunta antes de descartar; "sim" descarta, "não" continua (spec decisão 9)', async () => {
    const m = machine();
    const s = session({ step: 'notas', candidate: { title: 'Atual', conflictTries: 0 } });
    const out = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: 'marca outra coisa',
      classified: intent('substituir_atual'),
    });
    expect(s.step).toBe('confirmar_substituicao');
    expect(texts(out)).toContain('descartar');

    const keep = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: 'não',
      classified: intent('continuar_fluxo'),
    });
    expect(keep.done).toBeUndefined();
    expect(s.step).toBe('notas');

    const drop = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: 'marca outra coisa',
      classified: intent('substituir_atual'),
    });
    expect(texts(drop)).toContain('descartar');
    const yes = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: 'sim',
      classified: intent('continuar_fluxo'),
    });
    expect(yes.done).toBe(true);
    expect(yes.create).toBeUndefined();
  });
});

describe('SchedulingFlowMachine — atalhos e tz (spec 2, 7, 14)', () => {
  it('"amanhã" resolve no dia civil do usuário (-03:00)', async () => {
    const m = machine();
    const s = session({ step: 'dia', candidate: { title: 'X', conflictTries: 0 } });
    const out = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: 'amanhã',
      classified: intent('continuar_fluxo'),
    });
    expect(s.step).toBe('hora');
    expect(s.candidate.day).toEqual({ year: 2026, month: 10, day: 7 });
    expect(texts(out)).toContain('07/10');
  });

  it('"hoje" resolve hoje no tz; horário local vira UTC (-03:00 => +3h)', async () => {
    const m = machine();
    const s = session({ step: 'dia', candidate: { title: 'X', conflictTries: 0 } });
    await m.handleTurn({
      ...baseInput(),
      session: s,
      text: 'hoje',
      classified: intent('continuar_fluxo'),
    });
    await m.handleTurn({ ...baseInput(), session: s, text: '14:00' });
    expect(s.candidate.startUtc).toEqual(new Date('2026-10-06T17:00:00Z'));
  });

  it('TTL: sessão expirada é reportada como expirada (chamado descarta)', () => {
    const m = machine();
    const s = session({ lastActivityAt: new Date(NOW.getTime() - 31 * 60_000).getTime() });
    expect(m.isExpired(s, NOW)).toBe(true);
    expect(m.isExpired(session(), NOW)).toBe(false);
  });

  it('teclado de dias começa em Hoje/Amanhã', () => {
    const buttons = machine().dayButtons(OFFSET, NOW);
    expect(buttons.slice(0, 2)).toEqual(['Hoje', 'Amanhã']);
  });

  it('baixa confiança de classificação NÃO permite transição destrutiva: texto vira dado do passo', async () => {
    const m = machine();
    const s = session(); // etapa título
    const out = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: 'Dentista',
      classified: { ok: false, reason: 'parse' },
    });
    // sem intenção aceita, "Dentista" é o título do passo atual — o fluxo AVANÇA, não aborta
    expect(s.step).toBe('dia');
    expect(s.candidate.title).toBe('Dentista');
    expect(out.done).toBeUndefined();
  });

  it('alterar no resumo volta ao passo pedido sem perder o resto', async () => {
    const m = machine();
    const s: FlowSession = {
      step: 'confirmacao',
      candidate: {
        title: 'Consulta',
        day: { year: 2026, month: 10, day: 6 },
        startMinutes: 14 * 60,
        startUtc: new Date('2026-10-06T17:00:00Z'),
        endUtc: new Date('2026-10-06T18:00:00Z'),
        notes: null,
        conflictTries: 0,
      },
      lastActivityAt: NOW.getTime(),
    };
    const out = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: 'alterar o horário',
      classified: intent('continuar_fluxo'),
    });
    expect(s.step).toBe('hora');
    expect(texts(out)).toContain('começa');
    expect(s.candidate.title).toBe('Consulta');
  });
});
