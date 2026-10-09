import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../shared/identity/current-user.decorator';
import {
  AppointmentConflictError,
  AppointmentsService,
  RelocationNotAvailableError,
} from './appointments.service';

@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly service: AppointmentsService) {}
  @Get()
  list(@CurrentUser() user: { id: string }, @Query() query: Record<string, string>) {
    return this.service.list(user.id, query);
  }

  @Post('check-conflict')
  checkConflict(@CurrentUser() user: { id: string }, @Body() body: unknown) {
    return this.service.checkConflict(user.id, body);
  }

  /** Rotas literais ANTES de ':id' (Nest casa literal primeiro — gotcha clássico). */
  @Post('relocation-options')
  async relocationOptions(@CurrentUser() user: { id: string }, @Body() body: unknown) {
    try {
      return await this.service.relocationOptions(user.id, body);
    } catch (err) {
      // `blocked` (2+ conflitos) vira o MESMO 409 do check-conflict (spec C2)
      if (err instanceof AppointmentConflictError) throw conflict409(err);
      throw err;
    }
  }

  @Post('reschedule')
  async reschedule(@CurrentUser() user: { id: string }, @Body() body: unknown) {
    try {
      return await this.service.reschedule(user.id, body);
    } catch (err) {
      if (err instanceof AppointmentConflictError || err instanceof RelocationNotAvailableError) {
        throw conflict409(err);
      }
      throw err;
    }
  }

  @Post()
  async create(@CurrentUser() user: { id: string }, @Body() body: unknown) {
    try {
      return await this.service.create(user.id, body);
    } catch (err) {
      if (err instanceof AppointmentConflictError) throw conflict409(err);
      throw err;
    }
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    try {
      return await this.service.update(user.id, id, body);
    } catch (err) {
      // ADR-0015/F-B2: edição em conflito é 409 com `conflictWith` (a web oferece
      // as jogadas; o bot já trata ConflictError e re-pergunta o quando)
      if (err instanceof AppointmentConflictError) throw conflict409(err);
      throw err;
    }
  }

  @Delete(':id')
  async remove(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    await this.service.remove(user.id, id);
    return { deleted: true };
  }
}

/** Corpo 409 canônico (mesmo shape do check-conflict — `conflict.utils.ts` da web lê isto). */
function conflict409(err: AppointmentConflictError | RelocationNotAvailableError): HttpException {
  const c = err.conflictWith;
  return new HttpException(
    {
      message: c.title
        ? `Conflito com "${c.title}" (${c.startsAt.toISOString()} - ${c.endsAt.toISOString()})`
        : 'Jogada de reagendamento nao disponivel',
      conflictWith: c.title ? c : null,
    },
    409,
  );
}
