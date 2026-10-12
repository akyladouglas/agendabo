import { describe, expect, it } from 'vitest';
import {
  evaluateInviteQuota,
  effectiveStatus,
  inviteIsLive,
  INVITE_TTL_MS,
  INVITE_WINDOW_MS,
  MAX_INVITES_PER_PAIR_PER_WINDOW,
} from './shared-invite';

/**
 * Regras puras do convite de compartilhamento (spec compartilhamento A.4/A.5,
 * decisoes D4/D12/D13 do plano). Espelho de `password-reset.spec.ts`: `now`
 * injetado, zero I/O — TDD obrigatorio pela regra de testing (quota/data).
 */

const now = new Date('2026-10-12T12:00:00Z');
const min = (m: number) => new Date(now.getTime() - m * 60_000);
const send = (m: number) => ({ sentAt: min(m) });

describe('constantes do convite (D12 — fixas na spec, sem env)', () => {
  it('TTL 24h, janela 30min, teto 3 por par ordenado', () => {
    expect(INVITE_TTL_MS).toBe(24 * 60 * 60_000);
    expect(INVITE_WINDOW_MS).toBe(30 * 60_000);
    expect(MAX_INVITES_PER_PAIR_PER_WINDOW).toBe(3);
  });
});

describe('evaluateInviteQuota (3 convites / 30min por par, D13)', () => {
  it('sem nenhum envio: liberado, os 3 disponiveis', () => {
    expect(evaluateInviteQuota([], now)).toEqual({
      allowed: true,
      restantes: 3,
      retryInMs: null,
    });
  });

  it('1 envio na janela: sobram 2', () => {
    expect(evaluateInviteQuota([send(10)], now)).toMatchObject({
      allowed: true,
      restantes: 2,
    });
  });

  it('2 envios na janela: sobra 1 (o 3o ainda passa)', () => {
    expect(evaluateInviteQuota([send(20), send(5)], now)).toMatchObject({
      allowed: true,
      restantes: 1,
    });
  });

  it('3 envios na janela: bloqueado (a resposta continua 202 silencioso — D5)', () => {
    const r = evaluateInviteQuota([send(25), send(15), send(5)], now);
    // libera quando o envio MAIS ANTIGO (25min atras) sair da janela: daqui a 5min
    expect(r).toEqual({ allowed: false, restantes: 0, retryInMs: 5 * 60_000 });
  });

  it('envio fora da janela (31min atras) nao conta — janela deslizante', () => {
    expect(evaluateInviteQuota([send(31), send(20), send(5)], now)).toMatchObject({
      allowed: true,
      restantes: 1,
    });
  });

  it('exatamente na borda da janela (> windowStart estrito): nao conta', () => {
    // sentAt == agora - 30min NAO esta na janela (igual evaluateResetQuota)
    expect(evaluateInviteQuota([send(30), send(20), send(5)], now)).toMatchObject({
      allowed: true,
      restantes: 1,
    });
  });

  it('retryInMs aponta a saida do envio mais antigo da janela', () => {
    // envio de 29min59s atras: sai da janela daqui a 1s
    const r = evaluateInviteQuota(
      [{ sentAt: new Date(now.getTime() - (29 * 60 + 59) * 1000) }, send(20), send(5)],
      now,
    );
    expect(r.allowed).toBe(false);
    expect(r.retryInMs).toBe(1000);
  });

  it('janela/teto parametrizaveis (mesma assinatura da irma do reset)', () => {
    const r = evaluateInviteQuota([send(5)], now, 6 * 60_000, 1);
    expect(r).toEqual({ allowed: false, restantes: 0, retryInMs: 60_000 });
  });
});

describe('inviteIsLive (D4 — expiracao checada NA HORA, sem cron)', () => {
  const live = { status: 'pending', inviteExpiresAt: new Date(now.getTime() + 1) };

  it('pending com inviteExpiresAt no futuro: vivo', () => {
    expect(inviteIsLive(live, now)).toBe(true);
  });

  it('exactly-now == morto (inviteExpiresAt > now estrito)', () => {
    expect(inviteIsLive({ status: 'pending', inviteExpiresAt: now }, now)).toBe(false);
  });

  it('pending expirado: morto', () => {
    expect(
      inviteIsLive({ status: 'pending', inviteExpiresAt: new Date(now.getTime() - 1) }, now),
    ).toBe(false);
  });

  it('pending sem inviteExpiresAt (dados inconsistentes): morto — so pending VIVA e viva', () => {
    expect(inviteIsLive({ status: 'pending', inviteExpiresAt: null }, now)).toBe(false);
  });

  it('active/revoked NUNCA sao "convite vivo" (token nao existe mais)', () => {
    expect(inviteIsLive({ status: 'active', inviteExpiresAt: null }, now)).toBe(false);
    expect(inviteIsLive({ status: 'revoked', inviteExpiresAt: null }, now)).toBe(false);
  });
});

describe('effectiveStatus (A.5 — pending morta = recusada em todo leitor)', () => {
  it('pending viva: pending', () => {
    expect(
      effectiveStatus(
        { status: 'pending', inviteExpiresAt: new Date(now.getTime() + 60_000) },
        now,
      ),
    ).toBe('pending');
  });

  it('pending MORTA (expirada ou exactly-now): vira revoked — recusa automatica sem cron', () => {
    expect(
      effectiveStatus({ status: 'pending', inviteExpiresAt: new Date(now.getTime() - 1) }, now),
    ).toBe('revoked');
    expect(effectiveStatus({ status: 'pending', inviteExpiresAt: now }, now)).toBe('revoked');
    expect(effectiveStatus({ status: 'pending', inviteExpiresAt: null }, now)).toBe('revoked');
  });

  it('active e revoked passam direto (independem de inviteExpiresAt)', () => {
    expect(effectiveStatus({ status: 'active', inviteExpiresAt: null }, now)).toBe('active');
    expect(effectiveStatus({ status: 'revoked', inviteExpiresAt: null }, now)).toBe('revoked');
    // active jamais e "rebaixado" por timestamp residual
    expect(
      effectiveStatus({ status: 'active', inviteExpiresAt: new Date(now.getTime() - 1) }, now),
    ).toBe('active');
  });
});
