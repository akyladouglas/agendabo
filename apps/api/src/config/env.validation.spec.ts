import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.validation';

/**
 * Envelope mínimo de env obrigatória para os casos abaixo (o resto é default do zod).
 */
const base = {
  DATABASE_URL: 'postgresql://x',
  REDIS_URL: 'redis://x',
  JWT_SECRET: 'secret-de-teste-1234567890',
  EVENTS_HASH_SECRET: 'salt-de-teste-1234567890',
  LLM_PRICE_INPUT_USD_PER_MTOK: '1000000',
  LLM_PRICE_OUTPUT_USD_PER_MTOK: '5000000',
};

/**
 * SESSION_ABSOLUTE_TTL_HOURS (spec sessão-24h, decisão humana nº 1): opcional com
 * default 24 — o Gherkin "Dado env ausente Então o default é 24" vive aqui.
 */
describe('env SESSION_ABSOLUTE_TTL_HOURS', () => {
  it('ausente: default 24', () => {
    expect(validateEnv({ ...base }).SESSION_ABSOLUTE_TTL_HOURS).toBe(24);
  });

  it("string do .env é coagida: '12' vira o número 12", () => {
    expect(
      validateEnv({ ...base, SESSION_ABSOLUTE_TTL_HOURS: '12' }).SESSION_ABSOLUTE_TTL_HOURS,
    ).toBe(12);
  });

  it('0 rejeita (teto zero mataria toda sessão no login — positive)', () => {
    expect(() => validateEnv({ ...base, SESSION_ABSOLUTE_TTL_HOURS: '0' })).toThrow();
  });

  it('não-inteiro rejeita', () => {
    expect(() => validateEnv({ ...base, SESSION_ABSOLUTE_TTL_HOURS: '2.5' })).toThrow();
  });
});
