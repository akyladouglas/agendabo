import { describe, expect, it } from 'vitest';
import {
  formatDayHeading,
  formatRangeInTz,
  formatWeekHeading,
  localDateTimeToUtc,
  measureTzOffset,
  toLocalDateString,
  toLocalTimeString,
} from '../src/app/utils/tz';

/**
 * Borda de fuso da web (ADR-002): medir offset + formatar. Datas fixas — o relógio
 * nunca entra em asserção (testing.md).
 */
const TZ = 'America/Sao_Paulo';

describe('measureTzOffset (Intl, mesmo algoritmo da API)', () => {
  it('-180 min fora do horário de verão (outubro)', () => {
    expect(measureTzOffset(TZ, new Date('2026-10-08T17:00:00Z'))).toBe(-180);
  });

  it('-180 min em janeiro também (Brasil sem DST desde 2019)', () => {
    expect(measureTzOffset(TZ, new Date('2026-01-08T17:00:00Z'))).toBe(-180);
  });

  it('zona com DST real (America/New_York): -240 jul, -300 jan', () => {
    expect(measureTzOffset('America/New_York', new Date('2026-07-08T17:00:00Z'))).toBe(-240);
    expect(measureTzOffset('America/New_York', new Date('2026-01-08T17:00:00Z'))).toBe(-300);
  });

  it('UTC é 0', () => {
    expect(measureTzOffset('UTC', new Date('2026-10-08T17:00:00Z'))).toBe(0);
  });
});

describe('localDateTimeToUtc (borda: string local -> instante UTC)', () => {
  it('"2026-10-08 14:30" em São Paulo = 17:30Z', () => {
    const utc = localDateTimeToUtc('2026-10-08', '14:30', TZ);
    expect(utc.toISOString()).toBe('2026-10-08T17:30:00.000Z');
  });

  it('zona com DST real: "2026-01-08 14:30" em Nova York = 19:30Z', () => {
    const utc = localDateTimeToUtc('2026-01-08', '14:30', 'America/New_York');
    expect(utc.toISOString()).toBe('2026-01-08T19:30:00.000Z');
  });

  it('round-trip: formatar o UTC devolve as strings locais de entrada', () => {
    const utc = localDateTimeToUtc('2026-07-15', '09:05', TZ);
    expect(toLocalDateString(utc, TZ)).toBe('2026-07-15');
    expect(toLocalTimeString(utc, TZ)).toBe('09:05');
  });

  it('meia-noite local cruzando o dia UTC (23:30Z do dia anterior -> 20:30 local)', () => {
    // 2026-10-08T23:30:00Z é ainda 20:30 do dia 08 em SP
    const d = new Date('2026-10-08T23:30:00Z');
    expect(toLocalDateString(d, TZ)).toBe('2026-10-08');
    expect(toLocalTimeString(d, TZ)).toBe('20:30');
  });
});

describe('formatRangeInTz (exibição)', () => {
  it('mesmo dia local: "14:00–15:00"', () => {
    const s = new Date('2026-10-08T17:00:00Z');
    const e = new Date('2026-10-08T18:00:00Z');
    expect(formatRangeInTz(s, e, TZ)).toBe('14:00–15:00');
  });

  it('fim vazando o dia local mostra o dia do fim', () => {
    const s = new Date('2026-10-08T23:00:00Z'); // 20:00 qui
    const e = new Date('2026-10-09T02:30:00Z'); // 23:30 qui mesmo dia
    expect(formatRangeInTz(s, e, TZ)).toContain('20:00');
    expect(formatRangeInTz(s, e, TZ)).toContain('23:30');
    // agora vazando para o dia seguinte local:
    const e2 = new Date('2026-10-09T03:30:00Z'); // 00:30 de sex
    const out = formatRangeInTz(s, e2, TZ);
    expect(out).toMatch(/sex/);
    expect(out).toContain('00:30');
  });
});

describe('formatDayHeading / formatWeekHeading (cabeçalhos)', () => {
  it('marca isToday quando o dia civil local é o de `today`', () => {
    const today = new Date('2026-10-08T17:00:00Z'); // 14:00 qui em SP
    const same = formatDayHeading(new Date('2026-10-08T02:00:00Z'), TZ, today); // 23:00 de qua? não: 08 02:00Z = 07 23:00
    expect(same.isToday).toBe(false);
    const hit = formatDayHeading(new Date('2026-10-08T12:00:00Z'), TZ, today);
    expect(hit.isToday).toBe(true);
    expect(hit.weekday).toBe('qui');
  });

  it('semana "5 – 11 out" (mesmo mês)', () => {
    const start = new Date('2026-10-05T03:00:00Z'); // seg 00:00 SP
    const endExclusive = new Date('2026-10-12T03:00:00Z');
    expect(formatWeekHeading(start, endExclusive, TZ)).toBe('5 – 11 out');
  });

  it('semana cruzando mês: "28 set – 4 out"', () => {
    const start = new Date('2026-09-28T03:00:00Z');
    const endExclusive = new Date('2026-10-05T03:00:00Z');
    const out = formatWeekHeading(start, endExclusive, TZ);
    expect(out).toContain('28');
    expect(out).toContain('set');
    expect(out).toContain('4');
    expect(out).toContain('out');
  });
});
