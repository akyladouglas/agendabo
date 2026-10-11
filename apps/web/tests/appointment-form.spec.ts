import { describe, expect, it } from 'vitest';
import type { AppointmentDto } from '@agendabo/contracts';
import {
  countRetroactiveTriggers,
  endFromStart,
  resolveRange,
  rulesFromDto,
  shiftEndToStart,
  toDomainRule,
} from '../src/app/composables/useAppointmentForm.composable';

/**
 * Puros do formulário único (D4): o form NÃO decide conflito nem materializa
 * nada — só deriva UTC (borda) e CONTA gatilhos passados com a regra do domínio
 * (schedule-core). Datas fixas (testing.md).
 */
const TZ = 'America/Sao_Paulo';

describe('resolveRange (início + fim locais -> UTC — spec notas-e-fim-na-web B)', () => {
  it('qua 10:00 → qui 12:30 em SP: instante multi-dia correto (26h30 depois)', () => {
    const r = resolveRange(
      { date: '2026-10-07', time: '10:00', endDate: '2026-10-08', endTime: '12:30' },
      TZ,
    );
    expect(r?.startsAt.toISOString()).toBe('2026-10-07T13:00:00.000Z');
    expect(r?.endsAt.toISOString()).toBe('2026-10-08T15:30:00.000Z');
    expect(
      Math.round((r!.endsAt.getTime() - r!.startsAt.getTime()) / 60_000),
    ).toBe(26 * 60 + 30);
  });

  it('fim em outro dia é LÍCITO (multi-dia sem cap): sáb 23:00 → seg 17:00 = 42h', () => {
    const r = resolveRange(
      { date: '2026-10-10', time: '23:00', endDate: '2026-10-12', endTime: '17:00' },
      TZ,
    );
    expect(r?.startsAt.toISOString()).toBe('2026-10-11T02:00:00.000Z');
    expect(r?.endsAt.toISOString()).toBe('2026-10-12T20:00:00.000Z');
    expect(
      Math.round((r!.endsAt.getTime() - r!.startsAt.getTime()) / 60_000),
    ).toBe(42 * 60);
  });

  it('fim igual ou anterior ao início -> null (erro inline "O fim precisa ser depois do início")', () => {
    expect(
      resolveRange({ date: '2026-10-08', time: '14:30', endDate: '2026-10-08', endTime: '14:30' }, TZ),
    ).toBeNull();
    expect(
      resolveRange({ date: '2026-10-08', time: '14:30', endDate: '2026-10-08', endTime: '14:00' }, TZ),
    ).toBeNull();
    // anterior em outro dia também
    expect(
      resolveRange({ date: '2026-10-08', time: '14:30', endDate: '2026-10-07', endTime: '23:00' }, TZ),
    ).toBeNull();
  });

  it('datas/horas vazias ou inválidas -> null', () => {
    expect(resolveRange({ date: '', time: '14:30', endDate: '2026-10-08', endTime: '15:30' }, TZ)).toBeNull();
    expect(resolveRange({ date: '2026-10-08', time: '25:99', endDate: '2026-10-08', endTime: '15:30' }, TZ)).toBeNull();
    expect(resolveRange({ date: 'ontem', time: '14:30', endDate: '2026-10-08', endTime: '15:30' }, TZ)).toBeNull();
    expect(resolveRange({ date: '2026-10-08', time: '14:30', endDate: '', endTime: '15:30' }, TZ)).toBeNull();
    expect(resolveRange({ date: '2026-10-08', time: '14:30', endDate: '2026-10-08', endTime: '' }, TZ)).toBeNull();
  });
});

describe('shiftEndToStart (início mudou -> fim desliza preservando a duração — spec B2)', () => {
  it('hora do início 23:00 -> 21:00 com fim seg 17:00: fim vira seg 15:00 (mesma duração)', () => {
    const shifted = shiftEndToStart(
      { date: '2026-10-10', time: '23:00' },
      { date: '2026-10-10', time: '21:00' },
      { endDate: '2026-10-12', endTime: '17:00' },
      TZ,
    );
    expect(shifted).toEqual({ endDate: '2026-10-12', endTime: '15:00' });
  });

  it('Gherkin B: início sáb 23:00 -> qua 23:00 no compromisso sáb→seg 17:00: fim vira sex 17:00 (dias acompanham, hora preservada)', () => {
    const shifted = shiftEndToStart(
      { date: '2026-10-10', time: '23:00' },
      { date: '2026-10-14', time: '23:00' },
      { endDate: '2026-10-12', endTime: '17:00' },
      TZ,
    );
    expect(shifted).toEqual({ endDate: '2026-10-16', endTime: '17:00' });
    // 16/10/2026 é sexta-feira
    expect(new Date(`${shifted!.endDate}T12:00:00Z`).getUTCDay()).toBe(5);
  });

  it('sem fim configurado (criação) -> null (o fim é derivado na exibição)', () => {
    expect(
      shiftEndToStart(
        { date: '2026-10-08', time: '10:00' },
        { date: '2026-10-08', time: '11:00' },
        { endDate: '', endTime: '' },
        TZ,
      ),
    ).toBeNull();
  });
});

describe('endFromStart (preset/instante -> strings locais do fim)', () => {
  it('17:00Z + 60min = fim 15:00 local (SP)', () => {
    expect(endFromStart(new Date('2026-10-08T17:00:00Z'), 60, TZ)).toEqual({
      endDate: '2026-10-08',
      endTime: '15:00',
    });
  });

  it('minutos inválidos -> null', () => {
    expect(endFromStart(new Date('2026-10-08T17:00:00Z'), 0, TZ)).toBeNull();
    expect(endFromStart(new Date('2026-10-08T17:00:00Z'), NaN, TZ)).toBeNull();
  });
});

describe('toDomainRule / rulesFromDto (chips <-> domínio)', () => {
  it('input -> regra do schedule-core', () => {
    expect(toDomainRule({ type: 'before_hours', value: 2 })).toEqual({
      type: 'before_hours',
      hours: 2,
    });
    expect(toDomainRule({ type: 'before_days', value: 3 })).toEqual({
      type: 'before_days',
      days: 3,
    });
    expect(toDomainRule({ type: 'countdown_3_2_1' })).toEqual({ type: 'countdown_3_2_1' });
    expect(toDomainRule({ type: 'none' })).toEqual({ type: 'none' });
  });

  it('DTO persistido -> chips editáveis (`none` sai fora)', () => {
    expect(rulesFromDto(undefined)).toEqual([]);
    expect(rulesFromDto([])).toEqual([]);
    expect(rulesFromDto([{ type: 'none', value: null }])).toEqual([]);
    expect(
      rulesFromDto([
        { type: 'before_hours', value: 24 },
        { type: 'countdown_3_2_1', value: null },
      ]),
    ).toEqual([
      { type: 'before_hours', value: 24 },
      { type: 'countdown_3_2_1', value: undefined },
    ]);
  });
});

describe('countRetroactiveTriggers (aviso da decisão 3 — conta, não decide)', () => {
  it('compromisso no passado com 1h antes: o único gatilho já passou -> 1', () => {
    expect(
      countRetroactiveTriggers(new Date('2020-01-01T12:00:00Z'), [{ type: 'before_hours', value: 1 }]),
    ).toBe(1);
  });

  it('contagem 3-2-1 de compromisso no passado -> 3 gatilhos perdidos', () => {
    expect(
      countRetroactiveTriggers(new Date('2020-01-01T12:00:00Z'), [{ type: 'countdown_3_2_1' }]),
    ).toBe(3);
  });

  it('compromisso distante (2030): nenhum gatilho perdido -> 0', () => {
    expect(
      countRetroactiveTriggers(new Date('2030-01-01T12:00:00Z'), [
        { type: 'before_hours', value: 1 },
        { type: 'countdown_3_2_1' },
      ]),
    ).toBe(0);
  });

  it('sem regras -> 0', () => {
    expect(countRetroactiveTriggers(new Date('2020-01-01T12:00:00Z'), [])).toBe(0);
  });
});

// AppointmentDto usado em outros specs (mantém o type-check do helper abaixo)
export type { AppointmentDto };
