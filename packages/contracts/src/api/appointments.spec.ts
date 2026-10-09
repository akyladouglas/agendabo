import { describe, expect, it } from 'vitest';
import {
  relocationOptionsInputSchema,
  rescheduleAppointmentInputSchema,
} from './appointments';

/**
 * Schemas do Reagendamento Assistido (Fase 8, Etapa 0, ADR-0015): a união
 * discriminada do reschedule é a borda que impede "criar + mover" em dois
 * requests; `force` não entra em input nenhum (chave desconhecida é descartada).
 */

const id1 = '11111111-1111-4111-8111-111111111111';
const id2 = '22222222-2222-4222-8222-222222222222';

describe('rescheduleAppointmentInputSchema', () => {
  it('variante move aceita movedId + newStart/newEnd', () => {
    const parsed = rescheduleAppointmentInputSchema.parse({
      mode: 'move',
      movedId: id1,
      newStart: '2026-10-12T17:00:00.000Z',
      newEnd: '2026-10-12T18:00:00.000Z',
    });
    expect(parsed.mode).toBe('move');
  });

  it('variante move com otherId igual a movedId: rejeita', () => {
    expect(() =>
      rescheduleAppointmentInputSchema.parse({
        mode: 'move',
        movedId: id1,
        otherId: id1,
        newStart: '2026-10-12T17:00:00.000Z',
        newEnd: '2026-10-12T18:00:00.000Z',
      }),
    ).toThrow();
  });

  it('variante move com newEnd <= newStart: rejeita', () => {
    expect(() =>
      rescheduleAppointmentInputSchema.parse({
        mode: 'move',
        movedId: id1,
        newStart: '2026-10-12T18:00:00.000Z',
        newEnd: '2026-10-12T18:00:00.000Z',
      }),
    ).toThrow();
  });

  it('variante create aceita payload completo + otherId opcional', () => {
    const parsed = rescheduleAppointmentInputSchema.parse({
      mode: 'create',
      create: {
        title: 'Consulta',
        startsAt: '2026-10-12T14:00:00.000Z',
        endsAt: '2026-10-12T15:00:00.000Z',
        notificationRules: [],
      },
      otherId: id2,
    });
    expect(parsed.mode).toBe('create');
  });

  it('create com endsAt <= startsAt: rejeita (intervalo é invariante)', () => {
    expect(() =>
      rescheduleAppointmentInputSchema.parse({
        mode: 'create',
        create: {
          title: 'Consulta',
          startsAt: '2026-10-12T15:00:00.000Z',
          endsAt: '2026-10-12T15:00:00.000Z',
          notificationRules: [],
        },
      }),
    ).toThrow();
  });

  it('mode ausente ou desconhecido: rejeita (união discriminada)', () => {
    expect(() =>
      rescheduleAppointmentInputSchema.parse({
        movedId: id1,
        newStart: '2026-10-12T17:00:00.000Z',
        newEnd: '2026-10-12T18:00:00.000Z',
      }),
    ).toThrow();
  });
});

describe('relocationOptionsInputSchema', () => {
  it('destino válido é aceito; endsAt <= startsAt rejeita', () => {
    expect(
      relocationOptionsInputSchema.parse({
        startsAt: '2026-10-12T14:30:00.000Z',
        endsAt: '2026-10-12T15:30:00.000Z',
      }),
    ).toBeTruthy();
    expect(() =>
      relocationOptionsInputSchema.parse({
        startsAt: '2026-10-12T14:30:00.000Z',
        endsAt: '2026-10-12T14:30:00.000Z',
      }),
    ).toThrow();
  });
});
