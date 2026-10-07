import { describe, expect, it } from 'vitest';
import {
  extrairLembreteSchema,
  extrairLembreteTool,
  normalizeLembreteToolUseInput,
} from './extrairLembrete';

/**
 * Testes de parse da saida do LLM (testing.md nº 2): payload valido, campo faltando
 * (→ re-pergunta na borda), confianca baixa/fora da faixa (→ re-pergunta, ADR-003) e
 * campo extra (→ ignorado, strip — gotcha 4). O limiar em si e do servico.
 */
describe('extrairLembreteSchema', () => {
  it('1) payload valido parseia (multi-regra: 3 dias + 1h — spec regra 3)', () => {
    const parsed = extrairLembreteSchema.safeParse({
      regras: [
        { type: 'before_days', value: 3 },
        { type: 'before_hours', value: 1 },
      ],
      confidence: 0.9,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.regras).toHaveLength(2);
  });

  it('2) campo faltando => falha (confidence obrigatoria — ADR-003; regra sem type idem)', () => {
    expect(extrairLembreteSchema.safeParse({ regras: [{ type: 'none' }] }).success).toBe(false);
    expect(
      extrairLembreteSchema.safeParse({
        regras: [{ type: 'before_hours' }], // value e exigido pelo notificationRuleInputSchema
        confidence: 0.9,
      }).success,
    ).toBe(false);
    expect(extrairLembreteSchema.safeParse({ confidence: 0.9 }).success).toBe(false);
  });

  it('3) confianca fora de 0..1 => falha (vira parse/re-pergunta na borda)', () => {
    expect(
      extrairLembreteSchema.safeParse({ regras: [{ type: 'none' }], confidence: 1.5 }).success,
    ).toBe(false);
    expect(
      extrairLembreteSchema.safeParse({ regras: [{ type: 'none' }], confidence: -0.1 }).success,
    ).toBe(false);
  });

  it('4) campo extra e ignorado (strip, NAO strict — gotcha 4)', () => {
    const parsed = extrairLembreteSchema.safeParse({
      regras: [{ type: 'countdown_3_2_1' }],
      confidence: 0.8,
      motivo: 'contagem explicita',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual({
      regras: [{ type: 'countdown_3_2_1' }],
      confidence: 0.8,
    });
  });

  it('none sozinha vale; none + outra regra => falha (contrato do zod persistido)', () => {
    expect(
      extrairLembreteSchema.safeParse({ regras: [{ type: 'none' }], confidence: 0.9 }).success,
    ).toBe(true);
    expect(
      extrairLembreteSchema.safeParse({
        regras: [{ type: 'none' }, { type: 'before_hours', value: 1 }],
        confidence: 0.9,
      }).success,
    ).toBe(false);
  });

  it('array vazio ou type fora do enum => falha', () => {
    expect(extrairLembreteSchema.safeParse({ regras: [], confidence: 0.9 }).success).toBe(false);
    expect(
      extrairLembreteSchema.safeParse({ regras: [{ type: 'telepatia' }], confidence: 0.9 }).success,
    ).toBe(false);
  });

  it('normalize canoniza `rules` plano p/ `regras` e passa o payload pelo zod', () => {
    const normalized = normalizeLembreteToolUseInput({
      rules: [{ type: 'before_days', value: 1 }],
      confidence: 0.95,
    });
    const parsed = extrairLembreteSchema.safeParse(normalized);
    expect(parsed.success).toBe(true);
    // `regras` presente tem prioridade; entrada nao-objeto passa intacta
    expect(normalizeLembreteToolUseInput(null)).toBe(null);
  });

  it('tool espelha o zod: required nos dois campos, enum completo no type', () => {
    expect(extrairLembreteTool.input_schema.required).toEqual(['regras', 'confidence']);
    const item = extrairLembreteTool.input_schema.properties.regras.items as {
      properties: { type: { enum: string[] } };
      required: string[];
    };
    expect(item.properties.type.enum).toEqual([
      'none',
      'before_hours',
      'before_days',
      'countdown_3_2_1',
    ]);
    expect(item.required).toEqual(['type']);
    // sem strict (gotcha 4)
    expect(
      (extrairLembreteTool.input_schema as Record<string, unknown>)['additionalProperties'],
    ).toBeUndefined();
  });
});
