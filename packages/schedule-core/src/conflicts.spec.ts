import { describe, expect, it } from 'vitest';
import { findConflict, overlaps } from './conflicts';
import type { AppointmentLike } from './types';

const now = new Date('2026-10-05T12:00:00Z');

function appt(id: string, start: string, end: string, title = `appt ${id}`): AppointmentLike {
  return { id, title, startsAt: new Date(start), endsAt: new Date(end) };
}

const A = appt('a', '2026-10-06T14:00:00Z', '2026-10-06T15:00:00Z');

describe('overlaps (half-open [start, end))', () => {
  it('mesma hora conflita', () => {
    expect(
      overlaps(
        { startsAt: new Date('2026-10-06T14:00:00Z'), endsAt: new Date('2026-10-06T15:00:00Z') },
        A,
      ),
    ).toBe(true);
  });

  it('sobreposicao parcial dos dois lados conflita', () => {
    expect(
      overlaps(
        { startsAt: new Date('2026-10-06T13:30:00Z'), endsAt: new Date('2026-10-06T14:30:00Z') },
        A,
      ),
    ).toBe(true);
    expect(
      overlaps(
        { startsAt: new Date('2026-10-06T14:30:00Z'), endsAt: new Date('2026-10-06T15:30:00Z') },
        A,
      ),
    ).toBe(true);
  });

  it('encostado (fim === inicio) NAO conflita', () => {
    const before = { startsAt: new Date('2026-10-06T13:00:00Z'), endsAt: new Date('2026-10-06T14:00:00Z') };
    const after = { startsAt: new Date('2026-10-06T15:00:00Z'), endsAt: new Date('2026-10-06T16:00:00Z') };
    expect(overlaps(before, A)).toBe(false);
    expect(overlaps(after, A)).toBe(false);
  });
});

describe('findConflict', () => {
  it('acha o compromisso que choca e classifica same_start', () => {
    const result = findConflict(
      { startsAt: new Date('2026-10-06T14:00:00Z'), endsAt: new Date('2026-10-06T14:45:00Z') },
      [appt('x', '2026-10-06T09:00:00Z', '2026-10-06T10:00:00Z', 'daily'), A],
      { now },
    );
    expect(result.conflict).toBe(true);
    expect(result.with?.id).toBe('a');
    expect(result.with?.title).toBe('appt a');
    expect(result.reason).toBe('same_start');
  });

  it('classifica contido/contem/parcial', () => {
    const cls = (s: string, e: string) =>
      findConflict({ startsAt: new Date(s), endsAt: new Date(e) }, [A], { now }).reason;
    expect(cls('2026-10-06T14:10:00Z', '2026-10-06T14:50:00Z')).toBe('contained');
    expect(cls('2026-10-06T13:00:00Z', '2026-10-06T16:00:00Z')).toBe('contains');
    expect(cls('2026-10-06T13:30:00Z', '2026-10-06T14:30:00Z')).toBe('partial_overlap');
  });

  it('ignora compromisso ja passado (endsAt <= now)', () => {
    const past = appt('p', '2026-10-04T14:00:00Z', '2026-10-04T15:00:00Z');
    const result = findConflict(
      { startsAt: new Date('2026-10-04T14:00:00Z'), endsAt: new Date('2026-10-04T15:00:00Z') },
      [past],
      { now },
    );
    expect(result.conflict).toBe(false);
  });

  it('compromisso que TERMINA agora ainda conta (nao acabou de verdade)', () => {
    const endingNow = appt('e', '2026-10-05T11:30:00Z', '2026-10-05T12:00:00Z');
    // com endsAt === now ele esta no limite: endsAt <= now => ignorado
    expect(findConflict({ startsAt: endingNow.startsAt, endsAt: now }, [endingNow], { now }).conflict).toBe(false);
    const running = appt('r', '2026-10-05T11:30:00Z', '2026-10-05T12:30:00Z');
    expect(
      findConflict(
        { startsAt: new Date('2026-10-05T12:15:00Z'), endsAt: new Date('2026-10-05T13:00:00Z') },
        [running],
        { now },
      ).conflict,
    ).toBe(true);
  });

  it('ignoreId permite editar o proprio compromisso', () => {
    const result = findConflict(A, [A], { now, ignoreId: 'a' });
    expect(result.conflict).toBe(false);
    expect(findConflict(A, [A], { now }).conflict).toBe(true);
  });

  it('sem candidatos => sem conflito', () => {
    expect(
      findConflict({ startsAt: new Date('2026-10-10T10:00:00Z'), endsAt: new Date('2026-10-10T11:00:00Z') }, [], {
        now,
      }).conflict,
    ).toBe(false);
  });
});
