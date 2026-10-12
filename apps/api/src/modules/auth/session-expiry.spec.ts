import { describe, expect, it } from 'vitest';
import { computeSessionExpiry } from './session-expiry';

/**
 * Teto absoluto de 24h da cadeia de refresh (spec sessão-24h, decisão humana nº 1).
 * `now`/`loginAt`/TTLs entram por parâmetro (testing.md: regra de data com tempo
 * injetável). O TTL deslizante de 30d continua existindo — mas NUNCA ultrapassa
 * o teto; perto dele o expiresAt é EXATAMENTE o cap (asserção do Gherkin).
 */

const loginAt = new Date('2026-10-11T09:00:00Z');
const H = 3_600_000;
const D = 24 * H;

const input = (nowIso: string, absoluteTtlMs = 24 * H, refreshTtlMs = 30 * D) =>
  computeSessionExpiry({ now: new Date(nowIso), loginAt, absoluteTtlMs, refreshTtlMs });

describe('computeSessionExpiry — teto absoluto da cadeia', () => {
  it('dentro do teto com folga: expiresAt = now + refreshTtl (TTL de 30d intocado)', () => {
    // folga REAL exige teto > now+30d: teto de 45d (a "30 dias intocados" é o
    // caso de teto grande; com teto default de 24h o cap corta SEMPRE)
    const r = input('2026-10-11T10:00:00Z', 45 * D, 30 * D);
    expect(r.expired).toBe(false);
    expect(r.expiresAt).toEqual(new Date('2026-11-10T10:00:00Z'));
  });

  it('perto do teto: expiresAt EXATAMENTE o cap loginAt + 24h (min corta o refreshTtl)', () => {
    // now + 30d estouraria o teto (24h) em ~23h → o cap manda
    const r = input('2026-10-11T23:30:00Z');
    expect(r.expired).toBe(false);
    expect(r.expiresAt).toEqual(new Date('2026-10-12T09:00:00Z'));
  });

  it('now EXATAMENTE no cap: expired (a cadeia morre no instante do teto)', () => {
    const r = input('2026-10-12T09:00:00Z');
    expect(r.expired).toBe(true);
  });

  it('now apos o cap: expired', () => {
    const r = input('2026-10-12T09:00:00.001Z');
    expect(r.expired).toBe(true);
  });

  it('TTLs configuraveis: teto de 1h vence refreshTtl de 30d', () => {
    const r = input('2026-10-11T09:30:00Z', 1 * H, 30 * D);
    expect(r.expired).toBe(false);
    expect(r.expiresAt).toEqual(new Date('2026-10-11T10:00:00Z')); // o cap
  });

  it('TTLs configuraveis: refreshTtl curto (30min) dentro de teto longo wins', () => {
    const r = input('2026-10-11T09:10:00Z', 24 * H, 30 * 60_000);
    expect(r.expired).toBe(false);
    expect(r.expiresAt).toEqual(new Date('2026-10-11T09:40:00Z')); // now + 30min
  });
});
