import { describe, expect, it } from 'vitest';
import { classifyIntentSchema, classifyIntentTool } from './classifyIntent';

/**
 * Testes de parse da saida do LLM (testing.md nº 2): valido, campo faltando,
 * confianca fora da faixa e campo extra (strip — gotcha 4). O limiar de confianca
 * em si e do servico (intent-classifier.service.spec.ts), nao do schema.
 */
describe('classifyIntentSchema', () => {
  it('payload valido parseia', () => {
    const parsed = classifyIntentSchema.safeParse({ intent: 'criar', confidence: 0.9 });
    expect(parsed.success).toBe(true);
  });

  it('intent fora do enum => falha (vira parse na borda)', () => {
    expect(
      classifyIntentSchema.safeParse({ intent: 'telepatia', confidence: 0.9 }).success,
    ).toBe(false);
  });

  it('campo faltando => falha (confidence e obrigatoria — ADR-003)', () => {
    expect(classifyIntentSchema.safeParse({ intent: 'criar' }).success).toBe(false);
    expect(classifyIntentSchema.safeParse({ confidence: 0.9 }).success).toBe(false);
  });

  it('confianca fora de 0..1 => falha', () => {
    expect(classifyIntentSchema.safeParse({ intent: 'criar', confidence: 1.5 }).success).toBe(false);
    expect(classifyIntentSchema.safeParse({ intent: 'criar', confidence: -0.1 }).success).toBe(false);
  });

  it('campo extra e ignorado (strip, NAO strict — gotcha 4)', () => {
    const parsed = classifyIntentSchema.safeParse({
      intent: 'cancelar',
      confidence: 0.8,
      motivo: 'desistencia explicita',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual({ intent: 'cancelar', confidence: 0.8 });
  });

  it('tool espelha o zod: enum completo e required nos dois campos', () => {
    expect(classifyIntentTool.input_schema.required).toEqual(['intent', 'confidence']);
    expect(classifyIntentTool.input_schema.properties.intent.enum).toEqual([
      'criar',
      'cancelar',
      'continuar_fluxo',
      'remarcar',
      'substituir_atual',
      'fora_do_escopo',
    ]);
  });
});
