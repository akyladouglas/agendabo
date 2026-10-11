import { describe, expect, it } from 'vitest';
import {
  SchedulingFlowMachine,
  type FlowSession,
} from './scheduling-flow.machine';
import type { BotUser } from './bot-access.service';

/**
 * Spec notas-e-fim-na-web, critério A (Gherkin): o passo `notas` da máquina usa o
 * `parseNotesAnswer` CORRIGIDO — frase real começando com "não" (≥ 4 palavras) vira
 * nota LITERAL e o fluxo segue para o lembrete; negação curta continua `null`.
 * Zero LLM na decisão (regression guard: nenhum `classified`/`extracted` no turno).
 * Datas fixas (testing.md).
 */

const NOW = new Date('2026-10-06T15:00:00Z'); // 12:00 em America/Sao_Paulo (-180)
const OFFSET = -180;
const TTL = 30 * 60_000;
const MIN_CONF = 0.7;

const user: BotUser = {
  id: 'u1',
  telegramId: '111',
  timezone: 'America/Sao_Paulo',
  name: null,
};

function notasSession(): FlowSession {
  return {
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
}

const baseInput = () => ({
  user,
  existing: [],
  offsetMinutes: OFFSET,
  now: NOW,
});

describe('máquina passo notas — frase começando com "não" é nota (spec A)', () => {
  it('"Não esquecer nada na volta" ⇒ notes literal e o fluxo segue para o lembrete (bug 2026-10-10)', async () => {
    const m = new SchedulingFlowMachine(TTL, MIN_CONF);
    const s = notasSession();

    const out = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: 'Não esquecer nada na volta',
      // SEM `classified`/`extracted`: regression guard — a decisão de notas é
      // determinística e não pede LLM neste turno.
    });
    expect(s.candidate.notes).toBe('Não esquecer nada na volta');
    expect(s.step).toBe('lembrete');
    expect(out.replies.map((r) => r.text).join('\n')).toContain('Como eu te lembro');
  });

  it('fronteira: "não tenho nada" (3 palavras) ⇒ notes null; "não esquecer nada aqui" (4) ⇒ literal', async () => {
    const m = new SchedulingFlowMachine(TTL, MIN_CONF);

    const s3 = notasSession();
    await m.handleTurn({ ...baseInput(), session: s3, text: 'não tenho nada' });
    expect(s3.candidate.notes).toBeNull();
    expect(s3.step).toBe('lembrete');

    const s4 = notasSession();
    await m.handleTurn({ ...baseInput(), session: s4, text: 'não esquecer nada aqui' });
    expect(s4.candidate.notes).toBe('não esquecer nada aqui');
    expect(s4.step).toBe('lembrete');
  });

  it('não regride: "não" puro ⇒ notes null e segue (spec mãe regra 5)', async () => {
    const m = new SchedulingFlowMachine(TTL, MIN_CONF);
    const s = notasSession();
    s.candidate.notes = 'semente para provar que é sobrescrito';
    await m.handleTurn({ ...baseInput(), session: s, text: 'não' });
    expect(s.candidate.notes).toBeNull();
    expect(s.step).toBe('lembrete');
  });
});
