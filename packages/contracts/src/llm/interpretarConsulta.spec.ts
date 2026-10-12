import { describe, expect, it } from 'vitest';
import { interpretarConsultaSchema, interpretarConsultaTool } from './interpretarConsulta';

/**
 * Testes de parse da saida do LLM (testing.md no 2) para a extensao de ALVO da
 * consulta (spec compartilhamento-agenda-par E.24, decisao D6 do plano):
 * `alvo`/`alvo_nome` opcionais no ramo `listar`, em modo STRIP (gotcha 4 — o
 * schema NAO e .strict; campo extra do modelo e descartado, nao derruba o
 * parse). Ausencia de alvo = agenda propria (regressao zero no fluxo atual).
 */

describe('interpretarConsultaSchema — alvo da consulta (E.24)', () => {
  it('1) payload sem alvo parseia IGUAL ao de antes (regressao zero)', () => {
    const parsed = interpretarConsultaSchema.safeParse({
      tipo: 'listar',
      simbolo: 'amanha',
      confidence: 0.9,
    });
    expect(parsed.success).toBe(true);
    const data = parsed.success ? (parsed.data as Record<string, unknown>) : null;
    expect(data?.simbolo).toBe('amanha');
    expect(data?.alvo).toBeUndefined();
    expect(data?.alvo_nome).toBeUndefined();
  });

  it('2) alvo=minha e alvo=compartilhada + alvo_nome parseiam', () => {
    expect(
      interpretarConsultaSchema.safeParse({
        tipo: 'listar',
        simbolo: 'hoje',
        alvo: 'minha',
        confidence: 0.9,
      }).success,
    ).toBe(true);
    const compartilhada = interpretarConsultaSchema.safeParse({
      tipo: 'listar',
      simbolo: 'amanha',
      alvo: 'compartilhada',
      alvo_nome: 'Fulano',
      confidence: 0.8,
    });
    expect(compartilhada.success).toBe(true);
    const data = compartilhada.success ? (compartilhada.data as Record<string, unknown>) : null;
    expect(data?.alvo).toBe('compartilhada');
    expect(data?.alvo_nome).toBe('Fulano');
  });

  it('3) alvo invalido (fora do enum) => rejeita', () => {
    expect(
      interpretarConsultaSchema.safeParse({
        tipo: 'listar',
        simbolo: 'hoje',
        alvo: 'do_chefe',
        confidence: 0.9,
      }).success,
    ).toBe(false);
  });

  it('4) alvo_nome vazio ou > 120 chars => rejeita', () => {
    expect(
      interpretarConsultaSchema.safeParse({
        tipo: 'listar',
        simbolo: 'hoje',
        alvo: 'compartilhada',
        alvo_nome: '',
        confidence: 0.9,
      }).success,
    ).toBe(false);
    expect(
      interpretarConsultaSchema.safeParse({
        tipo: 'listar',
        simbolo: 'hoje',
        alvo: 'compartilhada',
        alvo_nome: 'x'.repeat(121),
        confidence: 0.9,
      }).success,
    ).toBe(false);
    // 120 exato passa
    expect(
      interpretarConsultaSchema.safeParse({
        tipo: 'listar',
        simbolo: 'hoje',
        alvo: 'compartilhada',
        alvo_nome: 'x'.repeat(120),
        confidence: 0.9,
      }).success,
    ).toBe(true);
  });

  it('5) modo STRIP preservado (gotcha 4): campo extra do modelo e descartado, nao derruba', () => {
    const parsed = interpretarConsultaSchema.safeParse({
      tipo: 'listar',
      simbolo: 'hoje',
      alvo: 'compartilhada',
      alvo_nome: 'Fulano',
      confidence: 0.9,
      motivo: 'o modelo inventou um campo',
    });
    expect(parsed.success).toBe(true);
    const data = parsed.success ? (parsed.data as Record<string, unknown>) : null;
    expect(data?.motivo).toBeUndefined();
  });

  it('6) alvo no ramo fora_do_escopo e descartado (ramo nao o declara — strip)', () => {
    const parsed = interpretarConsultaSchema.safeParse({
      tipo: 'fora_do_escopo',
      alvo: 'compartilhada',
      confidence: 0.4,
    });
    expect(parsed.success).toBe(true);
    const data = parsed.success ? (parsed.data as Record<string, unknown>) : null;
    expect(data?.alvo).toBeUndefined();
  });
});

describe('interpretarConsultaTool — props do alvo na tool definition', () => {
  const props = interpretarConsultaTool.input_schema.properties as Record<string, unknown>;

  it('declara alvo (enum minha|compartilhada) e alvo_nome sem torna-los required (strip)', () => {
    expect(props.alvo).toMatchObject({ type: 'string', enum: ['minha', 'compartilhada'] });
    expect(typeof props.alvo_nome).toBe('object');
    expect(interpretarConsultaTool.input_schema.required).toEqual(['tipo', 'confidence']);
    // strict do Anthropic quebraria com opcionais — gotcha 4 (a tool nunca usa
    // additionalProperties:false).
    expect(
      (interpretarConsultaTool.input_schema as Record<string, unknown>).additionalProperties,
    ).toBeUndefined();
  });
});
