import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Conta do usuario (perfil, timezone, resumoDiarioHora, nome).
 * Fase 5: `PATCH /me` (edição de perfil pela web — spec web regra 8).
 */
@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
