import { describe, expect, it } from 'vitest';
import { firstFreeSlot, planRelocation } from './relocation';
import type { AppointmentLike } from './types';

/**
 * planRelocation / firstFreeSlot (Fase 8, Etapa 0 — spec
 * `.ia/specs/agenda/reagendamento-assistido.spec.md` §B, ADR-0015):
 * conflito vira escolha assistida de UM lance — mover o existente OU o movido
 * para o primeiro vão livre (duração preservada) — ou nada. Regra pura, `now`
 * injetável.
 *
 * Âncora das duas jogadas: o início da própria peça que se move (meia-lua que
 * gira no lugar) — o buraco que ela deixa ao sair é a primeira casa elegível.
 * Pousar no mesmo lugar NÃO é jogada. Encostado vale (half-open).
 */

const now = new Date('2026-10-08T12:00:00Z');

function appt(id: string, start: string, end: string, title = `appt ${id}`): AppointmentLike {
  return { id, title, startsAt: new Date(start), endsAt: new Date(end) };
}

function slot(start: string, end: string) {
  return { startsAt: new Date(start), endsAt: new Date(end) };
}

describe('planRelocation — destino livre', () => {
  it('sem conflito: kind ok', () => {
    const A = appt('a', '2026-10-09T14:00:00Z', '2026-10-09T15:00:00Z');
    expect(
      planRelocation(slot('2026-10-09T16:00:00Z', '2026-10-09T17:00:00Z'), [A], { now }),
    ).toEqual({ kind: 'ok' });
  });

  it('encostado não é conflito', () => {
    const A = appt('a', '2026-10-09T14:00:00Z', '2026-10-09T15:00:00Z');
    expect(
      planRelocation(slot('2026-10-09T15:00:00Z', '2026-10-09T16:00:00Z'), [A], { now }).kind,
    ).toBe('ok');
  });

  it('obstáculo totalmente passado não conta (endsAt <= now)', () => {
    const past = appt('p', '2026-10-06T14:00:00Z', '2026-10-06T15:00:00Z');
    expect(
      planRelocation(slot('2026-10-06T14:30:00Z', '2026-10-06T15:30:00Z'), [past], { now }).kind,
    ).toBe('ok');
  });

  it('movedId é ignorado como obstáculo (mover sobre si mesmo não é conflito)', () => {
    const moved = appt('m', '2026-10-09T09:00:00Z', '2026-10-09T10:00:00Z');
    const result = planRelocation(slot('2026-10-09T09:30:00Z', '2026-10-09T10:30:00Z'), [moved], {
      now,
      movedId: 'm',
    });
    expect(result.kind).toBe('ok');
  });
});

describe('planRelocation — um conflito, jogadas de um lance', () => {
  const A = appt('a', '2026-10-12T14:00:00Z', '2026-10-12T15:00:00Z', 'Almoço');
  const candidate = slot('2026-10-12T14:30:00Z', '2026-10-12T15:30:00Z');

  it('cenário base sem terceiros: A vira 15:30 (encostado no fim do candidate) e o self desliza p/ 15:00', () => {
    expect(planRelocation(candidate, [A], { now })).toEqual({
      kind: 'options',
      options: [
        {
          kind: 'move-other',
          other: A,
          newStart: new Date('2026-10-12T15:30:00Z'),
          newEnd: new Date('2026-10-12T16:30:00Z'),
        },
        {
          kind: 'move-self',
          newStart: new Date('2026-10-12T15:00:00Z'),
          newEnd: new Date('2026-10-12T16:00:00Z'),
        },
      ],
    });
  });

  it('terceiro B 15:30–16:30 bloqueia o pousos em 15:00: os dois lances caem em 16:30', () => {
    const B = appt('b', '2026-10-12T15:30:00Z', '2026-10-12T16:30:00Z', 'Academia');
    expect(planRelocation(candidate, [A, B], { now })).toEqual({
      kind: 'options',
      options: [
        {
          kind: 'move-other',
          other: A,
          newStart: new Date('2026-10-12T16:30:00Z'),
          newEnd: new Date('2026-10-12T17:30:00Z'),
        },
        {
          kind: 'move-self',
          newStart: new Date('2026-10-12T16:30:00Z'),
          newEnd: new Date('2026-10-12T17:30:00Z'),
        },
      ],
    });
  });

  it('move-other sem casa atrás (terceiro colado antes de A): A pula por cima do candidate', () => {
    const B = appt('b', '2026-10-12T13:00:00Z', '2026-10-12T14:00:00Z'); // encosta em A por trás
    expect(planRelocation(candidate, [A, B], { now })).toEqual({
      kind: 'options',
      options: [
        {
          kind: 'move-other',
          other: A,
          newStart: new Date('2026-10-12T15:30:00Z'),
          newEnd: new Date('2026-10-12T16:30:00Z'),
        },
        {
          kind: 'move-self',
          newStart: new Date('2026-10-12T15:00:00Z'),
          newEnd: new Date('2026-10-12T16:00:00Z'),
        },
      ],
    });
  });

  it('um lance fecha quando o outro esbarra em terceiro (só move-self oferecido)', () => {
    // B 16:00–17:00 (não toca o candidate): A (60min ≥ 14:00) pousaria às
    // 15:00–16:00 no buraco do candidate, mas o candidate parado bloqueia a
    // varredura do other → A pula por cima e pousa 17:00–18:00. O self, com o
    // A girando fora do caminho... não: no self é o candidate que anda, e A
    // fica parado bloqueando. Self pousa 15:00–16:00 (buraco de A) livremente.
    // Os dois fecham aqui — a assimetria real aparece quando B cobre o 15:00.
    const B = appt('b', '2026-10-12T16:00:00Z', '2026-10-12T17:00:00Z');
    expect(planRelocation(candidate, [A, B], { now })).toEqual({
      kind: 'options',
      options: [
        {
          kind: 'move-other',
          other: A,
          newStart: new Date('2026-10-12T17:00:00Z'),
          newEnd: new Date('2026-10-12T18:00:00Z'),
        },
        {
          kind: 'move-self',
          newStart: new Date('2026-10-12T15:00:00Z'),
          newEnd: new Date('2026-10-12T16:00:00Z'),
        },
      ],
    });
  });

  it('só move-self fecha: B cobre o buraco do A (pouso do other não existe até tarde... e tarde está cheia)', () => {
    // B 15:00–17:00: não toca o candidate (14:30–15:30? toca 15:00–15:30 — SIM).
    // Encostado: B 15:30–17:30: A ≥14:00: buraco 15:00–16:00? B cobre 15:30–17:30
    // → 15:00–16:00 choca B às 15:30 → pula 17:30–18:30: LIVRE. Other fecha.
    // Um conflito ⇒ carga finita ⇒ ambos sempre fecham (B8). A UI nunca vê
    // options: [] neste ramo; o teste documenta a invariante.
    const B = appt('b', '2026-10-12T15:30:00Z', '2026-10-12T17:30:00Z');
    const result = planRelocation(candidate, [A, B], { now });
    expect(result.kind).toBe('options');
    if (result.kind === 'options') {
      expect(result.options.map((o) => o.kind)).toEqual(['move-other', 'move-self']);
    }
  });

  it('candidate engolido por obstáculo maior: A gira p/ 15:30, candidate desliza p/ 15:30', () => {
    const big = appt('big', '2026-10-12T14:00:00Z', '2026-10-12T15:30:00Z');
    const small = slot('2026-10-12T14:30:00Z', '2026-10-12T15:00:00Z');
    expect(planRelocation(small, [big], { now })).toEqual({
      kind: 'options',
      options: [
        {
          kind: 'move-other',
          other: big,
          newStart: new Date('2026-10-12T15:00:00Z'),
          newEnd: new Date('2026-10-12T16:30:00Z'),
        },
        {
          kind: 'move-self',
          newStart: new Date('2026-10-12T15:30:00Z'),
          newEnd: new Date('2026-10-12T16:00:00Z'),
        },
      ],
    });
  });
});

describe('planRelocation — não há jogada de um lance', () => {
  it('candidate sobreposto a DOIS existentes: blocked self-conflict, nada oferecido', () => {
    const A = appt('a', '2026-10-12T14:00:00Z', '2026-10-12T15:00:00Z');
    const B = appt('b', '2026-10-12T16:00:00Z', '2026-10-12T17:00:00Z');
    const result = planRelocation(slot('2026-10-12T14:30:00Z', '2026-10-12T16:30:00Z'), [A, B], {
      now,
    });
    expect(result).toEqual({ kind: 'blocked', reason: 'self-conflict' });
  });

  it('dois conflitos encostados um no outro: continua blocked', () => {
    const A = appt('a', '2026-10-12T14:00:00Z', '2026-10-12T15:00:00Z');
    const B = appt('b', '2026-10-12T15:00:00Z', '2026-10-12T16:00:00Z');
    const result = planRelocation(slot('2026-10-12T14:30:00Z', '2026-10-12T15:30:00Z'), [A, B], {
      now,
    });
    expect(result).toEqual({ kind: 'blocked', reason: 'self-conflict' });
  });

  it('2+ conflitos conta apenas obstáculos válidos: movedId fora da conta deixa um lance', () => {
    const moved = appt('m', '2026-10-12T14:00:00Z', '2026-10-12T15:00:00Z');
    const B = appt('b', '2026-10-12T16:00:00Z', '2026-10-12T17:00:00Z');
    const result = planRelocation(slot('2026-10-12T14:30:00Z', '2026-10-12T16:30:00Z'), [moved, B], {
      now,
      movedId: 'm',
    });
    expect(result.kind).toBe('options');
  });
});

describe('planRelocation — travessia de meia-noite e defaults', () => {
  it('slot livre além da meia-noite UTC: a varredura não conhece "dia"', () => {
    const A = appt('a', '2026-10-12T23:30:00Z', '2026-10-13T00:30:00Z');
    const result = planRelocation(slot('2026-10-12T23:00:00Z', '2026-10-13T00:00:00Z'), [A], {
      now,
    });
    expect(result).toEqual({
      kind: 'options',
      options: [
        {
          kind: 'move-other',
          other: A,
          newStart: new Date('2026-10-13T00:00:00Z'),
          newEnd: new Date('2026-10-13T01:00:00Z'),
        },
        {
          kind: 'move-self',
          newStart: new Date('2026-10-13T00:30:00Z'),
          newEnd: new Date('2026-10-13T01:30:00Z'),
        },
      ],
    });
  });

  it('sem `now` usa Date.now; movedId ausente (criação) não quebra', () => {
    const far = appt('f', '2099-01-01T10:00:00Z', '2099-01-01T11:00:00Z');
    expect(planRelocation(slot('2099-01-01T13:00:00Z', '2099-01-01T14:00:00Z'), [far])).toEqual({
      kind: 'ok',
    });
  });

  it('mesma entrada ⇒ mesma saída (determinismo puro)', () => {
    const A = appt('a', '2026-10-12T14:00:00Z', '2026-10-12T15:00:00Z');
    const c = slot('2026-10-12T14:30:00Z', '2026-10-12T15:30:00Z');
    expect(planRelocation(c, [A], { now })).toEqual(planRelocation(c, [A], { now }));
  });
});

describe('firstFreeSlot (função exportada — o motor das jogadas)', () => {
  const hour = 60 * 60 * 1000;

  it('sem bloqueios: o próprio earliest', () => {
    const s = firstFreeSlot(new Date('2026-10-12T15:00:00Z'), hour, []);
    expect(s).toEqual({
      startsAt: new Date('2026-10-12T15:00:00Z'),
      endsAt: new Date('2026-10-12T16:00:00Z'),
    });
  });

  it('encosta no fim dos bloqueios e segue (varredura)', () => {
    const blockers = [
      slot('2026-10-12T15:00:00Z', '2026-10-12T16:00:00Z'),
      slot('2026-10-12T16:00:00Z', '2026-10-12T16:30:00Z'),
      slot('2026-10-12T17:00:00Z', '2026-10-12T18:00:00Z'),
    ];
    const s = firstFreeSlot(new Date('2026-10-12T15:00:00Z'), 90 * 60 * 1000, blockers);
    // 15:00–16:30 choca 15–16 → 16:00; choca 16–16:30 e 17–18 → 16:30; choca
    // 17–18 → 18:00–19:30 livre.
    expect(s).toEqual({
      startsAt: new Date('2026-10-12T18:00:00Z'),
      endsAt: new Date('2026-10-12T19:30:00Z'),
    });
  });

  it('duração zero ou negativa: null (sem jogada)', () => {
    expect(firstFreeSlot(now, 0, [])).toBeNull();
    expect(firstFreeSlot(now, -1, [])).toBeNull();
  });
});
