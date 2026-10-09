import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { AuthenticatedRequest } from '../auth/auth.service';

/**
 * Guard das rotas de admin (Fase 9 / ADR-0017). O JwtAuthGuard global ja garantiu
 * Bearer valido e injetou `req.user` (re-fetch por request); aqui so pergunta ao
 * banco `isAdmin` — a flag nao viaja no token (admin revogado vale na hora, e o
 * padrao re-fetch da casa). 403 com mensagem generica: a existencia do recurso
 * admin nao vaza para quem nao e admin.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = req.user;
    if (!user) throw new ForbiddenException('Acesso restrito');
    const admin = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { isAdmin: true },
    });
    if (!admin?.isAdmin) throw new ForbiddenException('Acesso restrito');
    return true;
  }
}
