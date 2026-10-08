import { Body, Controller, Patch } from '@nestjs/common';
import { CurrentUser } from '../../shared/identity/current-user.decorator';
import { UsersService } from './users.service';

/**
 * Perfil autenticado (Fase 5). Controller FINA: o guard JWT global já exige sessão;
 * zod/erros ficam no service (a tradução ConflictException/NotFoundException é
 * feita pelo HttpException padrão do Nest).
 */
@Controller('me')
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Patch()
  updateMe(@CurrentUser() user: { id: string }, @Body() body: unknown) {
    return this.service.updateMe(user.id, body);
  }
}
