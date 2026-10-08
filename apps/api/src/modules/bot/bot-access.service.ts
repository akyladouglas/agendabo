import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';

export interface BotUser {
  id: string;
  telegramId: string;
  timezone: string;
  /** Nome para saudação/endereçamento (decisão 7 da spec web; null = sem nome). */
  name: string | null;
}

/**
 * Porta de entrada do bot (Fase 3): o bot so atende telegramIds cadastrados E com
 * email confirmado (3.1). Qualquer outro chat recebe apenas "cadastre-se no site".
 */
@Injectable()
export class BotAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async requireConfirmedUser(telegramId: string): Promise<BotUser> {
    const user = await this.prisma.user.findUnique({
      where: { telegramId },
      select: { id: true, telegramId: true, timezone: true, emailConfirmedAt: true, name: true },
    });
    if (!user || !user.emailConfirmedAt || !user.telegramId) {
      throw new ForbiddenException('cadastro_necessario');
    }
    return {
      id: user.id,
      telegramId: user.telegramId,
      timezone: user.timezone,
      name: user.name,
    };
  }
}
