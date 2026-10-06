import { describe, expect, it } from 'vitest';
import {
  localTimeOfDayToUtcUtcDay,
  userDayRange,
  userWeekRange,
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
