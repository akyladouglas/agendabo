import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { updateProfileInputSchema, updateProfileResultSchema } from '@agendabo/contracts';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';

/** Shape de usuário da sessão (authStore atualiza direto com a resposta do PATCH /me). */
const SESSION_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  timezone: true,
  resumoDiarioHora: true,
  resumoDiarioAtivo: true,
  // Fase 9: o store da web guarda isAdmin p/ visibilidade de rota (guarda real
  // e do server — ADR-0017). O PATCH /me nunca escreve este campo.
  isAdmin: true,
} as const;

/**
 * Perfil do dono da conta (Fase 5, spec web regra 8, plano D9): `PATCH /me` é a
 * única escrita de perfil (nome/fuso/hora do resumo/flag do resumo). E-mail/senha
 * ficam fora (decisão 6). Controller fina → este service; zod dos contracts.
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fuso precisa existir na tz database (o regex do contracts é estrutural —
   * `Mars/Ohm` passa nele). Rejeição determinística antes de gravar: o digest e a
   * web resolvem o offset via `Intl` e um fuso inv quebraria as duas bordas.
   */
  private assertValidTimezone(tz: string): void {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz }).format();
    } catch {
      throw new ConflictException(`timezone inválida: ${tz} (use IANA, ex.: America/Sao_Paulo)`);
    }
  }

  /**
   * PATCH /me: patch parcial validado por zod; resposta = shape de sessão.
   * `name: null` (ou ausência de nome após optionalText colapsar '') NUNCA apaga o
   * nome — limpar nome pelo perfil não é feature; o campo só é editável quando
   * enviado com valor.
   */
  async updateMe(userId: string, raw: unknown) {
    const input = updateProfileInputSchema.parse(raw);
    if (input.timezone !== undefined) this.assertValidTimezone(input.timezone);

    try {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.timezone !== undefined && { timezone: input.timezone }),
          ...(input.resumoDiarioHora !== undefined && {
            resumoDiarioHora: input.resumoDiarioHora,
          }),
          ...(input.resumoDiarioAtivo !== undefined && {
            resumoDiarioAtivo: input.resumoDiarioAtivo,
          }),
        },
        select: SESSION_USER_SELECT,
      });
      return updateProfileResultSchema.parse(user);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new NotFoundException('conta não encontrada');
      }
      throw err;
    }
  }
}
