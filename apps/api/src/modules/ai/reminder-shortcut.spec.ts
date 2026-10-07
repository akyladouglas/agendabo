import { describe, expect, it } from 'vitest';
import { resolveReminderShortcut } from './reminder-interpreter.service';

/**
 * Atalhos determinísticos do passo `lembrete` (Fase 3, spec regras 2–4 / D3 do plano):
 * rodam ANTES do LLM e nunca gastam token. Domínio puro — vitest (testing.md).
 */

describe('resolveReminderShortcut — atalhos dos botões', () => {
  it('negativas ("não", "sem lembrete", "nenhum") => [{none}] (spec regra 3/4)', () => {
    for (const t of ['não', 'nao', 'Não.', 'sem lembrete', 'nenhum', 'sem nada', 'deixa sem']) {
      expect(resolveReminderShortcut(t)).toEqual([{ type: 'none' }]);
    }
  });

  it('botão "24h antes" => before_days:1 (atalho = 1 dia, decisão #4 do plano)', () => {
    expect(resolveReminderShortcut('24h antes')).toEqual([{ type: 'before_days', value: 1 }]);
    expect(resolveReminderShortcut('24 horas antes')).toEqual([{ type: 'before_days', value: 1 }]);
  });

  it('"3 dias antes" => before_days:3 (literal, mesmo colidindo com before_hours:24)', () => {
    expect(resolveReminderShortcut('3 dias antes')).toEqual([{ type: 'before_days', value: 3 }]);
    expect(resolveReminderShortcut('três dias antes')).toEqual([{ type: 'before_days', value: 3 }]);
  });

  it('botão "3-2-1" => countdown_3_2_1 (sem value)', () => {
    expect(resolveReminderShortcut('3-2-1')).toEqual([{ type: 'countdown_3_2_1' }]);
    expect(resolveReminderShortcut('contagem regressiva')).toEqual([{ type: 'countdown_3_2_1' }]);
  });

  it('"2 horas antes" falado => before_hours:2 (horas pedem horas, spec regra 2)', () => {
    expect(resolveReminderShortcut('2 horas antes')).toEqual([{ type: 'before_hours', value: 2 }]);
    expect(resolveReminderShortcut('2h antes')).toEqual([{ type: 'before_hours', value: 2 }]);
    // exceção do atalho do botão: N=24 literal é 1 DIA, não 24 horas
    expect(resolveReminderShortcut('24 horas antes')).toEqual([{ type: 'before_days', value: 1 }]);
  });
});

describe('resolveReminderShortcut — composição e fala livre', () => {
  it('"X e Y" com ambos parseáveis => duas regras, ordem da fala (spec regra 1)', () => {
    expect(resolveReminderShortcut('3 dias antes e 1 hora antes')).toEqual([
      { type: 'before_days', value: 3 },
      { type: 'before_hours', value: 1 },
    ]);
    expect(resolveReminderShortcut('3-2-1 e 2h antes')).toEqual([
      { type: 'countdown_3_2_1' },
      { type: 'before_hours', value: 2 },
    ]);
  });

  it('duplicata exata colapsa (dedupe preservando ordem)', () => {
    expect(resolveReminderShortcut('1 dia antes e 1 dia antes')).toEqual([
      { type: 'before_days', value: 1 },
    ]);
  });

  it('fala livre / metade não-parseável => null (caso do LLM, spec regra 4)', () => {
    expect(resolveReminderShortcut('me avisa na véspera à tarde')).toBeNull();
    expect(resolveReminderShortcut('blablablá')).toBeNull();
    expect(resolveReminderShortcut('')).toBeNull();
    expect(resolveReminderShortcut('3 dias antes e quando der')).toBeNull();
    expect(resolveReminderShortcut('personalizado')).toBeNull(); // botão: abre fala livre
  });
});
