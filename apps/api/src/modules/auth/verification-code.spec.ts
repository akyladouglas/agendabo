import { describe, expect, it } from 'vitest';
import { evaluateResendQuota, generateNumericCode } from './verification-code';

const now = new Date('2026-10-05T12:00:00Z');
const min = (m: number) => new Date(now.getTime() - m * 60_000);

describe('evaluateResendQuota (3 reenvios / 30min)', () => {
  it('permite reenvio com janela vazia', () => {
    expect(evaluateResendQuota([], now).allowed).toBe(true);
  });

  it('1o envio da janela e o original: sobram 3 reenvios', () => {
    const r = evaluateResendQuota([min(5)], now);
    expect(r).toMatchObject({ allowed: true, reenviosRestantes: 3 });
  });

  it('consumi os 3 reenvios e bloqueio', () => {
    // original (28min atras, na janela) + 3 reenvios
    const r = evaluateResendQuota([min(28), min(20), min(10), min(5)], now);
    expect(r).toEqual({ allowed: false, reenviosRestantes: 0, retryInMs: 2 * 60_000 });
  });

  it('envio fora da janela (31min atras) libera quota', () => {
    const r = evaluateResendQuota([min(31), min(25), min(20), min(15)], now);
    expect(r.allowed).toBe(true);
    expect(r.reenviosRestantes).toBe(1);
  });

  it('retryInMs aponta a saida do envio mais antigo da janela', () => {
    const r = evaluateResendQuota([min(29), min(28), min(27), min(26)], now);
    expect(r.allowed).toBe(false);
    expect(r.retryInMs).toBe(60_000);
  });
});

describe('generateNumericCode', () => {
  it('gera 6 digitos', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateNumericCode()).toMatch(/^\d{6}$/);
    }
  });
});
