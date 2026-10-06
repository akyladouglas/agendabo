import { Controller, Get } from '@nestjs/common';
import { Public } from '../modules/auth/public.decorator';

@Public()
@Controller('health')
export class HealthController {
  @Get()
  health(): { ok: true; ts: string } {
    return { ok: true, ts: new Date().toISOString() };
  }
}
