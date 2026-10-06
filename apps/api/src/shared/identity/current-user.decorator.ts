import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser } from '../../modules/auth/auth.service';

/** Injeta o usuario autenticado (pelo JwtAuthGuard) na assinatura do controller. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const req = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (!req.user) {
      throw new Error('CurrentUser usado em rota sem autenticacao (falta @Public?)');
    }
    return req.user;
  },
);
