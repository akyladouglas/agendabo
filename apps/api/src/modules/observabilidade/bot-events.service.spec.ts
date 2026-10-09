import { Logger } from '@nestjs/common';
import { BotEventsService } from './bot-events.service';
import type { Env } from '../../config/env.validation';

/**
 * BotEventsService (Fase 9, spec observabilidade B1/B2; ADR-0017) — jest com
 * mock plano (testing.md). O que este spec NÃO negocia:
 *  - o telegramId CRU nunca chega à linha (só o HMAC truncado, D-P3);
 *  - metadata passa pelo zod dos contracts ANTES de gravar — campo proibido
 *    (fala/título disfarçado) é recusado, e recusar NUNCA derruba o chamador;
 *  - falha de telemetria é log, nunca exceção (gravação best-effort).
 */

const USER = { id: 'u1', telegramId: '123456789', timezone: 'UTC', name: null };

function make(prismaOverrides?: Record<string, unknown>) {
  const botEvent = { create: jest.fn().mockResolvedValue({ id: 'e1' }) };
  const prisma = { botEvent, ...prismaOverrides };
  const config = {
    get: (key: keyof Env) =>
      (
        ({ EVENTS_HASH_SECRET: 'dev_salt_de_teste_1234567890' }) as Partial<
          Record<keyof Env, unknown>
        >
      )[key],
  } as never;
  const svc = new BotEventsService(prisma as never, config);
  // silencia o Logger sem perder a asserção de "não jogou"
  jest.spyOn(Logger.prototype, 'error').mockImplementation();
  jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  return { svc, botEvent, prisma };
}

describe('BotEventsService.registrar (ADR-0017)', () => {
  it('grava linha com userId, type, outcome e hash do telegramId — nunca o id cru', async () => {
    const { svc, botEvent } = make();
    await svc.registrar(USER, 'intent_classified', 'ok', {
      stage: 'off_flow',
      metadata: { intent: 'consultar', confidence: 0.9 },
    });
    expect(botEvent.create).toHaveBeenCalledTimes(1);
    const data = botEvent.create.mock.calls[0]![0]!.data;
    expect(data).toMatchObject({
      userId: 'u1',
      type: 'intent_classified',
      outcome: 'ok',
      stage: 'off_flow',
      metadata: { intent: 'consultar', confidence: 0.9 },
    });
    // telegramId cru NUNCA é coluna/valor da linha
    expect(JSON.stringify(data)).not.toContain('123456789');
    expect(data.telegramIdHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('hash é determinístico para o mesmo id e muda com outro usuario', async () => {
    const { svc, botEvent } = make();
    await svc.registrar(USER, 'flow_started', 'ok', {});
    const hashA = botEvent.create.mock.calls[0]![0]!.data.telegramIdHash;
    await svc.registrar(USER, 'flow_started', 'ok', {});
    const hashA2 = botEvent.create.mock.calls[1]![0]!.data.telegramIdHash;
    await svc.registrar({ ...USER, id: 'u2', telegramId: '987654321' }, 'flow_started', 'ok', {});
    const hashB = botEvent.create.mock.calls[2]![0]!.data.telegramIdHash;
    expect(hashA).toBe(hashA2);
    expect(hashA).not.toBe(hashB);
  });

  it('metadata invalida (campo proibido com a fala) e RECUSADA: grava sem metadata, nunca estoura', async () => {
    const { svc, botEvent } = make();
    await svc.registrar(USER, 'flow_completed', 'ok', {
      metadata: {
        appointmentId: '3f0f1e2c-1111-4aaa-8bbb-ccccdddd0001',
        rawText: 'fala do usuario',
      },
    });
    expect(botEvent.create).toHaveBeenCalledTimes(1);
    const data = botEvent.create.mock.calls[0]![0]!.data;
    // a linha ainda nasce (auditoria) mas o conteudo proibido fica FORA dela
    expect(data.metadata ?? null).toBeNull();
    expect(JSON.stringify(data)).not.toContain('fala do usuario');
  });

  it('metadata valida passa pelo zod e e gravada intacta', async () => {
    const { svc, botEvent } = make();
    const meta = { appointmentId: '3f0f1e2c-1111-4aaa-8bbb-ccccdddd0001' };
    await svc.registrar(USER, 'cancelled', 'ok', { metadata: meta });
    expect(botEvent.create.mock.calls[0]![0]!.data.metadata).toEqual(meta);
  });

  it('falha do banco e log, nunca excecao (telemetria nao derruba turno)', async () => {
    const { svc } = make({
      botEvent: { create: jest.fn().mockRejectedValue(new Error('banco caiu')) },
    });
    await expect(svc.registrar(USER, 'flow_started', 'ok', {})).resolves.toBeUndefined();
  });

  it('stage fora do formato identificador degrada para sem stage (a fala nunca vai como stage)', async () => {
    const { svc, botEvent } = make();
    await svc.registrar(USER, 'flow_started', 'ok', { stage: 'ola tudo bem?' });
    expect(botEvent.create.mock.calls[0]![0]!.data.stage ?? null).toBeNull();
  });

  it('hash nao e reutilizavel entre segredos diferentes (salt do env importa)', async () => {
    const { svc, botEvent } = make();
    await svc.registrar(USER, 'flow_started', 'ok', {});
    const hash = botEvent.create.mock.calls[0]![0]!.data.telegramIdHash;
    const configOutro = { get: () => 'outro_salt_de_teste_0987654321' } as never;
    const prisma2 = { botEvent: { create: jest.fn().mockResolvedValue({}) } };
    const svc2 = new BotEventsService(prisma2 as never, configOutro);
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    await svc2.registrar(USER, 'flow_started', 'ok', {});
    expect(prisma2.botEvent.create.mock.calls[0]![0]!.data.telegramIdHash).not.toBe(hash);
  });
});
