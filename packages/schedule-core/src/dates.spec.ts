import { describe, expect, it } from 'vitest';
import {
  localTimeOfDayToUtcUtcDay,
  shiftDayRange,
  shiftWeekRange,
  userDayRange,
  userMonthRange,
  userNextMonthRange,
  userNextWeekRange,
  userNextYearRange,
  userWeekRange,
  userWeekendRange,
  userYearRange,
  utcToZonedParts,
  zonedTimeToUtc,
} from './dates';

const minus3 = -3 * 60;

describe('conversoes calendar local <-> UTC (offset fixo, ADR-001)', () => {
  it('zonedTimeToUtc empurra o horario local para UTC', () => {
    // quinta 14:00 local (-03:00) => 17:00 UTC
    const utc = zonedTimeToUtc({ year: 2026, month: 10, day: 8, hour: 14, minute: 0 }, minus3);
    expect(utc.toISOString()).toBe('2026-10-08T17:00:00.000Z');
  });

  it('utcToZonedParts faz o caminho inverso', () => {
    const parts = utcToZonedParts(new Date('2026-10-08T17:00:00Z'), minus3);
    expect(parts).toEqual({ year: 2026, month: 10, day: 8, hour: 14, minute: 0, second: 0 });
  });

  it('roundtrip idempotente', () => {
    const original = { year: 2026, month: 12, day: 31, hour: 23, minute: 30, second: 15 };
    const back = utcToZonedParts(zonedTimeToUtc(original, minus3), minus3);
    expect(back).toEqual(original);
  });

  it('meia-noite local em offset negativo cai no dia anterior UTC', () => {
    const utc = zonedTimeToUtc({ year: 2026, month: 10, day: 6, hour: 0, minute: 0 }, minus3);
    expect(utc.toISOString()).toBe('2026-10-06T03:00:00.000Z');
  });
});

describe('janelas do calendario do usuario', () => {
  const instant = new Date('2026-10-05T22:00:00Z'); // 19:00 local de 05/10

  it('userDayRange cobre o dia civil', () => {
    const { start, end } = userDayRange(instant, minus3);
    expect(start.toISOString()).toBe('2026-10-05T03:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-06T03:00:00.000Z');
  });

  it('userWeekRange comeca na segunda 00:00 local', () => {
    const { start, end } = userWeekRange(instant, minus3); // 05/10/2026 = segunda
    expect(start.toISOString()).toBe('2026-10-05T03:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-12T03:00:00.000Z');
  });

  it('userWeekRange com domingo a noite volta para a segunda anterior', () => {
    const sundayNight = new Date('2026-10-11T23:00:00Z'); // 20:00 local de domingo 11/10
    const { start } = userWeekRange(sundayNight, minus3);
    expect(start.toISOString()).toBe('2026-10-05T03:00:00.000Z');
  });

  it('localTimeOfDayToUtcUtcDay resolve "07:00 no timezone do usuario"', () => {
    const at = localTimeOfDayToUtcUtcDay(instant, minus3, '07:00');
    expect(at.toISOString()).toBe('2026-10-05T10:00:00.000Z');
  });
});

/**
 * Janelas relativas dos simbolos de consulta (Fase 2, spec 6/7). Base do Gherkin da
 * spec: America/Sao_Paulo (-180), agora = qua 07/10/2026 08:00 local (11:00Z).
 * Tudo meio-aberto, meia-noite LOCAL nas bordas.
 */
describe('janelas de consulta (Fase 2) — offset -180, qua 07/10/2026 08:00 local', () => {
  const now = new Date('2026-10-07T11:00:00Z'); // 08:00 local de 07/10
  const sp = -180;

  it('shiftDayRange: "amanha" e "depois de amanha" (meia-noite local nas bordas)', () => {
    expect(shiftDayRange(now, sp, 1).start.toISOString()).toBe('2026-10-08T03:00:00.000Z');
    expect(shiftDayRange(now, sp, 1).end.toISOString()).toBe('2026-10-09T03:00:00.000Z');
    expect(shiftDayRange(now, sp, 2).start.toISOString()).toBe('2026-10-09T03:00:00.000Z');
    expect(shiftDayRange(now, sp, 2).end.toISOString()).toBe('2026-10-10T03:00:00.000Z');
  });

  it('shiftDayRange: transborda mes (28/10 + 2 => 30/10) e ano (31/12 + 1 => 01/01 ano+1)', () => {
    const endOfMonth = new Date('2026-10-28T12:00:00Z'); // 09:00 local de 28/10 (quarta)
    expect(shiftDayRange(endOfMonth, sp, 2).start.toISOString()).toBe('2026-10-30T03:00:00.000Z');

    const newYearsEve = new Date('2026-12-31T15:00:00Z'); // 12:00 local de 31/12/2026
    expect(shiftDayRange(newYearsEve, sp, 1).start.toISOString()).toBe('2027-01-01T03:00:00.000Z');
    expect(shiftDayRange(newYearsEve, sp, 1).end.toISOString()).toBe('2027-01-02T03:00:00.000Z');
  });

  it('shiftDayRange: offset positivo (Lisboa +60) tambem resolve no dia civil local', () => {
    const lisboa = new Date('2026-10-07T09:00:00Z'); // 10:00 local de 07/10
    expect(shiftDayRange(lisboa, 60, 1).start.toISOString()).toBe('2026-10-07T23:00:00.000Z'); // 08/10 00:00 local
    expect(shiftDayRange(lisboa, 60, -1).start.toISOString()).toBe('2026-10-05T23:00:00.000Z'); // 06/10 00:00 local
  });

  it('userNextWeekRange: semana civil que vem [seg 12/10 00:00, seg 19/10 00:00) local', () => {
    const { start, end } = userNextWeekRange(now, sp);
    expect(start.toISOString()).toBe('2026-10-12T03:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-19T03:00:00.000Z');
  });

  it('shiftWeekRange(0) = semana corrente; (1) = userNextWeekRange (Fase 5 — web)', () => {
    const current = userWeekRange(now, sp);
    const zero = shiftWeekRange(now, sp, 0);
    expect(zero).toEqual(current);
    expect(shiftWeekRange(now, sp, 1)).toEqual(userNextWeekRange(now, sp));
    expect(zero.start.toISOString()).toBe('2026-10-05T03:00:00.000Z'); // seg 05/10 00:00 local
  });

  it('shiftWeekRange(-1) volta para a semana anterior [seg 28/09, seg 05/10) local', () => {
    const { start, end } = shiftWeekRange(now, sp, -1);
    expect(start.toISOString()).toBe('2026-09-28T03:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-05T03:00:00.000Z');
  });

  it('shiftWeekRange a partir de DOMINGO continua na mesma semana deslocada (semana civil)', () => {
    const sunday = new Date('2026-10-11T11:00:00Z'); // 08:00 local de domingo 11/10
    // +1 semana a partir do domingo 11/10 => semana de 12/10..18/10
    expect(shiftWeekRange(sunday, sp, 1).start.toISOString()).toBe('2026-10-12T03:00:00.000Z');
    expect(shiftWeekRange(sunday, sp, -1).start.toISOString()).toBe('2026-09-28T03:00:00.000Z');
  });

  it('shiftWeekRange cruza mês (out -> set e out -> nov) e ano (dez/2026 -> jan/2027)', () => {
    // qui 01/10/2026 08:00 local: semana = [seg 28/09, seg 05/10); -1 => [21/09, 28/09)
    const firstOct = new Date('2026-10-01T11:00:00Z');
    expect(shiftWeekRange(firstOct, sp, -1).start.toISOString()).toBe('2026-09-21T03:00:00.000Z');
    expect(shiftWeekRange(firstOct, sp, 5).start.toISOString()).toBe('2026-11-02T03:00:00.000Z'); // cruza outubro -> novembro

    // qui 31/12/2026 08:00 local: +1 semana cruza o ANO => [seg 04/01/2027, ...
    const newYearsEveWeek = new Date('2026-12-31T11:00:00Z');
    expect(shiftWeekRange(newYearsEveWeek, sp, 1).start.toISOString()).toBe('2027-01-04T03:00:00.000Z');
    // ...e -1 semana volta para a anterior do mesmo ano [seg 21/12, seg 28/12)
    expect(shiftWeekRange(newYearsEveWeek, sp, -1).start.toISOString()).toBe('2026-12-21T03:00:00.000Z');
  });

  it('shiftWeekRange: duração fixa de 7 dias half-open em qualquer deslocamento', () => {
    for (const shift of [-3, -1, 0, 1, 4]) {
      const { start, end } = shiftWeekRange(now, sp, shift);
      expect(end.getTime() - start.getTime()).toBe(7 * 24 * 60 * 60_000);
    }
  });

  it('userMonthRange: "este mes" [01/10 00:00, 01/11 00:00) local', () => {
    const { start, end } = userMonthRange(now, sp);
    expect(start.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-01T03:00:00.000Z');
  });

  it('userNextMonthRange: "mes que vem" [01/11 00:00, 01/12 00:00) local', () => {
    const { start, end } = userNextMonthRange(now, sp);
    expect(start.toISOString()).toBe('2026-11-01T03:00:00.000Z');
    expect(end.toISOString()).toBe('2026-12-01T03:00:00.000Z');
  });

  it('userNextMonthRange: transborda o ano (dez/2026 => jan..fev/2027)', () => {
    const december = new Date('2026-12-15T12:00:00Z'); // 09:00 local de 15/12
    const { start, end } = userNextMonthRange(december, sp);
    expect(start.toISOString()).toBe('2027-01-01T03:00:00.000Z');
    expect(end.toISOString()).toBe('2027-02-01T03:00:00.000Z');
  });

  it('userYearRange: "este ano" [01/01/2026 00:00, 01/01/2027 00:00) local', () => {
    const { start, end } = userYearRange(now, sp);
    expect(start.toISOString()).toBe('2026-01-01T03:00:00.000Z');
    expect(end.toISOString()).toBe('2027-01-01T03:00:00.000Z');
  });

  it('userNextYearRange: "ano que vem" [01/01/2027 00:00, 01/01/2028 00:00) local', () => {
    const { start, end } = userNextYearRange(now, sp);
    expect(start.toISOString()).toBe('2027-01-01T03:00:00.000Z');
    expect(end.toISOString()).toBe('2028-01-01T03:00:00.000Z');
  });

  it('userWeekendRange: qui 08/10 => [sab 10/10 00:00, seg 12/10 00:00) local', () => {
    const thursday = new Date('2026-10-08T11:00:00Z');
    const { start, end } = userWeekendRange(thursday, sp);
    expect(start.toISOString()).toBe('2026-10-10T03:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-12T03:00:00.000Z');
  });

  it('userWeekendRange: sabado mesmo dia e domingo => fim de semana corrente', () => {
    const saturday = new Date('2026-10-10T04:00:00Z'); // 01:00 local de sabado
    const sunday = new Date('2026-10-11T11:00:00Z'); // 08:00 local de domingo
    expect(userWeekendRange(saturday, sp).start.toISOString()).toBe('2026-10-10T03:00:00.000Z');
    // domingo ainda pertence ao fim de semana corrente: [sab 10/10, seg 12/10)
    expect(userWeekendRange(sunday, sp).start.toISOString()).toBe('2026-10-10T03:00:00.000Z');
    expect(userWeekendRange(sunday, sp).end.toISOString()).toBe('2026-10-12T03:00:00.000Z');
  });

  it('userWeekendRange: transborda mes (dom 31/10 => [sab 31/10, seg 02/11)', () => {
    const sunday = new Date('2026-10-31T11:00:00Z'); // 08:00 local de domingo 31/10
    const { start, end } = userWeekendRange(sunday, sp);
    expect(start.toISOString()).toBe('2026-10-31T03:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-02T03:00:00.000Z');
  });
});

/**
 * DST norte-americano (offset fixo -150 = EDT, regra do repo ADR-002): as janelas
 * continuam ancoradas na MEIA-NOITE LOCAL de cada dia. Como o offset e fixo, a
 * meia-noite local fica sempre a 24h da anterior — o teste garante que nenhum
 * "24h cegas" escondeu um bug de calendario.
 */
describe('janelas de consulta — offset -150 (DST norte-americano)', () => {
  const us = -150;
  const wed = new Date('2026-03-11T14:00:00Z'); // 09:00 local de qua 11/03/2026 (sobe DST em 08/03)

  it('shiftDayRange: amanha e depois de amanha ancorados na meia-noite local', () => {
    expect(shiftDayRange(wed, us, 1).start.toISOString()).toBe('2026-03-12T02:30:00.000Z');
    expect(shiftDayRange(wed, us, 1).end.toISOString()).toBe('2026-03-13T02:30:00.000Z');
    expect(shiftDayRange(wed, us, 2).start.toISOString()).toBe('2026-03-13T02:30:00.000Z');
  });

  it('userNextWeekRange: [seg 16/03, seg 23/03) local', () => {
    const { start, end } = userNextWeekRange(wed, us);
    expect(start.toISOString()).toBe('2026-03-16T02:30:00.000Z');
    expect(end.toISOString()).toBe('2026-03-23T02:30:00.000Z');
  });

  it('userMonthRange: [01/03 00:00, 01/04 00:00) local', () => {
    const { start, end } = userMonthRange(wed, us);
    expect(start.toISOString()).toBe('2026-03-01T02:30:00.000Z');
    expect(end.toISOString()).toBe('2026-04-01T02:30:00.000Z');
  });

  it('userYearRange: [01/01/2026 00:00, 01/01/2027 00:00) local', () => {
    const { start, end } = userYearRange(wed, us);
    expect(start.toISOString()).toBe('2026-01-01T02:30:00.000Z');
    expect(end.toISOString()).toBe('2027-01-01T02:30:00.000Z');
  });
});
