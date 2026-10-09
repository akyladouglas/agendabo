import { describe, expect, it } from 'vitest';
import { MS_DAY, weekGridRows } from './hourGrid';
import { userDayRange, userWeekRange } from './dates';

/**
 * TDD (testing.md — data nasce com teste): a grade de horas da visão SEMANA
 * (7 colunas dom..sáb, uma grade por dia). Mesma base da visão Dia (`hourGrid`):
 * âncora = hora LOCAL do dia da COLUNA, `now` injetável, half-open.
 * Âncora: qui 08/10/2026 (SP, -180).
 */
const sp = -180;

describe('weekGridRows — grade de horas por dia (dom..sáb)', () => {
  it('query da web (userWeekRange): 7 dias dom..sáb com 24 células âncora-dia', () => {
    const anchor = new Date('2026-10-08T12:00:00Z'); // qui 08/10 SP
    const week = userWeekRange(anchor, sp); // seg 05 00:00 → seg 12 00:00
    const rows = weekGridRows(week, sp);

    expect(rows.map((r) => r.date)).toEqual([
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-10',
    ]);
    expect(rows.map((r) => r.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    for (const row of rows) {
      expect(row.cells).toHaveLength(24);
      // célula 00 = MEIA-NOITE LOCAL do dia da coluna (não da âncora)
      expect(row.cells[0]!.start.toISOString()).toBe(`${row.date}T03:00:00.000Z`);
      // célula 23 = 23:00 LOCAL do dia da coluna (meia-noite local + 23h, não
      // a hora UTC `date`T22 — gotcha de fuso com offset)
      expect(row.cells[23]!.start.toISOString()).toBe(
        new Date(new Date(`${row.date}T03:00:00.000Z`).getTime() + 23 * 3_600_000).toISOString(),
      );
      expect(row.cells[23]!.label).toBe('23:00');
      // meia-noite LOCAL do dia da coluna + 24h fecha EXATAMENTE a célula 23
      expect(row.cells[23]!.end.toISOString()).toBe(
        new Date(new Date(`${row.date}T03:00:00.000Z`).getTime() + 24 * 3_600_000).toISOString(),
      );
    }
  });

  it('dias sem now: nada é passado; com now, só as horas passadas DO próprio dia', () => {
    const anchor = new Date('2026-10-08T12:00:00Z');
    const week = userWeekRange(anchor, sp);
    const now = new Date('2026-10-08T16:30:00Z'); // 13:30 SP de qui
    const rows = weekGridRows(week, sp, now);

    const sun = rows.find((r) => r.date === '2026-10-04')!;
    const thu = rows.find((r) => r.date === '2026-10-08')!;
    const sat = rows.find((r) => r.date === '2026-10-10')!;
    expect(sun.cells.every((c) => c.isPast)).toBe(true); // domingo inteiro passou
    expect(sat.cells.every((c) => !c.isPast)).toBe(true); // sábado inteiro é futuro
    // qui: 09:00 SP já passou (fim da célula 10:00 < 13:30); 13:00 não (fim 14:00 > 13:30)
    expect(thu.cells[9]!.isPast).toBe(true);
    expect(thu.cells[13]!.isPast).toBe(false);
  });

  it('âncora em QUALQUER instante do dia (range de dia único) ancora a semana inteira', () => {
    const day = userDayRange(new Date('2026-10-08T12:00:00Z'), sp);
    const rows = weekGridRows(day, sp);
    expect(rows).toHaveLength(7);
    expect(rows[0]!.date).toBe('2026-10-04');
    expect(rows[6]!.date).toBe('2026-10-10');
  });

  it('âncora no DOMINGO à noite: a semana é a do próprio domingo (não salta p/ a seguinte)', () => {
    const sundayNight = new Date('2026-10-04T22:00:00Z'); // 19:00 SP de dom 04
    const rows = weekGridRows({ start: sundayNight, end: new Date(sundayNight.getTime() + MS_DAY) }, sp);
    expect(rows[0]!.date).toBe('2026-10-04');
    expect(rows[6]!.date).toBe('2026-10-10');
  });

  it('âncora na SEGUNDA 00:00 como ÂNCORA EXPLÍCITA: domingo = âncora − 1 dia', () => {
    const mondayMidnight = new Date('2026-10-05T03:00:00.000Z'); // seg 05 00:00 SP
    const rows = weekGridRows(
      { start: mondayMidnight, end: new Date(mondayMidnight.getTime() + MS_DAY) },
      sp,
      undefined,
      undefined,
      0,
      mondayMidnight,
    );
    expect(rows[0]!.date).toBe('2026-10-04');
    expect(rows[1]!.date).toBe('2026-10-05');
  });

  it('a query (range) NUNCA ancora a grade: âncora qui com query seg→seg é a semana do qui', () => {
    // regressão: a query da Semana começa na SEGUNDA 00:00; se a função ancorar
    // nela (instante com offset != 0 "scorre" p/ o dia anterior), a grade sai na
    // semana errada. A âncora explícita (o dia focado) é a verdade da UI.
    const anchor = new Date('2026-10-08T03:00:00.000Z'); // qui 08 00:00 SP
    const week = userWeekRange(anchor, sp); // seg 05 03:00Z → seg 12 03:00Z
    const rows = weekGridRows(week, sp, undefined, undefined, 0, anchor);
    expect(rows[0]!.date).toBe('2026-10-04');
    expect(rows[6]!.date).toBe('2026-10-10');
  });

  it('meia-noites injetadas COM TRANSIÇÃO: cada linha usa o offset da PRÓPRIA meia-noite', () => {
    // fuso com offset -180 no início da query e um dia (qua 07) em -150: a
    // página injeta a meia-noite REAL de cada dia (Intl). A linha do dia de
    // transição deve nascer na meia-noite INJETADA e a grade usar o offset
    // DELA — senão o dia de transição sai 30min deslocado.
    const mondayMidnight = new Date('2026-10-05T03:00:00.000Z'); // offset do range -180
    const midnights = (d: number) => {
      // d = dias desde o DIA CIVIL da âncora (seg 05), como o contrato da função
      const dayUtc = new Date(Date.UTC(2026, 9, 5 + d));
      const off = dayUtc.getUTCDate() === 7 ? -150 : -180;
      return new Date(dayUtc.getTime() - off * 60_000);
    };
    const rows = weekGridRows(
      { start: mondayMidnight, end: new Date(mondayMidnight.getTime() + 24 * 3_600_000) },
      sp,
      undefined,
      midnights,
      30,
    );
    const wed = rows.find((r) => r.date === '2026-10-07')!;
    expect(wed.start.toISOString()).toBe('2026-10-07T02:30:00.000Z'); // -150
    expect(wed.cells[0]!.label).toBe('00:00');
    // 23:00 local em -150 = 01:30Z do dia 08
    expect(wed.cells[23]!.start.toISOString()).toBe('2026-10-08T01:30:00.000Z');
    expect(wed.cells).toHaveLength(24);
    // dias vizinhos seguem o offset do range
    expect(rows.find((r) => r.date === '2026-10-05')!.start.toISOString()).toBe('2026-10-05T03:00:00.000Z');
    expect(rows.find((r) => r.date === '2026-10-10')!.start.toISOString()).toBe('2026-10-10T03:00:00.000Z');
  });

  it('DST: dia em offset −150 tem 24 células e atravessa o fim do dia em UTC (não é 23)', () => {
    // fijo −150 (meia-noite local = 02:30Z no modelo de offset ÚNICO por período,
    // E.6): o dia faz 24 células independentemente da transição, meia-noite local
    // em 02:30Z e fim exatamente 24h depois.
    const us = -150;
    const day = userDayRange(new Date('2026-03-08T12:00:00Z'), us);
    const rows = weekGridRows(day, us);
    const sat = rows.find((r) => r.date === '2026-03-08')!;
    expect(sat.cells).toHaveLength(24);
    expect(sat.cells[0]!.start.toISOString()).toBe('2026-03-08T02:30:00.000Z');
    expect(sat.cells[23]!.end.toISOString()).toBe('2026-03-09T02:30:00.000Z');
  });
});
