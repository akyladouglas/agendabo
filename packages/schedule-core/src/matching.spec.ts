import { describe, expect, it } from 'vitest';
import { applyShift, findMatchingAppointments, normalizeTitle } from './matching';
import type { AppointmentLike } from './types';

/**
 * Busca de candidatas p/ editar/cancelar pelo chat (Fase 4, spec llm-avancado regra 11)
 * e calculo de deslocamento (regra 10). Dominio puro — TDD (plano etapa 2).
 */

const appt = (
  id: string,
  title: string,
  startsAt: string,
  hours = 1,
): AppointmentLike => ({
  id,
  title,
  startsAt: new Date(startsAt),
  endsAt: new Date(new Date(startsAt).getTime() + hours * 60 * 60_000),
});

describe('normalizeTitle', () => {
  it('minusculas, sem acento, espacos colapsados', () => {
    expect(normalizeTitle('  Reunião   de EQUIPE!  ')).toBe('reunião de equipe!'.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
    expect(normalizeTitle('Reunião')).toBe('reuniao');
  });
});

describe('findMatchingAppointments — texto', () => {
  const pool: AppointmentLike[] = [
    appt('a1', 'Consulta dentista', '2026-10-08T17:00:00Z'),
    appt('a2', 'Reunião de equipe', '2026-10-08T14:00:00Z'),
    appt('a3', 'Almoço com cliente', '2026-10-09T18:00:00Z'),
  ];

  it('acento ignorado nos dois lados: "reuniao" casa com "Reunião de equipe"', () => {
    const out = findMatchingAppointments(pool, { texto: 'reuniao' });
    expect(out.map((a) => a.id)).toEqual(['a2']);
  });

  it('substring do titulo casa independentemente de maiusculas/acentos', () => {
    expect(findMatchingAppointments(pool, { texto: 'CONSULTA DENTISTA' }).map((a) => a.id)).toEqual(
      ['a1'],
    );
    expect(findMatchingAppointments(pool, { texto: 'consulta no dentista' }).map((a) => a.id)).toEqual(
      ['a1'],
    );
  });

  it('zero candidatas: descricao que nada casa => lista vazia', () => {
    expect(findMatchingAppointments(pool, { texto: 'aula de piano' })).toEqual([]);
  });

  it('N candidatas: todas as que casam, ordenadas por startsAt (ordem da entrada nao importa)', () => {
    const withTwo: AppointmentLike[] = [
      appt('b2', 'Reunião produto', '2026-10-10T14:00:00Z'),
      ...pool,
      appt('b1', 'Reunião semanal', '2026-10-09T14:00:00Z'),
    ];
    const out = findMatchingAppointments(withTwo, { texto: 'reuniao' });
    expect(out.map((a) => a.id)).toEqual(['a2', 'b1', 'b2']);
  });

  it('descricao so com conectivos ("a") NAO filtra (quem decide o vazio e o caller)', () => {
    // "a" tem < 3 caracteres => nenhum token substantivo => sem filtro de texto
    expect(findMatchingAppointments(pool, { texto: 'a' })).toHaveLength(pool.length);
  });

  it('sem texto (ou texto vazio): todas passam — so o intervalo filtra', () => {
    expect(findMatchingAppointments(pool, {})).toHaveLength(3);
    expect(findMatchingAppointments(pool, { texto: '   ' })).toHaveLength(3);
  });

  it('empate de startsAt preserva a ordem de chegada (estavel)', () => {
    const tie: AppointmentLike[] = [
      appt('x', 'Reunião A', '2026-10-08T14:00:00Z'),
      appt('y', 'Reunião B', '2026-10-08T14:00:00Z'),
    ];
    expect(findMatchingAppointments(tie, { texto: 'reuniao' }).map((a) => a.id)).toEqual(['x', 'y']);
  });

  it('nao muta a entrada', () => {
    const input = [appt('b', 'B', '2026-10-09T00:00:00Z'), appt('a', 'A', '2026-10-08T00:00:00Z')];
    const copy = [...input];
    findMatchingAppointments(input, {});
    expect(input).toEqual(copy);
  });
});

describe('findMatchingAppointments — intervalo', () => {
  const pool: AppointmentLike[] = [
    appt('a1', 'Consulta', '2026-10-08T17:00:00Z'), // qui
    appt('a2', 'Reunião', '2026-10-09T14:00:00Z'), // sex
    appt('a3', 'Consulta oftalo', '2026-10-15T14:00:00Z'), // qui seguinte
  ];
  const thursday = {
    start: new Date('2026-10-08T03:00:00Z'), // meia-noite -03:00 de qui
    end: new Date('2026-10-09T03:00:00Z'), // meia-noite -03:00 de sex (exclusivo)
  };

  it('half-open [start, end): inicio encostado no fim do periodo NAO entra', () => {
    const onBoundary: AppointmentLike[] = [
      appt('edge', 'Consulta limite', '2026-10-09T03:00:00Z'), // = end => fora
    ];
    expect(findMatchingAppointments(onBoundary, { texto: 'consulta', intervalo: thursday })).toEqual(
      [],
    );
  });

  it('texto + intervalo juntos (consulta de quinta)', () => {
    const out = findMatchingAppointments(pool, { texto: 'consulta', intervalo: thursday });
    expect(out.map((a) => a.id)).toEqual(['a1']);
  });

  it('3 no mesmo dia: todos listados (o caso ambiguo da spec)', () => {
    const day: AppointmentLike[] = [
      appt('d1', 'Daily', '2026-10-08T12:00:00Z'),
      appt('d2', '1:1', '2026-10-08T15:00:00Z'),
      appt('d3', 'Revisao', '2026-10-08T18:00:00Z'),
    ];
    const out = findMatchingAppointments(day, { intervalo: thursday });
    expect(out.map((a) => a.id)).toEqual(['d1', 'd2', 'd3']);
  });

  it('sem intervalo: filtro de data ausente, tudo passa', () => {
    expect(findMatchingAppointments(pool, { texto: 'consulta' }).map((a) => a.id)).toEqual([
      'a1',
      'a3',
    ]);
  });
});

describe('applyShift', () => {
  it('deslocamento preserva a duracao (início e fim andam juntos)', () => {
    const out = applyShift(new Date('2026-10-08T17:00:00Z'), new Date('2026-10-08T18:00:00Z'), -60);
    expect(out.startsAt.toISOString()).toBe('2026-10-08T16:00:00.000Z');
    expect(out.endsAt.toISOString()).toBe('2026-10-08T17:00:00.000Z');
  });

  it('positivo atrasa ("pra mais tarde 30min")', () => {
    const out = applyShift(new Date('2026-10-08T17:00:00Z'), new Date('2026-10-08T18:00:00Z'), 30);
    expect(out.startsAt.toISOString()).toBe('2026-10-08T17:30:00.000Z');
  });

  it('delta cruzando a meia-noite local (23:30 -03:00 adiantado 1h segue o mesmo dia)', () => {
    // 23:30 local -03:00 = 02:30Z do dia 09; -60min => 22:30 local do dia 08
    const out = applyShift(new Date('2026-10-09T02:30:00Z'), new Date('2026-10-09T03:30:00Z'), -60);
    expect(out.startsAt.toISOString()).toBe('2026-10-09T01:30:00.000Z');
    expect(out.endsAt.toISOString()).toBe('2026-10-09T02:30:00.000Z');
  });

  it('delta cruzando a meia-noite no sentido atrasado', () => {
    const out = applyShift(new Date('2026-10-09T02:30:00Z'), new Date('2026-10-09T03:00:00Z'), 60);
    expect(out.startsAt.toISOString()).toBe('2026-10-09T03:30:00.000Z');
  });

  it('delta zero = mesma data (ids de tempo diferentes, valores iguais)', () => {
    const out = applyShift(new Date('2026-10-08T17:00:00Z'), new Date('2026-10-08T18:00:00Z'), 0);
    expect(out.startsAt.getTime()).toBe(Date.parse('2026-10-08T17:00:00Z'));
  });
});
