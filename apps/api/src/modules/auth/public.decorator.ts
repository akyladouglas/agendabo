import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
/** Marca rota publica (login/signup/health). Todo o resto exige JWT (guard global). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
