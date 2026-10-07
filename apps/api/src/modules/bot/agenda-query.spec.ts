import { describe, expect, it } from 'vitest';
import {
  formatAppointmentLines,
  formatPeriodoLabel,
  resolveIntervaloRange,
  resolveSimboloRange,
  type AppointmentRow,
} from './agenda-query';

/**
 * Camada pura do turno de consulta (Fase 2): símbolo→intervalo, clamp de datas
 * explícitas ao dia civil local e formatação no tz do usuário. Base: America/Sao_Paulo
 * (-180), agora = qua 07/10/2026 08:00 local (11:00Z) — Gherkin da spec.
 * Meio-aberto, meia-noite local = 03:00Z.
 */
const sp = -180;
const now = new Date('2026-10-07T11:00:00Z');

const row = (over: Partial<AppointmentRow>): AppointmentRow => ({
  id: 'a1',
  title: 'Consulta',
  startsAt: new Date('2026-10-07T15:00:00Z'), // 12:00 local
  endsAt: new Date('2026-10-07T16:00:00Z'), // 13:00 local
  status: 'confirmed',
  ...over,
});

describe('resolveSimboloRange (regra #7 — tudo schedule-core)', () => {
  const cases: Array<[string, string, string]> = [
    ['hoje', '2026-10-07T03:00:00.000Z', '2026-10-08T03:00:00.000Z'],
    ['amanha', '2026-10-08T03:00:00.000Z', '2026-10-09T03:00:00.000Z'],
    ['depois_de_amanha', '2026-10-09T03:00:00.000Z', '2026-10-10T03:00:00.000Z'],
    ['esta_semana', '2026-10-05T03:00:00.000Z', '2026-10-12T03:00:00.000Z'],
    ['semana_que_vem', '2026-10-12T03:00:00.000Z', '2026-10-19T03:00:00.000Z'],
    ['este_mes', '2026-10-01T03:00:00.000Z', '2026-11-01T03:00:00.000Z'],
    ['mes_que_vem', '2026-11-01T03:00:00.000Z', '2026-12-01T03:00:00.000Z'],
    ['este_ano', '2026-01-01T03:00:00.000Z', '2027-01-01T03:00:00.000Z'],
    ['ano_que_vem', '2027-01-01T03:00:00.000Z', '2028-01-01T03:00:00.000Z'],
    ['fim_de_semana', '2026-10-10T03:00:00.000Z', '2026-10-12T03:00:00.000Z'],
  ];
  it.each(cases)('"%s" => [%s, %s) UTC (meia-noite local nas bordas)', (simbolo, start, end) => {
    const range = resolveSimboloRange(simbolo as never, now, sp);
    expect(range.start.toISOString()).toBe(start);
    expect(range.end.toISOString()).toBe(end);
  });
});

describe('resolveIntervaloRange (datas explícitas -> meia-noite LOCAL)', () => {
  it('"de 10 a 12" (from 10, to 13 do contrato) => [10/10 03:00Z, 13/10 03:00Z)', () => {
    const range = resolveIntervaloRange({ from: '2026-10-10', to: '2026-10-13' }, sp);
    expect(range?.start.toISOString()).toBe('2026-10-10T03:00:00.000Z');
    expect(range?.end.toISOString()).toBe('2026-10-13T03:00:00.000Z');
  });

  it('nunca 00:00Z: meia-noite local (-03:00) => 03:00Z', () => {
    const range = resolveIntervaloRange({ from: '2026-10-10', to: '2026-10-11' }, sp);
    expect(range?.start.toISOString()).not.toBe('2026-10-10T00:00:00.000Z');
  });

  it('rejeita non-date-only (datetime com hora) e fim <= inicio', () => {
    expect(resolveIntervaloRange({ from: '2026-10-10T08:00', to: '2026-10-11' }, sp)).toBeNull();
    expect(resolveIntervaloRange({ from: '2026-10-11', to: '2026-10-11' }, sp)).toBeNull();
    expect(resolveIntervaloRange({ from: '2026-10-12', to: '2026-10-11' }, sp)).toBeNull();
  });
});

describe('formatPeriodoLabel (cabeçalho repete o interpretado — spec #9)', () => {
  it('dia único: "em 07/10"', () => {
    const day = resolveSimboloRange('hoje', now, sp);
    expect(formatPeriodoLabel(day, sp)).toBe('em 07/10');
  });

  it('vários dias: "entre 10/10 e 12/10" (último dia incluído, não a borda exclusiva)', () => {
    const range = resolveIntervaloRange({ from: '2026-10-10', to: '2026-10-13' }, sp)!;
    expect(formatPeriodoLabel(range, sp)).toBe('entre 10/10 e 12/10');
  });
});

describe('formatAppointmentLines (spec #9/#3)', () => {
  it('agrupa por dia e formata HH:mm–HH:mm no tz do usuário', () => {
    const rows = [
      row({
        id: 'a',
        startsAt: new Date('2026-10-07T13:00:00Z'),
        endsAt: new Date('2026-10-07T14:00:00Z'),
        title: 'Academia',
      }), // 10:00 local
      row({
        id: 'b',
        startsAt: new Date('2026-10-07T17:00:00Z'),
        endsAt: new Date('2026-10-07T18:00:00Z'),
        title: 'Consulta',
      }), // 14:00 local
      row({
        id: 'c',
        startsAt: new Date('2026-10-08T12:00:00Z'),
        endsAt: new Date('2026-10-08T13:00:00Z'),
        title: 'Prova',
      }), // qui 09:00 local
    ];
    expect(formatAppointmentLines(rows, sp, '⚠️ conferindo')).toEqual([
      'qua 07/10',
      '10:00–11:00 — Academia',
      '14:00–15:00 — Consulta',
      'qui 08/10',
      '09:00–10:00 — Prova',
    ]);
  });

  it('needs_review ganha o marcador (decisão #3); confirmed não', () => {
    const rows = [row({ status: 'needs_review' }), row({ id: 'b', status: 'confirmed' })];
    const lines = formatAppointmentLines(rows, sp, '⚠️ conferindo');
    expect(lines[1]).toContain('⚠️ conferindo');
    expect(lines[2]).not.toContain('⚠️');
  });

  it('compromisso que atravessa a meia-noite local mostra o dia seguinte no fim', () => {
    const rows = [
      row({
        startsAt: new Date('2026-10-08T01:00:00Z'), // 22:00 local de 07/10
        endsAt: new Date('2026-10-08T04:00:00Z'), // 01:00 local de 08/10
      }),
    ];
    expect(formatAppointmentLines(rows, sp, '⚠️')).toEqual([
      'qua 07/10',
      '22:00–qui 08/10 01:00 — Consulta',
    ]);
  });
});
