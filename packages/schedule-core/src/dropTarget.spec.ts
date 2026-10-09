import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  dropOffsetMs,
  dropTargetFromKey,
  dropTargetRange,
  MONTH_TARGET,
  localDateKey,
  translateAppointmentRange,
} from './dropTarget';

/**
 * dropTarget (plano grades-dia-semana-mes, Etapa 2.2 — ADR-0014): o drop diz só o
 * DESLOCAMENTO; o novo intervalo é o antigo transladado (duração preservada) — a
 * web nunca recalcula duração nem data. Regra pura, offset injetável, datas UTC
 * (ADR-002). Âncora dos testes: qui 08/10/2026 SP (offset −180).
 */

function range(start: string, end: string) {
  return { startsAt: new Date(start), endsAt: new Date(end) };
}

describe('dropOffsetMs — deslocamento do início da célula sobre o início do item', () => {
  it('célula de hora cheia: diferença em ms entre inícios', () => {
    const cell = { start: new Date('2026-10-08T21:00:00.000Z'), end: new Date('2026-10-08T22:00:00.000Z') };
    expect(dropOffsetMs(cell, new Date('2026-10-08T14:00:00.000Z'))).toBe(7 * 3_600_000);
  });

  it('célula-destino anterior ao item: deslocamento negativo', () => {
    const cell = { start: new Date('2026-10-08T12:00:00.000Z'), end: new Date('2026-10-08T13:00:00.000Z') };
    expect(dropOffsetMs(cell, new Date('2026-10-08T14:00:00.000Z'))).toBe(-2 * 3_600_000);
  });

  it('célula de origem: offset zero (drop na origem é no-op)', () => {
    const cell = { start: new Date('2026-10-08T14:00:00.000Z'), end: new Date('2026-10-08T15:00:00.000Z') };
    expect(dropOffsetMs(cell, new Date('2026-10-08T14:00:00.000Z'))).toBe(0);
  });
});

describe('translateAppointmentRange — transladação preserva a duração', () => {
  it('deslocamento positivo preserva a duração exata', () => {
    const moved = translateAppointmentRange(
      range('2026-10-08T14:00:00.000Z', '2026-10-08T15:30:00.000Z'),
      4 * 3_600_000,
    );
    expect(moved.startsAt.toISOString()).toBe('2026-10-08T18:00:00.000Z');
    expect(moved.endsAt.toISOString()).toBe('2026-10-08T19:30:00.000Z');
    expect(moved.endsAt.getTime() - moved.startsAt.getTime()).toBe(90 * 60_000);
  });

  it('deslocamento negativo preserva a duração', () => {
    const moved = translateAppointmentRange(
      range('2026-10-08T14:00:00.000Z', '2026-10-08T15:00:00.000Z'),
      -3 * 3_600_000,
    );
    expect(moved.startsAt.toISOString()).toBe('2026-10-08T11:00:00.000Z');
    expect(moved.endsAt.toISOString()).toBe('2026-10-08T12:00:00.000Z');
  });

  it('drop que ATRAVESSA A MEIA-NOITE mantém a duração (23:00–00:30 local → +4h)', () => {
    // 23:00 SP = 02:00Z(dia 9); +4h cruza a meia-noite local (03:00Z)
    const moved = translateAppointmentRange(
      range('2026-10-09T02:00:00.000Z', '2026-10-09T03:30:00.000Z'),
      4 * 3_600_000,
    );
    expect(moved.startsAt.toISOString()).toBe('2026-10-09T06:00:00.000Z');
    expect(moved.endsAt.toISOString()).toBe('2026-10-09T07:30:00.000Z');
    expect(moved.endsAt.getTime() - moved.startsAt.getTime()).toBe(90 * 60_000);
  });

  it('offset de DIAS INTEIROS (Mês/Semana) preserva a hora local', () => {
    // 11:00 SP (14:00Z) → +1 dia exato: continua 11:00 SP do dia seguinte
    const moved = translateAppointmentRange(
      range('2026-10-08T14:00:00.000Z', '2026-10-08T15:00:00.000Z'),
      DAY_MS,
    );
    expect(moved.startsAt.toISOString()).toBe('2026-10-09T14:00:00.000Z');
    expect(moved.endsAt.toISOString()).toBe('2026-10-09T15:00:00.000Z');
  });
});

describe('localDateKey — dataKey local com offset injetável (borda do drop no Mês)', () => {
  it('meia-noite local em offset negativo é o DIA CIVIL correto (03:00Z −180 = dia 8)', () => {
    expect(localDateKey(new Date('2026-10-08T03:00:00.000Z'), -180)).toBe('2026-10-08');
    // 02:59:59Z ainda é dia 7 local (meia-noite local só às 03:00Z)
    expect(localDateKey(new Date('2026-10-08T02:59:59.000Z'), -180)).toBe('2026-10-07');
  });

  it('offset positivo empurra o dia UTC para TRÁS (18:00Z +330 = 23:30 local do dia 8)', () => {
    expect(localDateKey(new Date('2026-10-08T18:00:00.000Z'), 330)).toBe('2026-10-08');
    // 18:30Z +330 = 00:00 local do dia 9 (virada do dia civil)
    expect(localDateKey(new Date('2026-10-08T18:30:00.000Z'), 330)).toBe('2026-10-09');
  });

  it('offset zero é o próprio dia UTC', () => {
    expect(localDateKey(new Date('2026-10-08T23:30:00.000Z'), 0)).toBe('2026-10-08');
  });
});

describe('dropTargetFromKey — parse da chave estável da célula (data-cell-key)', () => {
  it('célula de HORA (Dia): "hour:<ISO>" carrega o início UTC da célula', () => {
    expect(dropTargetFromKey('hour:2026-10-08T21:00:00.000Z')).toEqual({
      kind: 'hour',
      cellStartUtc: new Date('2026-10-08T21:00:00.000Z'),
    });
  });

  it('célula-dia (Mês/Semana): "day:YYYY-MM-DD" carrega o dateKey (NUNCA um instante)', () => {
    expect(dropTargetFromKey('day:2026-10-14')).toEqual({ kind: 'day', dateKey: '2026-10-14' });
  });

  it('chave desconhecida/lixo → null (a UI cancela o drop)', () => {
    expect(dropTargetFromKey('week:2026-10')).toBeNull();
    expect(dropTargetFromKey('')).toBeNull();
    expect(dropTargetFromKey('hour:not-a-date')).toBeNull();
    expect(dropTargetFromKey('day:2026-13-99')).toBeNull();
  });
});

describe('dropTargetRange — o novo intervalo a partir do alvo (Etapa 2.2)', () => {
  // item 08/10 11:00–12:30 SP (14:00Z–15:30Z), offset −180
  const item = range('2026-10-08T14:00:00.000Z', '2026-10-08T15:30:00.000Z');
  const off = -180;

  it('alvo HOUR: translada para o início da célula de hora (mesma duração)', () => {
    const r = dropTargetRange({ kind: 'hour', cellStartUtc: new Date('2026-10-08T21:00:00.000Z') }, item, off);
    expect(r.startsAt.toISOString()).toBe('2026-10-08T21:00:00.000Z'); // 18:00 SP
    expect(r.endsAt.toISOString()).toBe('2026-10-08T22:30:00.000Z'); // 19:30 SP
  });

  it('alvo DAY: muda SÓ A DATA preservando a HORA LOCAL (não o instante!)', () => {
    const r = dropTargetRange({ kind: 'day', dateKey: '2026-10-14' }, item, off);
    // 11:00 SP em 14/10 = 14:00Z (offset −180 não muda na data de teste)
    expect(r.startsAt.toISOString()).toBe('2026-10-14T14:00:00.000Z');
    expect(r.endsAt.toISOString()).toBe('2026-10-14T15:30:00.000Z');
    expect(r.endsAt.getTime() - r.startsAt.getTime()).toBe(90 * 60_000);
  });

  it('alvo DAY igual ao dia atual do item: mesma duração, offset zero (no-op)', () => {
    const r = dropTargetRange({ kind: 'day', dateKey: '2026-10-08' }, item, off);
    expect(r.startsAt.toISOString()).toBe(item.startsAt.toISOString());
    expect(r.endsAt.toISOString()).toBe(item.endsAt.toISOString());
  });

  it('alvo DAY com TRAVESSIA DE MEIA-NOITE mantém a duração (23:00–00:30 SP p/ outro dia continua 23:00–00:30)', () => {
    // item 23:00–00:30 SP: 02:00Z do dia 9 AINDA É o dia CIVIL 08 local (a meia-noite
    // local de −03 cai às 03:00Z). Mover p/ o dia civil 12 = +4 dias locais; o FIM
    // continua atravessando a meia-noite do destino, e a duração é a mesma.
    const late = range('2026-10-09T02:00:00.000Z', '2026-10-09T03:30:00.000Z');
    expect(localDateKey(late.startsAt, off)).toBe('2026-10-08');
    const r = dropTargetRange({ kind: 'day', dateKey: '2026-10-12' }, late, off);
    // dia civil de INÍCIO é 08 → 12 = +4 dias LOCAIS; em −03:00 meia-noite local é
    // 03:00Z, então 23:00 local do dia civil 12 = instante 13T02:00Z. A HORA LOCAL é
    // preservada (23:00) — o que o usuário vê; o instante UTC "anda" com o dia civil.
    expect(r.startsAt.toISOString()).toBe('2026-10-13T02:00:00.000Z');
    expect(localDateKey(r.startsAt, off)).toBe('2026-10-12');
    expect(r.endsAt.toISOString()).toBe('2026-10-13T03:30:00.000Z');
    expect(localDateKey(r.endsAt, off)).toBe('2026-10-13'); // 00:30 — atravessa a meia-noite
    expect(r.endsAt.getTime() - r.startsAt.getTime()).toBe(90 * 60_000);
  });
});

describe('MONTH_TARGET — sentinela do alvo-dia (drop no Mês)', () => {
  it('é NaN: dropOffsetMs em alvo-dia produz offset inválido (a web NUNCA translada dias por ms)', () => {
    expect(Number.isNaN(MONTH_TARGET)).toBe(true);
    const moved = translateAppointmentRange(item08(), MONTH_TARGET);
    expect(Number.isNaN(moved.startsAt.getTime())).toBe(true);
  });
});

function item08() {
  return range('2026-10-08T14:00:00.000Z', '2026-10-08T15:00:00.000Z');
}
