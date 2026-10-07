import { describe, expect, it } from 'vitest';
import { classifyIntentSchema, classifyIntentTool, INTENTS } from './classifyIntent';

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
    expect(classifyIntentTool.input_schema.properties.intent.enum).toEqual([...INTENTS]);
  });

  // ---------- Fase 4 (spec llm-avancado regra 9): intents novas ----------

  it('intents novas parseiam: editar_compromisso e cancelar_compromisso (Fase 4)', () => {
    expect(
      classifyIntentSchema.safeParse({ intent: 'editar_compromisso', confidence: 0.9 }).success,
    ).toBe(true);
    expect(
      classifyIntentSchema.safeParse({ intent: 'cancelar_compromisso', confidence: 0.85 }).success,
    ).toBe(true);
  });

  it('tool espelha o zod tambem para as intents novas (enum inclui as duas)', () => {
    const enumValues = classifyIntentTool.input_schema.properties.intent.enum as string[];
    expect(enumValues).toContain('editar_compromisso');
    expect(enumValues).toContain('cancelar_compromisso');
    expect(enumValues).toEqual([...INTENTS]);
  });
});
