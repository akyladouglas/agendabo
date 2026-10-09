import { describe, expect, it } from 'vitest';
import { hourGrid } from './hourGrid';
import { shiftDayRange, userDayRange } from './dates';

/**
 * TDD (testing.md — data nasce com teste): a grade de horas da visão Dia.
 * Base fixa: America/Sao_Paulo (-180), `now` sempre injetado (schedule-core.md).
 */
const sp = -180;

describe('hourGrid — células por hora coberta pela range UTC do dia (1.1)', () => {
  it('dia civil completo (-180): 24 células 0..23, âncoras são as horas LOCAIS do dia', () => {
    const day = userDayRange(new Date('2026-10-08T12:00:00Z'), sp); // 08/10: 03:00Z→03:00Z
    const cells = hourGrid(day, sp);
    expect(cells).toHaveLength(24);
    expect(cells.map((c) => c.hourUtc)).toEqual([
      '00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11',
      '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23',
    ]);
    // meia-noite LOCAL em -03:00 = 03:00Z; a célula "00" é o início da range
    expect(cells[0]!.start.toISOString()).toBe('2026-10-08T03:00:00.000Z');
    expect(cells[23]!.start.toISOString()).toBe('2026-10-09T02:00:00.000Z');
    // half-open: cada célula termina onde a próxima começa
    for (let i = 1; i < cells.length; i++) {
      expect(cells[i]!.start.toISOString()).toBe(cells[i - 1]!.end.toISOString());
      expect(cells[i]!.end.toISOString()).toBe(
        new Date(cells[i]!.start.getTime() + 3_600_000).toISOString(),
      );
    }
    // a última célula fecha EXATAMENTE no fim da range
    expect(cells[23]!.end.toISOString()).toBe(day.end.toISOString());
  });

  it('label = hora local formatada "HH:mm" (rótulo da linha da grade)', () => {
    const cells = hourGrid(userDayRange(new Date('2026-10-08T12:00:00Z'), sp), sp);
    expect(cells[0]!.label).toBe('00:00');
    expect(cells[9]!.label).toBe('09:00');
    expect(cells[23]!.label).toBe('23:00');
  });

  it('agora injetado: só as células cujo FIM passou são passadas (half-open)', () => {
    const day = userDayRange(new Date('2026-10-08T12:00:00Z'), sp);
    // agora = 10:30 local = 13:30Z: a célula 10:00–11:00 ainda não passou por inteiro
    const cells = hourGrid(day, sp, new Date('2026-10-08T13:30:00Z'));
    expect(cells.filter((c) => c.isPast).map((c) => c.hourUtc)).toEqual([
      '00', '01', '02', '03', '04', '05', '06', '07', '08', '09',
    ]);
  });

  it('now no exato limite da célula: essa célula NÃO é passada (fim == agora não conta)', () => {
    const day = userDayRange(new Date('2026-10-08T12:00:00Z'), sp);
    const cells = hourGrid(day, sp, new Date('2026-10-08T13:00:00Z')); // 10:00 local
    expect(cells.find((c) => c.hourUtc === '09')!.isPast).toBe(true);
    expect(cells.find((c) => c.hourUtc === '10')!.isPast).toBe(false);
  });

  it('sem `now`: nenhuma célula marcada como passada', () => {
    const cells = hourGrid(userDayRange(new Date('2026-10-08T12:00:00Z'), sp), sp);
    expect(cells.every((c) => c.isPast === false)).toBe(true);
  });

  it('range parcial (tarde): só as horas cobertas, com horas locais corretas', () => {
    const full = userDayRange(new Date('2026-10-08T12:00:00Z'), sp);
    const range = {
      start: new Date(full.start.getTime() + 14 * 3_600_000), // 14:00 local
      end: new Date(full.start.getTime() + 18 * 3_600_000), // 18:00 local (half-open)
    };
    const cells = hourGrid(range, sp);
    expect(cells.map((c) => c.hourUtc)).toEqual(['14', '15', '16', '17']);
    expect(cells[0]!.start.toISOString()).toBe('2026-10-08T17:00:00.000Z');
  });

  it('offset 0 (UTC): as horas locais coincidem com as horas UTC da range', () => {
    const day = userDayRange(new Date('2026-10-08T12:00:00Z'), 0);
    const cells = hourGrid(day, 0);
    expect(cells[0]!.start.toISOString()).toBe('2026-10-08T00:00:00.000Z');
    expect(cells[23]!.start.toISOString()).toBe('2026-10-08T23:00:00.000Z');
    expect(cells[0]!.hourUtc).toBe('00');
    expect(cells[23]!.hourUtc).toBe('23');
  });

  it('range que atravessa a meia-noite UTC (dia civil -180): horas locais contínuas', () => {
    // 08/10 local: 03:00Z(08) → 03:00Z(09) — 3 células caem no dia UTC 08, 21 no 09
    const day = shiftDayRange(new Date('2026-10-08T12:00:00Z'), sp, 0);
    const cells = hourGrid(day, sp);
    const byDate = new Map<string, number>();
    for (const c of cells) {
      const d = c.start.toISOString().slice(0, 10);
      byDate.set(d, (byDate.get(d) ?? 0) + 1);
    }
    expect(byDate.get('2026-10-08')).toBe(21); // locais 00..20 caem no dia UTC 08
    expect(byDate.get('2026-10-09')).toBe(3); // locais 21,22,23 = 00Z,01Z,02Z(09)
  });
});
