import { describe, expect, it } from 'vitest';
import { conflictedIds, firstConflictLabel, type Pairable } from './conflicts-pairs';

/**
 * Pares sobrepostos VISÍVEIS (spec calendario-visoes C.12): badge informativo da
 * grade. Datas fixas (testing.md). Meia-noite UTC = datas locais UTC (offset 0).
 */
function item(
  id: string,
  start: string,
  end: string,
  status: 'confirmed' | 'needs_review' = 'confirmed',
  title = id,
): Pairable {
  return { id, title, startsAt: new Date(start), endsAt: new Date(end), status };
}

describe('conflictedIds (pares confirmed sobrepostos)', () => {
  it('dois sobrepostos -> os dois ids; encostado NÃO entra', () => {
    const a = item('a', '2026-10-08T12:00:00Z', '2026-10-08T13:00:00Z');
    const b = item('b', '2026-10-08T12:30:00Z', '2026-10-08T13:30:00Z');
    const c = item('c', '2026-10-08T13:30:00Z', '2026-10-08T14:00:00Z'); // encosta em b (fim de b = início de c)
    expect(conflictedIds([a, b, c])).toEqual(new Set(['a', 'b']));
  });

  it('needs_review não entra no par (sinal próprio ⚠️)', () => {
    const a = item('a', '2026-10-08T12:00:00Z', '2026-10-08T13:00:00Z');
    const r = item('r', '2026-10-08T12:30:00Z', '2026-10-08T13:30:00Z', 'needs_review');
    expect(conflictedIds([a, r])).toEqual(new Set());
  });

  it('passado no período também marca (a grade pinta o período inteiro)', () => {
    const a = item('a', '2020-01-08T12:00:00Z', '2020-01-08T13:00:00Z');
    const b = item('b', '2020-01-08T12:30:00Z', '2020-01-08T13:30:00Z');
    expect(conflictedIds([a, b])).toEqual(new Set(['a', 'b']));
  });

  it('três em cadeia (a∩b, b∩c, a∩c não) -> todos os três', () => {
    const a = item('a', '2026-10-08T12:00:00Z', '2026-10-08T12:40:00Z');
    const b = item('b', '2026-10-08T12:20:00Z', '2026-10-08T13:00:00Z');
    const c = item('c', '2026-10-08T12:45:00Z', '2026-10-08T13:20:00Z');
    expect(conflictedIds([a, b, c])).toEqual(new Set(['a', 'b', 'c']));
  });

  it('conjunto vazio/único -> vazio', () => {
    expect(conflictedIds([])).toEqual(new Set());
    expect(conflictedIds([item('a', '2026-10-08T12:00:00Z', '2026-10-08T13:00:00Z')])).toEqual(
      new Set(),
    );
  });
});

describe('firstConflictLabel (rótulo acessível do par)', () => {
  const fmt = (s: Date, e: Date) => `${s.toISOString().slice(11, 16)}–${e.toISOString().slice(11, 16)}`;

  it('aponta o parceiro de início mais cedo e formata o range dele', () => {
    const a = item('a', '2026-10-08T09:00:00Z', '2026-10-08T10:00:00Z', 'confirmed', 'Dentista');
    const b = item('b', '2026-10-08T09:30:00Z', '2026-10-08T10:30:00Z', 'confirmed', 'Call');
    expect(firstConflictLabel(b, [a, b], fmt)).toBe('Choque com "Dentista" (09:00–10:00)');
    expect(firstConflictLabel(a, [a, b], fmt)).toBe('Choque com "Call" (09:30–10:30)');
  });

  it('sem par -> null; needs_review -> null', () => {
    const solo = item('s', '2026-10-08T12:00:00Z', '2026-10-08T13:00:00Z');
    expect(firstConflictLabel(solo, [solo], fmt)).toBeNull();
    const r = item('r', '2026-10-08T12:00:00Z', '2026-10-08T13:00:00Z', 'needs_review');
    const c = item('c', '2026-10-08T12:30:00Z', '2026-10-08T13:30:00Z');
    expect(firstConflictLabel(r, [r, c], fmt)).toBeNull();
  });
});
