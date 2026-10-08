import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UsersService } from './users.service';

/**
 * PATCH /me (Fase 5, spec web regra 8 + decisões 2/7): zod dos contracts, fuso
 * validado contra a tz database, patch parcial, shape de sessão na resposta.
 */

function make(userRow: Record<string, unknown> = {}) {
  const update = jest
    .fn()
    .mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...userRow,
      ...data,
    }));
  const prisma = { user: { update } };
  const svc = new UsersService(prisma as never);
  return { svc, update };
}

const ROW = {
  id: '3f0f1e2c-1111-4aaa-8bbb-ccccdddd0001',
  email: 'ana@example.com',
  name: 'Ana',
  timezone: 'America/Sao_Paulo',
  resumoDiarioHora: '07:00',
  resumoDiarioAtivo: true,
};

describe('UsersService.updateMe (PATCH /me)', () => {
  it('patch parcial: só o campo enviado vai para o Prisma; resposta no shape de sessão', async () => {
    const { svc, update } = make(ROW);
    const result = await svc.updateMe('u1', { resumoDiarioHora: '08:15' });

    expect(update.mock.calls[0]![0]!.data).toEqual({ resumoDiarioHora: '08:15' });
    expect(result).toEqual({
      id: '3f0f1e2c-1111-4aaa-8bbb-ccccdddd0001',
      email: 'ana@example.com',
      name: 'Ana',
      timezone: 'America/Sao_Paulo',
      resumoDiarioHora: '08:15',
      resumoDiarioAtivo: true,
    });
  });

  it('desligar o resumo persiste resumoDiarioAtivo=false (Aberto #2 → (a))', async () => {
    const { svc, update } = make(ROW);
    const result = await svc.updateMe('u1', { resumoDiarioAtivo: false });
    expect(update.mock.calls[0]![0]!.data).toEqual({ resumoDiarioAtivo: false });
    expect(result.resumoDiarioAtivo).toBe(false);
  });

  it('name é aparado e salvo (decisão 7)', async () => {
    const { svc, update } = make(ROW);
    await svc.updateMe('u1', { name: '  Akyla  ' });
    expect(update.mock.calls[0]![0]!.data).toEqual({ name: 'Akyla' });
  });

  it('timezone IANA válida passa; fora da tz database (ex.: Mars/Ohm) vira 409 ANTES de gravar', async () => {
    const { svc, update } = make(ROW);
    await expect(svc.updateMe('u1', { timezone: 'Europe/Lisbon' })).resolves.toMatchObject({
      timezone: 'Europe/Lisbon',
    });
    update.mockClear();
    await expect(svc.updateMe('u1', { timezone: 'Mars/Ohm' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('patch vazio (nenhum campo) é rejeitado pelo zod sem tocar no banco', async () => {
    const { svc, update } = make(ROW);
    await expect(svc.updateMe('u1', {})).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
  });

  it('P2025 (id inexistente) vira 404', async () => {
    const prisma = {
      user: {
        update: jest.fn().mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('Record to update not found.', {
            code: 'P2025',
            clientVersion: '6.1.0',
          }),
        ),
      },
    };
    const svc = new UsersService(prisma as never);
    await expect(svc.updateMe('ghost', { name: 'X' })).rejects.toBeInstanceOf(NotFoundException);
  });
});
