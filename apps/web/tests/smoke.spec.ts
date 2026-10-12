import { describe, expect, it } from 'vitest';
import { cn } from '../src/app/utils/cn';
import { qk } from '../src/app/config/queryKeys';

describe('cn (classes Tailwind)', () => {
  it('mescla conflito de utilitarios (last wins)', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });

  it('aceita falsy', () => {
    expect(cn('p-2', false, undefined)).toBe('p-2');
  });
});

describe('queryKeys', () => {
  it('appointments carrega o intervalo na chave (fonte "me" por omissão — etapa 5)', () => {
    expect(qk.appointments('2026-10-01', '2026-11-01')).toEqual([
      'appointments',
      'me',
      '2026-10-01',
      '2026-11-01',
    ]);
  });

  it('appointments separa a agenda emprestada pelo dono (C.17 — cache por dono)', () => {
    const owner = '9f9a5b0a-0000-4000-8000-000000000001';
    expect(qk.appointments('2026-10-01', '2026-11-01', owner)).toEqual([
      'appointments',
      owner,
      '2026-10-01',
      '2026-11-01',
    ]);
    // dono ≠ "me": chaves nunca colidem (trocar de fonte não lê a lista errada)
    expect(qk.appointments('2026-10-01', '2026-11-01', owner)).not.toEqual(
      qk.appointments('2026-10-01', '2026-11-01'),
    );
  });
});
