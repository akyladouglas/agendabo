import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AdminGuard } from './admin.guard';

/**
 * AdminGuard (Fase 9 / ADR-0017): a regra de papel e deste guard — isAdmin lido
 * da FONTE (banco) por request, nunca do token (revogacao vale na hora). O
 * smoke traduziu 403 na rota real, mas a LOGICA do guard e unitaria daqui.
 */

function makeGuard(row: { isAdmin: boolean } | null) {
  const findUnique = jest
    .fn<Promise<{ isAdmin: boolean } | null>, [unknown]>()
    .mockResolvedValue(row);
  const prisma = { user: { findUnique } } as never;
  const guard = new AdminGuard(prisma);
  const req = { user: { id: 'u1' } };
  const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
  return { guard, ctx, findUnique };
}

describe('AdminGuard (Fase 9)', () => {
  it('sem req.user: 403 sem tocar o banco', async () => {
    const findUnique = jest.fn();
    const guard = new AdminGuard({ user: { findUnique } } as never);
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({}) }),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('isAdmin=false no banco: 403 (e consulta com select minimo)', async () => {
    const { guard, ctx, findUnique } = makeGuard({ isAdmin: false });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'u1' },
      select: { isAdmin: true },
    });
  });

  it('isAdmin=true: passa', async () => {
    const { guard, ctx } = makeGuard({ isAdmin: true });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('usuario nao existe mais no banco: 403 (nao 500)', async () => {
    const { guard, ctx } = makeGuard(null);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
