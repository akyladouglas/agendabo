import { describe, expect, it } from 'vitest';
import {
  interpretarEdicaoSchema,
  interpretarEdicaoTool,
  normalizeEdicaoToolUseInput,
} from './interpretarEdicao';

/**
 * Testes de parse da saida do LLM (testing.md nº 2): valido, campo faltando,
 * confianca fora da faixa e campo extra (strip — gotcha 4). O limiar de confianca
 * em si e do servico (AppointmentEditInterpreterService), nao do schema.
 */
describe('interpretarEdicaoSchema', () => {
  it('payload valido de edicao com horario novo parseia', () => {
    const parsed = interpretarEdicaoSchema.safeParse({
      acao: 'editar',
      descricao: 'a reunião',
      novoInicio: '2026-10-09T16:00:00-03:00',
      novaDuracaoMin: 60,
      evidence: 'pra sexta 16h',
      confidence: 0.9,
    });
    expect(parsed.success).toBe(true);
  });

  it('payload valido de cancelar com alvoData parseia', () => {
    const parsed = interpretarEdicaoSchema.safeParse({
      acao: 'cancelar',
      descricao: 'consulta',
      alvoData: { simbolo: 'esta_semana' },
      confidence: 0.85,
    });
    expect(parsed.success).toBe(true);
  });

  it('payload valido de deslocamento ("adianta 1 hora") parseia', () => {
    const parsed = interpretarEdicaoSchema.safeParse({
      acao: 'editar',
      descricao: 'reunião',
      deslocamentoMin: -60,
      confidence: 0.9,
    });
    expect(parsed.success).toBe(true);
  });

  it('acao fora do enum => falha (vira parse na borda)', () => {
    expect(interpretarEdicaoSchema.safeParse({ acao: 'clonar', confidence: 0.9 }).success).toBe(
      false,
    );
  });

  it('campo faltando => falha (confidence e obrigatoria — ADR-003)', () => {
    expect(interpretarEdicaoSchema.safeParse({ acao: 'editar' }).success).toBe(false);
    expect(interpretarEdicaoSchema.safeParse({ confidence: 0.9 }).success).toBe(false);
  });

  it('confianca fora de 0..1 => falha', () => {
    expect(
      interpretarEdicaoSchema.safeParse({ acao: 'editar', confidence: 1.5 }).success,
    ).toBe(false);
    expect(
      interpretarEdicaoSchema.safeParse({ acao: 'editar', confidence: -0.1 }).success,
    ).toBe(false);
  });

  it('novoInicio sem offset => falha (a borda precisa do offset p/ validar contra o tz)', () => {
    expect(
      interpretarEdicaoSchema.safeParse({
        acao: 'editar',
        novoInicio: '2026-10-09T16:00:00',
        confidence: 0.9,
      }).success,
    ).toBe(false);
  });

  it('deslocamentoMin fora do intervalo plausivel => falha', () => {
    expect(
      interpretarEdicaoSchema.safeParse({ acao: 'editar', deslocamentoMin: 9999, confidence: 0.9 })
        .success,
    ).toBe(false);
  });

  it('campo extra e ignorado (strip, NAO strict — gotcha 4)', () => {
    const parsed = interpretarEdicaoSchema.safeParse({
      acao: 'cancelar',
      descricao: 'consulta',
      confidence: 0.8,
      motivo: 'pedido explicito',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.motivo).toBeUndefined();
  });

  it('tool espelha o zod: acao/confidence obrigatorias, sem additionalProperties: false', () => {
    expect(interpretarEdicaoTool.input_schema.required).toEqual(['acao', 'confidence']);
    expect(interpretarEdicaoTool.input_schema.properties.acao.enum).toEqual(['editar', 'cancelar']);
    expect((interpretarEdicaoTool as { additionalProperties?: unknown }).additionalProperties).toBeUndefined();
    expect(
      (interpretarEdicaoTool.input_schema as { additionalProperties?: unknown }).additionalProperties,
    ).toBeUndefined();
  });
});

describe('normalizeEdicaoToolUseInput', () => {
  it('payload plano ({simbolo}) e canonizado p/ alvoData aninhado', () => {
    const out = normalizeEdicaoToolUseInput({
      acao: 'cancelar',
      descricao: 'consulta',
      simbolo: 'esta_semana',
      confidence: 0.9,
    }) as Record<string, unknown>;
    expect(out.alvoData).toEqual({ simbolo: 'esta_semana' });
    expect(out.simbolo).toBeUndefined();
  });

  it('alvoData aninhado passa intacto (prioridade sobre flat)', () => {
    const raw = {
      acao: 'editar',
      alvoData: { from: '2026-10-08', to: '2026-10-09' },
      simbolo: 'hoje',
      confidence: 0.9,
    };
    expect(normalizeEdicaoToolUseInput(raw)).toBe(raw);
  });

  it('sem quando nenhum: sem alvoData inventado', () => {
    const out = normalizeEdicaoToolUseInput({ acao: 'editar', confidence: 0.9 }) as Record<
      string,
      unknown
    >;
    expect(out.alvoData).toBeUndefined();
  });

  it('nao-objeto passa sem tocamento', () => {
    expect(normalizeEdicaoToolUseInput(null)).toBe(null);
    expect(normalizeEdicaoToolUseInput('x')).toBe('x');
  });
});
