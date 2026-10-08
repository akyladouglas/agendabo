import { describe, expect, it } from 'vitest';
import { evaluateResendQuota, generateNumericCode } from './verification-code';

const now = new Date('2026-10-05T12:00:00Z');
const min = (m: number) => new Date(now.getTime() - m * 60_000);
/** Envio ha `m` minutos: codigo fica ativo por 15min, entao `active` a partir de agora. */
const send = (m: number, active = m <= 15) => ({
  sentAt: min(m),
  expiresAt: active ? new Date(now.getTime() + 60_000) : min(m - 15),
  usedAt: null,
});

describe('evaluateResendQuota (3 reenvios / 30min)', () => {
  it('sem codigo ativo (nada enviado): liberado, marcado como expirado', () => {
    expect(evaluateResendQuota([], now).allowed).toBe(true);
  });

  it('1o envio da janela e o original: sobram 3 reenvios', () => {
    const r = evaluateResendQuota([send(5)], now);
    expect(r).toMatchObject({
      allowed: true,
      reenviosRestantes: 3,
      expired: false,
    });
  });

  it('consumi os 3 reenvios e bloqueio', () => {
    // original (28min atras, expirado, porem na janela) + 3 reenvios ativos
    const r = evaluateResendQuota([send(28), send(20), send(10), send(5)], now);
    expect(r).toEqual({
      allowed: false,
      reenviosRestantes: 0,
      expired: false,
      retryInMs: 2 * 60_000,
    });
  });

  it('envio fora da janela (31min atras) nao conta para a quota', () => {
    // original ha 31min (fora da janela) + 3 envios na janela => 1 sobrando
    const r = evaluateResendQuota([send(31), send(25), send(10), send(5)], now);
    expect(r.allowed).toBe(true);
    expect(r.reenviosRestantes).toBe(1);
  });

  it('retryInMs aponta a saida do envio mais antigo da janela', () => {
    // original ha 20min (expirado, porem na janela) + 3 reenvios => libera so qdo
    // o envio de 29min atras sair da janela (daqui a 1min)
    const r = evaluateResendQuota([send(29), send(28), send(27), send(20, true)], now);
    expect(r.allowed).toBe(false);
    expect(r.retryInMs).toBe(60_000);
  });

  it('codigo expirado: reenvio SEMPRE liberado (conta pendente nao fica presa)', () => {
    // 4 envios ha 20-40min, todos vencidos (TTL 15min) — quota nao bloqueia
    const r = evaluateResendQuota([send(40), send(35), send(25), send(20)], now);
    expect(r).toMatchObject({ allowed: true, expired: true });
  });
});

describe('generateNumericCode', () => {
  it('gera 6 digitos', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateNumericCode()).toMatch(/^\d{6}$/);
    }
  });
});
