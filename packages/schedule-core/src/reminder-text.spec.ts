import { describe, expect, it } from 'vitest';
import { describeLeadTime, ruleLabelPtBr, rulesLabelsPtBr } from './reminder-text';

/**
 * Rotulos de lembrete (Fase 3, spec regra 13): texto PT-BR deterministico com
 * `now` injetado (testing.md — data fixa, nunca `new Date()`).
 */

const NOW = new Date('2026-10-06T15:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('describeLeadTime', () => {
  it('disparo em <= 1min: "daqui a instantes"', () => {
    expect(describeLeadTime(new Date(NOW.getTime() + 30_000), NOW, 60)).toBe('daqui a instantes');
  });

  it('disparo em 40min (regra 1h antes): "daqui a 40 minutos"', () => {
    expect(describeLeadTime(new Date(NOW.getTime() + 40 * 60_000), NOW, 60)).toBe(
      'daqui a 40 minutos',
    );
  });

  it('disparo em 1h: "daqui a 1 hora" (singular — texto aprovado da spec)', () => {
    expect(describeLeadTime(new Date(NOW.getTime() + HOUR), NOW, 60)).toBe('daqui a 1 hora');
  });

  it('disparo em 5h: "daqui a 5 horas"', () => {
    expect(describeLeadTime(new Date(NOW.getTime() + 5 * HOUR), NOW, 5 * 60)).toBe(
      'daqui a 5 horas',
    );
  });

  it('gatilho de 1 dia (24h antes / 3-2-1): "amanhã"', () => {
    expect(describeLeadTime(new Date(NOW.getTime() + DAY), NOW, 24 * 60)).toBe('amanhã');
  });

  it('gatilho de 3 dias: "em 3 dias"', () => {
    expect(describeLeadTime(new Date(NOW.getTime() + 3 * DAY), NOW, 3 * 24 * 60)).toBe('em 3 dias');
  });

  it('antecedência com sobra de horas (25h antes): "em 1 dia e 1 hora"', () => {
    expect(describeLeadTime(new Date(NOW.getTime() + DAY + HOUR), NOW, 25 * 60)).toBe(
      'em 1 dia e 1 hora',
    );
  });

  it('36 horas de antecedência (não é dia inteiro): "em 36 horas"', () => {
    expect(describeLeadTime(new Date(NOW.getTime() + 36 * HOUR), NOW, 36 * 60)).toBe('em 36 horas');
  });
});

describe('ruleLabelPtBr / rulesLabelsPtBr', () => {
  it('rotulos por tipo de regra (resumo final ⏰)', () => {
    expect(ruleLabelPtBr({ type: 'none' })).toBeNull();
    expect(ruleLabelPtBr({ type: 'before_hours', hours: 1 })).toBe('1h antes');
    expect(ruleLabelPtBr({ type: 'before_days', days: 1 })).toBe('1 dia antes');
    expect(ruleLabelPtBr({ type: 'before_days', days: 3 })).toBe('3 dias antes');
    expect(ruleLabelPtBr({ type: 'countdown_3_2_1' })).toBe('contagem 3-2-1');
  });

  it('lista preserva ordem e descarta none', () => {
    expect(
      rulesLabelsPtBr([
        { type: 'before_days', days: 3 },
        { type: 'before_hours', hours: 1 },
      ]),
    ).toEqual(['3 dias antes', '1h antes']);
    expect(rulesLabelsPtBr([{ type: 'none' }])).toEqual([]);
  });
});
