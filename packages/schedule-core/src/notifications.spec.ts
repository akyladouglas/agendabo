import { describe, expect, it } from 'vitest';
import { appointmentsOnUserDay, computeTriggers, minutesBeforeFor } from './notifications';

const now = new Date('2026-10-05T12:00:00Z');
const startsAt = new Date('2026-10-10T17:00:00Z'); // compromisso futuro

const iso = (d: Date) => d.toISOString();

describe('minutesBeforeFor', () => {
  it('expande cada regra em minutos antes', () => {
    expect(minutesBeforeFor({ type: 'none' })).toEqual([]);
    expect(minutesBeforeFor({ type: 'before_hours', hours: 1 })).toEqual([60]);
    expect(minutesBeforeFor({ type: 'before_days', days: 2 })).toEqual([2880]);
    expect(minutesBeforeFor({ type: 'countdown_3_2_1' })).toEqual([4320, 2880, 1440]);
  });

  it('rejeita valores invalidos', () => {
    expect(() => minutesBeforeFor({ type: 'before_hours', hours: 0 })).toThrow();
    expect(() => minutesBeforeFor({ type: 'before_days', days: -1 })).toThrow();
    expect(() => minutesBeforeFor({ type: 'before_hours', hours: 1.5 })).toThrow();
  });
});

describe('computeTriggers (deterministico, a partir de startsAt UTC)', () => {
  it('24h antes', () => {
    const t = computeTriggers(startsAt, [{ type: 'before_hours', hours: 24 }], { now });
    expect(t).toHaveLength(1);
    expect(iso(t[0]!.firesAt)).toBe('2026-10-09T17:00:00.000Z');
    expect(t[0]!.minutesBefore).toBe(1440);
  });

  it('1, 2 ou 3 dias antes', () => {
    const t = computeTriggers(startsAt, [{ type: 'before_days', days: 3 }], { now });
    expect(iso(t[0]!.firesAt)).toBe('2026-10-07T17:00:00.000Z');
  });

  it('contagem regressiva 3-2-1 gera 3 disparos ordenados', () => {
    const t = computeTriggers(startsAt, [{ type: 'countdown_3_2_1' }], { now });
    expect(t.map((x) => iso(x.firesAt))).toEqual([
      '2026-10-07T17:00:00.000Z',
      '2026-10-08T17:00:00.000Z',
      '2026-10-09T17:00:00.000Z',
    ]);
  });

  it('combinacao livre (3 dias antes + 1h antes) ordenada', () => {
    const t = computeTriggers(
      startsAt,
      [
        { type: 'before_days', days: 3 },
        { type: 'before_hours', hours: 1 },
      ],
      { now },
    );
    expect(t.map((x) => iso(x.firesAt))).toEqual([
      '2026-10-07T17:00:00.000Z',
      '2026-10-10T16:00:00.000Z',
    ]);
  });

  it('sem lembrete => nenhum disparo', () => {
    expect(computeTriggers(startsAt, [{ type: 'none' }], { now })).toEqual([]);
    expect(computeTriggers(startsAt, [], { now })).toEqual([]);
  });

  it('deduplica disparos equivalentes (24h antes + contagem 3-2-1 colapsam o de 1 dia)', () => {
    const t = computeTriggers(
      startsAt,
      [
        { type: 'before_hours', hours: 24 },
        { type: 'countdown_3_2_1' },
      ],
      { now },
    );
    expect(t.map((x) => iso(x.firesAt))).toEqual([
      '2026-10-07T17:00:00.000Z',
      '2026-10-08T17:00:00.000Z',
      '2026-10-09T17:00:00.000Z',
    ]);
    expect(t[2]!.ruleType).toBe('before_hours'); // primeira regra vence o dedupe
  });

  it('descarta disparos ja no passado sem atrasar os demais', () => {
    const soon = new Date('2026-10-05T14:00:00Z'); // 2h a partir de now
    const t = computeTriggers(
      soon,
      [
        { type: 'countdown_3_2_1' }, // 3d e 2d atrasaram; 1d tambem => nada
        { type: 'before_hours', hours: 1 },
      ],
      { now },
    );
    expect(t.map((x) => iso(x.firesAt))).toEqual(['2026-10-05T13:00:00.000Z']);
  });

  it('nao gera disparo igual a now nem no futuro do compromisso', () => {
    const t = computeTriggers(new Date('2026-10-05T12:00:00Z'), [{ type: 'before_hours', hours: 1 }], {
      now,
    });
    expect(t).toEqual([]);
  });
});

describe('appointmentsOnUserDay (resumo diario 2.1, offset injetavel)', () => {
  const list = [
    { id: 'a', title: 'a', startsAt: new Date('2026-10-05T10:00:00Z') },
    { id: 'b', title: 'b', startsAt: new Date('2026-10-05T21:00:00Z') }, // 18:00 local (-03)
    { id: 'c', title: 'c', startsAt: new Date('2026-10-06T01:00:00Z') }, // 22:00 de 05 local!
    { id: 'd', title: 'd', startsAt: new Date('2026-10-06T10:00:00Z') },
  ];

  it('filtra pelo dia civil com offset -03:00', () => {
    const onDay = appointmentsOnUserDay(list, 'America/Sao_Paulo', now, (tz, at) => {
      void tz;
      void at;
      return -3 * 60 * 60_000;
    });
    expect(onDay.map((a) => a.id)).toEqual(['a', 'b', 'c']);
  });

  it('offset zero = dia UTC', () => {
    const onDay = appointmentsOnUserDay(list, 'UTC', now, () => 0);
    expect(onDay.map((a) => a.id)).toEqual(['a', 'b']);
  });
});
