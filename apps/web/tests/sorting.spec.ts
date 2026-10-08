import { describe, expect, it } from 'vitest';
import type { AppointmentDto } from '@agendabo/contracts';
import { sortAppointmentsByStart } from '../src/app/utils/sorting';

function item(id: string, title: string, startsAt: string): AppointmentDto {
  const starts = new Date(startsAt);
  return {
    id,
    title,
    startsAt: starts,
    endsAt: new Date(starts.getTime() + 60 * 60_000),
    notes: null,
    status: 'confirmed',
    origin: 'web',
    createdAt: starts,
  };
}

describe('sortAppointmentsByStart', () => {
  it('ordena por início', () => {
    const b = item('b', 'Depois', '2026-10-08T15:00:00Z');
    const a = item('a', 'Antes', '2026-10-08T13:00:00Z');
    expect(sortAppointmentsByStart([b, a]).map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('empate de início: ordem por título', () => {
    const z = item('z', 'Zebra', '2026-10-08T13:00:00Z');
    const a = item('a', 'Anta', '2026-10-08T13:00:00Z');
    expect(sortAppointmentsByStart([z, a]).map((x) => x.title)).toEqual(['Anta', 'Zebra']);
  });

  it('não muta a lista de origem', () => {
    const list = [
      item('b', 'B', '2026-10-08T15:00:00Z'),
      item('a', 'A', '2026-10-08T13:00:00Z'),
    ];
    const sorted = sortAppointmentsByStart(list);
    expect(list.map((x) => x.id)).toEqual(['b', 'a']);
    expect(sorted.map((x) => x.id)).toEqual(['a', 'b']);
  });
});
