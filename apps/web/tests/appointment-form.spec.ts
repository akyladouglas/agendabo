import { describe, expect, it } from 'vitest';
import type { AppointmentDto } from '@agendabo/contracts';
import {
  countRetroactiveTriggers,
  resolveRange,
  rulesFromDto,
  toDomainRule,
} from '../src/app/composables/useAppointmentForm.composable';

/**
 * Puros do formulário único (D4): o form NÃO decide conflito nem materializa
 * nada — só deriva UTC (borda) e CONTA gatilhos passados com a regra do domínio
 * (schedule-core). Datas fixas (testing.md).
 */
const TZ = 'America/Sao_Paulo';

describe('resolveRange (strings locais -> UTC)', () => {
  it('14:30 + 90min em SP = 17:30Z -> 19:00Z', () => {
    const r = resolveRange(
      { date: '2026-10-08', time: '14:30', durationMinutes: 90 },
      TZ,
    );
    expect(r?.startsAt.toISOString()).toBe('2026-10-08T17:30:00.000Z');
    expect(r?.endsAt.toISOString()).toBe('2026-10-08T19:00:00.000Z');
  });

  it('duração < 5min -> null', () => {
    expect(
      resolveRange({ date: '2026-10-08', time: '14:30', durationMinutes: 4 }, TZ),
    ).toBeNull();
  });

  it('data/hora vazias ou inválidas -> null', () => {
    expect(resolveRange({ date: '', time: '14:30', durationMinutes: 60 }, TZ)).toBeNull();
    expect(resolveRange({ date: '2026-10-08', time: '25:99', durationMinutes: 60 }, TZ)).toBeNull();
    expect(
      resolveRange({ date: 'ontem', time: '14:30', durationMinutes: 60 }, TZ),
    ).toBeNull();
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
