import { describe, expect, it } from 'vitest';
import { signupInputSchema } from './auth';
import { updateProfileInputSchema, updateProfileResultSchema } from './user';

describe('updateProfileInputSchema (PATCH /me — Fase 5)', () => {
  it('aceita patch parcial de cada campo', () => {
    expect(updateProfileInputSchema.parse({ resumoDiarioHora: '08:15' })).toEqual({
      resumoDiarioHora: '08:15',
    });
    expect(updateProfileInputSchema.parse({ name: 'Ana' })).toEqual({ name: 'Ana' });
    expect(updateProfileInputSchema.parse({ resumoDiarioAtivo: false })).toEqual({
      resumoDiarioAtivo: false,
    });
    expect(updateProfileInputSchema.parse({ timezone: 'America/Sao_Paulo' })).toEqual({
      timezone: 'America/Sao_Paulo',
    });
  });

  it('timezone inválida é bloqueada pelo zod (critério Gherkin do perfil)', () => {
    // Mars/Ohm passa no regex genérico do timezoneSchema (defesa da borda), mas
    // Intl rejeita: a web valida contra a tz database no form E o PATCH /me real
    // falharia ao gravar um fuso inexistente. O zod sozinho só pega formatos
    // quebrados, e é isso que este teste garante.
    expect(() => updateProfileInputSchema.parse({ timezone: 'Sao Paulo' })).toThrow();
    expect(updateProfileInputSchema.parse({ timezone: 'America/Sao_Paulo' }).timezone).toBe(
      'America/Sao_Paulo',
    );
  });

  it('hora fora de HH:mm é bloqueada', () => {
    expect(() => updateProfileInputSchema.parse({ resumoDiarioHora: '8:15' })).toThrow();
  });

  it('objeto vazio (nenhum campo) é rejeitado', () => {
    expect(() => updateProfileInputSchema.parse({})).toThrow();
  });

  it('name em branco colapsa para undefined (limpar nome passa como patch válido? não: vazio é rejeitado)', () => {
    // '' vira undefined (optionalText) e o patch fica sem campos => refine pega.
    expect(() => updateProfileInputSchema.parse({ name: '   ' })).toThrow();
    expect(updateProfileInputSchema.parse({ name: ' Ana ', resumoDiarioAtivo: true })).toEqual({
      name: 'Ana',
      resumoDiarioAtivo: true,
    });
  });
});

describe('updateProfileResultSchema', () => {
  it('valida o shape de sessão retornado pelo PATCH /me', () => {
    const parsed = updateProfileResultSchema.parse({
      id: '3f0f1e2c-1111-4aaa-8bbb-ccccdddd0001',
      email: 'ana@example.com',
      name: 'Ana',
      timezone: 'America/Sao_Paulo',
      resumoDiarioHora: '08:15',
      resumoDiarioAtivo: false,
      isAdmin: false,
    });
    expect(parsed.name).toBe('Ana');
  });

  it('name null (conta antiga) é aceito', () => {
    expect(() =>
      updateProfileResultSchema.parse({
        id: '3f0f1e2c-1111-4aaa-8bbb-ccccdddd0001',
        email: 'ana@example.com',
        name: null,
        timezone: 'Etc/UTC',
        resumoDiarioHora: '07:00',
        resumoDiarioAtivo: true,
        isAdmin: false,
      }),
    ).not.toThrow();
  });
});

describe('signupInputSchema.name (decisão 7)', () => {
  const base = {
    email: 'ana@example.com',
    password: 'senha-forte-123',
    telegramId: '123456789',
  };

  it('name é opcional (contas sem nome continuam válidas)', () => {
    expect(signupInputSchema.parse(base).name).toBeUndefined();
  });

  it('name é aparado quando enviado', () => {
    expect(signupInputSchema.parse({ ...base, name: '  Ana  ' }).name).toBe('Ana');
  });
});
