import { Injectable } from '@nestjs/common';
import { authSessionsListResultSchema, revokeOtherSessionsResultSchema } from '@agendabo/contracts';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { AuthService } from './auth.service';

/**
 * Gestão de sessões ativas (spec sessão-24h, decisão humana nº 2): o refresh token
 * É a sessão (1 linha por device, sem tabela nova). O hash do cookie atual define
 * a linha `current` (D5 do plano: sem cookie/sem match → lista sem current e o
 * DELETE revoga tudo; listagem e logout NUNCA falham por cookie).
 * Saída validada pelo zod dos contracts na borda do service (padrão do repo).
 */
@Injectable()
export class AuthSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  /** Borda do relógio (D1 do plano): injectable em teste via spy. */
  protected now(): Date {
    return new Date();
  }

  /** Hash do cookie de refresh; undefined sem cookie (a linha atual pode ter morrido no teto). */
  private currentHash(refreshTokenRaw: string | undefined): string | undefined {
    return refreshTokenRaw ? this.auth.hashRefreshToken(refreshTokenRaw) : undefined;
  }

  /**
   * GET /auth/sessions — lista as sessões NÃO expiradas do usuário (loginAt desc),
   * `current: true` exatamente na linha cujo tokenHash bate com o hash do cookie.
   * O tokenHash interno NUNCA sai na resposta. A rota exige Bearer (guard global).
   */
  async listSessions(userId: string, refreshTokenRaw: string | undefined) {
    const currentHash = this.currentHash(refreshTokenRaw);
    const rows = await this.prisma.refreshToken.findMany({
      where: { userId, expiresAt: { gt: this.now() } },
      select: { id: true, tokenHash: true, ip: true, userAgent: true, loginAt: true },
      orderBy: { loginAt: 'desc' },
    });
    return authSessionsListResultSchema.parse({
      items: rows.map((row) => ({
        id: row.id,
        ip: row.ip,
        userAgent: row.userAgent,
        loginAt: row.loginAt,
        current: currentHash !== undefined && row.tokenHash === currentHash,
      })),
    });
  }

  /**
   * DELETE /auth/sessions — revoga TODOS os refresh tokens do usuário EXCETO o da
   * chamada (D5: sem cookie que nada preserva → revoga tudo). Retorna `{ revoked }`.
   */
  async revokeOthers(userId: string, refreshTokenRaw: string | undefined) {
    const currentHash = this.currentHash(refreshTokenRaw);
    const where = currentHash ? { userId, NOT: { tokenHash: currentHash } } : { userId };
    const { count } = await this.prisma.refreshToken.deleteMany({ where });
    return revokeOtherSessionsResultSchema.parse({ revoked: count });
  }

  /**
   * Logout (bug corrigido — spec decisão 2): resolve o usuário PELO HASH do cookie
   * de refresh e apaga TODOS os tokens dele no banco (um refresh copiado/vazado
   * morre junto com o clearCookie). NUNCA lança: sem cookie/desconhecido →
   * `{ userId: null }` e a controller só limpa o cookie (logout nunca é 401).
   */
  async revokeAllByRefreshToken(rawToken: string | undefined): Promise<{ userId: string | null }> {
    if (!rawToken) return { userId: null };
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.auth.hashRefreshToken(rawToken) },
      select: { userId: true },
    });
    if (!stored) return { userId: null };
    await this.prisma.refreshToken.deleteMany({ where: { userId: stored.userId } });
    return { userId: stored.userId };
  }
}
