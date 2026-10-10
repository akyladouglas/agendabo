import { describe, expect, it } from 'vitest';
import { localEndOfDayUtc } from '../src/app/utils/dateFilter';

/**
 * Borda de filtro "até o dia X" (página Admin): o dia civil do USUÁRIO precisa
 * virar o último instante dele em UTC. São Paulo (UTC-3): 23:59:59.999 local
 * = 02:59:59.999Z do dia seguinte.
 */
describe('localEndOfDayUtc', () => {
  it('America/Sao_Paulo: 23:59:59.999 local vira 02:59:59.999Z (dia seguinte)', () => {
    expect(localEndOfDayUtc('2026-10-09', 'America/Sao_Paulo')).toBe(
      '2026-10-10T02:59:59.999Z',
    );
  });

  it('UTC: 23:59:59.999Z do próprio dia', () => {
    expect(localEndOfDayUtc('2026-10-09', 'UTC')).toBe('2026-10-09T23:59:59.999Z');
  });

  it('dia de DST em SP (verão não existe desde 2019 — offsets estáveis -3)', () => {
    // regressão silenciosa: se o fuso mudar de offset, o filtro corta eventos
    // da noite fora da janela — as duas pontas do ano batem em -3.
    expect(localEndOfDayUtc('2026-02-12', 'America/Sao_Paulo')).toBe(
      '2026-02-13T02:59:59.999Z',
    );
    expect(localEndOfDayUtc('2026-07-12', 'America/Sao_Paulo')).toBe(
      '2026-07-13T02:59:59.999Z',
    );
  });
});
