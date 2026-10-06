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
  it('appointments carrega o intervalo na chave', () => {
    expect(qk.appointments('2026-10-01', '2026-11-01')).toEqual([
      'appointments',
      '2026-10-01',
      '2026-11-01',
    ]);
  });
});
