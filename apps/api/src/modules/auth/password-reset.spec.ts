import { describe, expect, it } from 'vitest';
import {
  evaluateResetQuota,
  resetTokenIsLive,
  MAX_RESETS_PER_WINDOW,
  RESET_TOKEN_TTL_MS,
  RESET_WINDOW_MS,
} from './password-reset';

/**
 * Quota do link de reset (spec esqueci-a-senha regra 4): 2 envios por janela
 * deslizante de 10min, TODA linha conta (sem o "original grátis" nem o
 * "expirado libera" do resend do cadastro). `now` injetado — testing.md.
 */

const now = new Date('2026-10-08T12:00:00Z');
const min = (m: number) => new Date(now.getTime() - m * 60_000);
const send = (m: number) => ({ sentAt: min(m) });

describe('evaluateResetQuota (2 envios / 10min, janela fixa)', () => {
  it('sem nenhum envio: liberado, os 2 disponíveis', () => {
    expect(evaluateResetQuota([], now)).toEqual({
      allowed: true,
      restantes: 2,
      retryInMs: null,
    });
  });

  it('1 envio na janela: sobra 1', () => {
    expect(evaluateResetQuota([send(4)], now)).toMatchObject({
      allowed: true,
      restantes: 1,
    });
  });

  it('2 envios na janela: bloqueado (a UI continua recebendo o 202 silencioso)', () => {
    const r = evaluateResetQuota([send(8), send(2)], now);
    // libera quando o envio MAIS ANTIGO (8min atrás) sair da janela: daqui a 2min
    expect(r).toEqual({ allowed: false, restantes: 0, retryInMs: 2 * 60_000 });
  });

  it('envio fora da janela (11min atrás) não conta para a quota', () => {
    expect(evaluateResetQuota([send(11), send(2)], now)).toMatchObject({
      allowed: true,
      restantes: 1,
    });
  });

  it('retryInMs aponta a saída do envio mais antigo da janela', () => {
    // envio de 9min59s atrás: sai da janela daqui a 1s
    const r = evaluateResetQuota(
      [{ sentAt: new Date(now.getTime() - (9 * 60 + 59) * 1000) }, send(1)],
      now,
    );
    expect(r.allowed).toBe(false);
    expect(r.retryInMs).toBe(1000);
  });

  it('exatamente na borda da janela (> windowStart): não conta', () => {
    // sentAt == agora - 10min NÃO está na janela (a contagem é estritamente maior)
    expect(evaluateResetQuota([send(10), send(2)], now)).toMatchObject({
      allowed: true,
      restantes: 1,
    });
  });

  it('constantes da spec: janela 10min, teto 2, TTL do link 1h', () => {
    expect(RESET_WINDOW_MS).toBe(10 * 60_000);
    expect(MAX_RESETS_PER_WINDOW).toBe(2);
    expect(RESET_TOKEN_TTL_MS).toBe(60 * 60_000);
  });

  it('janela e teto são parametrizáveis (reuso da contagem sem duplicar)', () => {
    const r = evaluateResetQuota([send(1), send(2)], now, 30 * 60_000, 4);
    expect(r).toMatchObject({ allowed: true, restantes: 2 });
  });
});

describe('resetTokenIsLive (TTL 1h, regra 6)', () => {
  it('expiresAt no futuro: vivo', () => {
    expect(resetTokenIsLive(new Date(now.getTime() + 1), now)).toBe(true);
  });

  it('expiresAt exatamente agora ou no passado: expirado (>= morre)', () => {
    expect(resetTokenIsLive(now, now)).toBe(false);
    expect(resetTokenIsLive(new Date(now.getTime() - 1), now)).toBe(false);
  });
});
