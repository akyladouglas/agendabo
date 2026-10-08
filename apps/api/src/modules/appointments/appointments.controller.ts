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
import { AppointmentConflictError, AppointmentsService } from './appointments.service';

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

  @Post()
  async create(@CurrentUser() user: { id: string }, @Body() body: unknown) {
    try {
      return await this.service.create(user.id, body);
    } catch (err) {
      if (err instanceof AppointmentConflictError) {
        const c = err.conflictWith;
        throw new HttpException(
          {
            message: `Conflito com "${c.title}" (${c.startsAt.toISOString()} - ${c.endsAt.toISOString()})`,
            conflictWith: c,
          },
          409,
        );
      }
      throw err;
    }
  }

  @Patch(':id')
  update(@CurrentUser() user: { id: string }, @Param('id') id: string, @Body() body: unknown) {
    return this.service.update(user.id, id, body);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    await this.service.remove(user.id, id);
    return { deleted: true };
  }
}
