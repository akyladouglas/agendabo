import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation';
import type { SchedulingFlowService } from './scheduling-flow.service';
import type { TelegramClientService } from '../../shared/telegram/telegram-client.service';
import { BotGatewayService } from './bot-gateway.service';

/**
 * Gotcha 5 em prod: api e bot sao servicos separados com o mesmo token. O polling
 * so roda onde BOT_GATEWAY_ENABLED e true (servico bot); a API HTTP desliga e nao
 * faz getUpdates (nunca dois consumidores = nunca 409).
 */
describe('BotGatewayService — gate BOT_GATEWAY_ENABLED', () => {
  function build(gatewayEnabled: boolean) {
    const getClient = jest.fn();
    const telegram = { getClient } as unknown as TelegramClientService;
    const flow = { handleText: jest.fn() } as unknown as SchedulingFlowService;
    const config = {
      get: jest.fn((key: string) => (key === 'BOT_GATEWAY_ENABLED' ? gatewayEnabled : undefined)),
    } as unknown as ConfigService<Env, true>;
    return { service: new BotGatewayService(telegram, flow, config), getClient };
  }

  it('BOT_GATEWAY_ENABLED=false: nem cria o client (API nunca faz polling)', async () => {
    const { service, getClient } = build(false);
    await service.onApplicationBootstrap();
    expect(getClient).not.toHaveBeenCalled();
    await service.onModuleDestroy();
  });

  it('BOT_GATEWAY_ENABLED=true sem token: desliga sem explodir (API vive sem bot)', async () => {
    const telegram = {
      getClient: () => {
        throw new Error('TELEGRAM_BOT_TOKEN ausente');
      },
    } as unknown as TelegramClientService;
    const svc = new BotGatewayService(
      telegram,
      { handleText: jest.fn() } as unknown as SchedulingFlowService,
      { get: () => true } as unknown as ConfigService<Env, true>,
    );
    await svc.onApplicationBootstrap();
    await svc.onModuleDestroy();
  });
});
