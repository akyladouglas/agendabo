import { Body, Controller, Get, HttpCode, HttpException, Param, Post, Query } from '@nestjs/common';
import { sharedAuditQuerySchema } from '@agendabo/contracts';
import { CurrentUser } from '../../shared/identity/current-user.decorator';
import { SharedAgendaAuditService } from './shared-agenda-audit.service';
import { SharedAgendasService, SharedInviteInvalidError } from './shared-agendas.service';

/**
 * Rotas do compartilhamento (spec bloco A / decisoes D5/D10). JwtAuthGuard
 * global ja protege tudo (sem @Public): convite/aceite/recusa/revogar/listar
 * sao sempre autenticados — o convidado chega pelo link logado (A.7).
 * Controller FINA: zero regra; o service decide, aqui so mapeia erro de
 * dominio para HTTP (gotcha 15: erro novo sem handler vira 500).
 */
@Controller('shared-agendas')
export class SharedAgendasController {
  constructor(
    private readonly service: SharedAgendasService,
    private readonly audit: SharedAgendaAuditService,
  ) {}

  /**
   * POST /shared-agendas — 202 `{}` SEMPRE (anti-enumeration F.1/D5): convite
   * real, autoconvite, email inexistente/nao confirmado, quota e ate falha do
   * Resend produzem a MESMA resposta. O retorno do service e interno; aqui nao
   * ha nenhum `if` de regra.
   */
  @Post()
  @HttpCode(202)
  async invite(@CurrentUser() user: { id: string }, @Body() body: unknown) {
    await this.service.invite(user.id, body);
    return {};
  }

  /**
   * GET /shared-agendas/audit — LITERAL antes de ':id' (padrao
   * appointments.controller). O zod da query (sharedAgendaId obrigatorio) roda
   * no service; aqui so garante que sharedAgendaId chegue ao parse.
   */
  @Get('audit')
  auditList(
    @CurrentUser() user: { id: string },
    @Query() query: { sharedAgendaId?: string; cursor?: string; limit?: number },
  ) {
    return this.audit.listar(
      sharedAuditQuerySchema.parse({
        sharedAgendaId: query.sharedAgendaId,
        ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
      }),
      user.id,
    );
  }

  /** POST /shared-agendas/accept — 204; token ruim = 410 generico unico (A.5). */
  @Post('accept')
  @HttpCode(204)
  async accept(@CurrentUser() user: { id: string }, @Body() body: unknown): Promise<void> {
    try {
      await this.service.accept(body, user.id);
    } catch (err) {
      throw mapInviteError(err);
    }
  }

  /** POST /shared-agendas/decline — 204; idem aceite (mesmo card generico). */
  @Post('decline')
  @HttpCode(204)
  async decline(@CurrentUser() user: { id: string }, @Body() body: unknown): Promise<void> {
    try {
      await this.service.decline(body, user.id);
    } catch (err) {
      throw mapInviteError(err);
    }
  }

  /** GET /shared-agendas — enviados + recebidos (A.10). */
  @Get()
  list(@CurrentUser() user: { id: string }) {
    return this.service.list(user.id);
  }

  /**
   * POST /shared-agendas/:id/revoke — 204 (dono revoga / convidado sai, A.9).
   * Linha inexistente OU de terceiros: 404 generico do service (sem oraculo).
   * Sem try/catch: `NotFoundException` ja e HTTP nativo (gotcha 15 so se
   * aplica a erro de dominio custom — nada aqui nasce sem handler).
   */
  @Post(':id/revoke')
  @HttpCode(204)
  async revoke(@CurrentUser() user: { id: string }, @Param('id') id: string): Promise<void> {
    await this.service.revoke(user.id, id);
  }
}

/**
 * `SharedInviteInvalidError` → 410 `{code:'shared_invite_invalid'}` (mesmo
 * sabor do `reset_token_invalid`: a web cai no MESMO card "Link de convite
 * inválido ou expirado" em qualquer caso — A.5/D.22). 400 zod fica com o
 * ValidationPipe (erro de entrada).
 */
function mapInviteError(err: unknown): unknown {
  if (err instanceof SharedInviteInvalidError) {
    return new HttpException(
      { message: 'Link de convite inválido ou expirado.', code: 'shared_invite_invalid' },
      410,
    );
  }
  return err;
}
