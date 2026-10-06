import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedRequest, AuthService } from './auth.service';
import { IS_PUBLIC_KEY } from './public.decorator';

/** Guard global deny-by-default (padrao financas): passa so o que e @Public() ou tem Bearer valido. */
@Injectable()
export class JwtAuthGuard {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest & { headers: Record<string, string | undefined> }>();
    const header = req.headers['authorization'] ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    // O payload nao traz telegramId (evita token inflado/obsoleto); re-busca por id
    // na fonte de verdade (padrao financas: re-fetch por request).
    const user = await this.auth.verifyAccessToken(token);
    if (!user) return false;
    req.user = user;
    return true;
  }
}
