import { Body, Controller, Get, HttpException, Param, Post } from '@nestjs/common';
import { reviewDismissResultSchema } from '@agendabo/contracts';
import { CurrentUser } from '../../shared/identity/current-user.decorator';
import { AppointmentConflictError } from './appointments.service';
import { ReviewService } from './review.service';

/**
 * Fila de revisão (Fase 4, spec E15/E16). Controller FINO: delega tudo ao ReviewService
 * e só traduz o conflito determinístico em 409 (mesmo shape do create de appointments).
 * O guard JWT é global — a rota já exige usuário autenticado.
 */
@Controller('review')
export class ReviewController {
  constructor(private readonly service: ReviewService) {}

  @Get()
  list(@CurrentUser() user: { id: string }) {
    return this.service.list(user.id);
  }

  @Post(':id/confirm')
  async confirm(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    try {
      return await this.service.confirm(user.id, id, body);
    } catch (err) {
      if (err instanceof AppointmentConflictError) {
        const c = err.conflictWith;
        throw new HttpException(
          {
            message: `Choque com "${c.title}" (${c.startsAt.toISOString()} - ${c.endsAt.toISOString()})`,
            conflictWith: c,
          },
          409,
        );
      }
      throw err;
    }
  }

  @Post(':id/dismiss')
  async dismiss(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    const result = await this.service.dismiss(user.id, id);
    return reviewDismissResultSchema.parse(result);
  }
}
