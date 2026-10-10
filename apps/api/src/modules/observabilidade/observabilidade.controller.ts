import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ZodError } from 'zod';
import { CurrentUser } from '../../shared/identity/current-user.decorator';
import { AdminGuard } from './admin.guard';
import { ObservabilidadeReadService } from './observabilidade-read.service';

/** shape de rota do zod (mesmo do filtro global? nao ha — cada service devolve o shape). */
function zodMessage(err: unknown): string {
  if (err instanceof ZodError) {
    return err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
  }
  return 'payload invalido';
}

/**
 * Rotas de observabilidade (Fase 9, spec B5/B6/C4). Controllers FINAS: parse de
 * query em zod DENTRO do service (o guard nao ve query), guarda de papel no
 * service (404 sem rollout — nao vaza), guard de admin na rota. O JwtAuthGuard
 * global ja exigiu Bearer e injetou req.user.
 */
@Controller()
export class ObservabilidadeController {
  constructor(private readonly service: ObservabilidadeReadService) {}

  /** GET /observabilidade/me — flags de papel da sessão (web mostra a rota com isto). */
  @Get('observabilidade/me')
  async me(@CurrentUser() user: { id: string }) {
    return this.service.meFlags(user.id);
  }

  /** GET /bot-events — admin ve tudo; rollout ve os proprios; demais 404. */
  @Get('bot-events')
  async listEvents(
    @CurrentUser() user: { id: string },
    @Query() query: Record<string, string | undefined>,
  ) {
    const caller = await this.service.callerRole(user.id);
    try {
      return await this.service.listBotEvents(caller, query);
    } catch (err) {
      if (err instanceof ZodError) throw new BadRequestException(zodMessage(err));
      throw err;
    }
  }

  /** GET /llm-usage — admin-only (spec C4; o cliente nunca ve custo). */
  @Get('llm-usage')
  @UseGuards(AdminGuard)
  async llmUsage(@Query() query: Record<string, string | undefined>) {
    try {
      return await this.service.llmUsage(query);
    } catch (err) {
      if (err instanceof ZodError) throw new BadRequestException(zodMessage(err));
      throw err;
    }
  }

  /** GET /admin/users — lista mínima p/ a página Admin (admin-only; filtro de eventos). */
  @Get('admin/users')
  @UseGuards(AdminGuard)
  async listUsers() {
    return this.service.listUsers();
  }

  /** PATCH /admin/users/:id/observabilidade — rollout on/off (admin-only, so a flag). */
  @Patch('admin/users/:id/observabilidade')
  @UseGuards(AdminGuard)
  async setRollout(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    try {
      return await this.service.setRollout(id, body);
    } catch (err) {
      if (err instanceof ZodError) throw new BadRequestException(zodMessage(err));
      throw err;
    }
  }
}
