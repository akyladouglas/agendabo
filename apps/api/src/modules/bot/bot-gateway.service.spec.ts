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

  it('dono explicito (bot-main): gateway liga MESMO com BOT_GATEWAY_ENABLED=false', async () => {
    process.env.BOT_GATEWAY_EXPLICIT_OWNER = 'true';
    try {
      const telegram = {
        getClient: () => {
          throw new Error('TELEGRAM_BOT_TOKEN ausente');
        },
      } as unknown as TelegramClientService;
      const svc = new BotGatewayService(
        telegram,
        { handleText: jest.fn() } as unknown as SchedulingFlowService,
        { get: () => false } as unknown as ConfigService<Env, true>,
      );
      // passa pelo gate (nao loga "desligado") e morre no getToken — sem excecao fora
      await svc.onApplicationBootstrap();
      await svc.onModuleDestroy();
    } finally {
      delete process.env.BOT_GATEWAY_EXPLICIT_OWNER;
    }
  });
});

/**
 * Modo webhook (TELEGRAM_WEBHOOK_URL): a API e dona (setWebhook no boot); o
 * binario do bot e espectador; handler valida segredo e delega ao fluxo.
 */
describe('BotGatewayService — modo webhook', () => {
  function buildWebhook(overrides: Partial<Record<string, unknown>> = {}) {
    const setWebhook = jest.fn().mockResolvedValue(true);
    const getWebhookInfo = jest.fn().mockResolvedValue({ url: 'x', pending_update_count: 0 });
    const telegram = {
      getClient: () => ({ telegram: { setWebhook, getWebhookInfo } }),
    } as unknown as TelegramClientService;
    const flow = {
      handleText: jest.fn(),
      handleCallback: jest.fn(),
    } as unknown as SchedulingFlowService;
    const get = jest.fn((key: string) => {
      if (key === 'TELEGRAM_WEBHOOK_URL') return 'https://api.example.com/telegram/webhook';
      if (key === 'TELEGRAM_WEBHOOK_SECRET') return 'segredo-de-teste-1234';
      return overrides[key];
    });
    const config = { get } as unknown as ConfigService<Env, true>;
    return { svc: new BotGatewayService(telegram, flow, config), setWebhook, flow };
  }

  it('API com webhook url: setWebhook no boot e NENHUM polling', async () => {
    const { svc, setWebhook } = buildWebhook();
    await svc.onApplicationBootstrap();
    expect(setWebhook).toHaveBeenCalledWith(
      'https://api.example.com/telegram/webhook',
      expect.objectContaining({ drop_pending_updates: true }),
    );
    await svc.onModuleDestroy(); // sem polling para parar — nao explode
  });

  it('binario do bot com webhook url: espectador (setWebhook quem faz e a API)', async () => {
    const { svc, setWebhook } = buildWebhook();
    process.env.BOT_GATEWAY_EXPLICIT_OWNER = 'true';
    try {
      await svc.onApplicationBootstrap();
      expect(setWebhook).not.toHaveBeenCalled();
    } finally {
      delete process.env.BOT_GATEWAY_EXPLICIT_OWNER;
    }
  });

  it('handleUpdate: message.text vira handleText; callback vira handleCallback', async () => {
    const { svc, flow } = buildWebhook();
    await svc.handleUpdate({ message: { text: 'oi', chat: { id: 42 } } });
    expect(flow.handleText).toHaveBeenCalledWith('42', 'oi');
    await svc.handleUpdate({ callback_query: { data: 'dia:1', from: { id: 42 } } });
    expect(flow.handleCallback).toHaveBeenCalledWith('42', 'dia:1');
  });

  it('webhookHandler: segredo errado = 404 sem processar', async () => {
    const { svc, flow } = buildWebhook();
    const req = {
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'ladrao' },
      [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }),
    } as never;
    const writeHead = jest.fn().mockReturnThis();
    const end = jest.fn();
    await svc.webhookHandler(req, { writeHead, end } as never);
    expect(writeHead).toHaveBeenCalledWith(404);
    expect(flow.handleText).not.toHaveBeenCalled();
  });

  it('webhookHandler: segredo ok = 200 rapido + handleText processado', async () => {
    const { svc, flow } = buildWebhook();
    const body = Buffer.from(JSON.stringify({ message: { text: 'oii', chat: { id: 9 } } }));
    const req = {
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'segredo-de-teste-1234' },
      [Symbol.asyncIterator]: () => {
        let sent = false;
        return {
          next: async () =>
            sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: body }),
        };
      },
    } as never;
    const writeHead = jest.fn().mockReturnThis();
    await svc.webhookHandler(req, { writeHead, end: jest.fn() } as never);
    expect(writeHead).toHaveBeenCalledWith(200);
    expect(flow.handleText).toHaveBeenCalledWith('9', 'oii');
  });
});
