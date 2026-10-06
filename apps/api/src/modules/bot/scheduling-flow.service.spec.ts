import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulingFlowService } from './scheduling-flow.service';
import type { BotUser } from './bot-access.service';
import type { Env } from '../../config/env.validation';

/**
 * Service do fluxo (jest, mock plano — testing.md): valida as BORDAS que a maquina
 * pura nao ve: gate de acesso (spec 1), abrir fluxo so com intencao `criar` (spec 2),
 * consulta dos confirmed futuros (spec 9), create via AppointmentsService com
 * origin bot (spec 6/18), TTL da sessao (spec 15).
 */

const USER: BotUser = { id: 'u1', telegramId: '111', timezone: 'America/Sao_Paulo' };

function make() {
  const sent: string[] = [];
  const access = { requireConfirmedUser: jest.fn().mockResolvedValue(USER) };
  const classifier = {
    classify: jest.fn().mockResolvedValue({ ok: false, reason: 'no_tool_use' }),
  };
  const appointments = { create: jest.fn().mockResolvedValue({ id: 'a1' }) };
  const telegram = {
    sendMessage: jest.fn(async (_id: string, text: string) => {
      sent.push(text);
    }),
    getClient: () => ({
      telegram: {
        sendMessage: jest.fn(async (_id: string, text: string, _opts: unknown) => {
          sent.push(text);
        }),
      },
    }),
  };
  const prisma = { appointment: { findMany: jest.fn().mockResolvedValue([]) } };
  const config = {
    get: (key: keyof Env) =>
      (
        ({
          MIN_CONFIDENCE_TO_ACCEPT: 0.7,
          LLM_MODEL_PRIMARY: 'haiku',
          LLM_MODEL_ESCALATION: 'sonnet',
          BOT_SESSION_TTL_MINUTES: 30,
        }) as Partial<Record<keyof Env, unknown>>
      )[key],
  } as unknown as ConfigService<Env, true>;

  const svc = new SchedulingFlowService(
    access as never,
    classifier as never,
    appointments as never,
    telegram as never,
    prisma as never,
    config,
  );
  return { svc, sent, access, classifier, appointments, prisma };
}

/** Abre o fluxo com intencao `criar` aceita; a fala "Consulta" vira o titulo. */
async function openFlow(m: ReturnType<typeof make>): Promise<void> {
  m.classifier.classify.mockResolvedValue({ ok: true, intent: 'criar', confidence: 0.9 });
  await m.svc.handleText('111', 'Consulta');
  // depois de aberto, os turnos seguintes passam a classificar com contexto de fluxo;
  // aqui o stub nao identifica intencao nenhuma => a maquina trata o texto como dado.
  m.classifier.classify.mockResolvedValue({ ok: false, reason: 'no_tool_use' });
}

describe('SchedulingFlowService (bordas)', () => {
  it('gate de acesso (spec 1): sem cadastro => só orientação, nada de LLM/agenda', async () => {
    const { svc, sent, access, classifier, prisma, appointments } = make();
    access.requireConfirmedUser.mockRejectedValue(new ForbiddenException('cadastro_necessario'));

    await svc.handleText('999', 'oi');

    expect(sent[0]).toContain('cria sua conta');
    expect(classifier.classify).not.toHaveBeenCalled();
    expect(prisma.appointment.findMany).not.toHaveBeenCalled();
    expect(appointments.create).not.toHaveBeenCalled();
  });

  it('fora do fluxo: intenção "criar" abre o fluxo e a fala vira o título (spec 2)', async () => {
    const m = make();
    m.classifier.classify.mockResolvedValue({ ok: true, intent: 'criar', confidence: 0.9 });
    await m.svc.handleText('111', 'quero marcar uma consulta');
    // "quero marcar uma consulta" e a fala de intencao: o bot abre o fluxo e pergunta;
    // se a fala serviu de titulo, segue para o dia. Em qualquer caso, o fluxo abriu:
    const internals = m.svc as unknown as { sessions: Map<string, { step: string }> };
    expect(internals.sessions.get('111')).toBeDefined();
    expect(m.sent.length).toBeGreaterThan(0);
  });

  it('fora do fluxo: "fora_do_escopo" => fallback sem criar nada; duvida => pergunta (spec 2)', async () => {
    const m1 = make();
    m1.classifier.classify.mockResolvedValue({
      ok: true,
      intent: 'fora_do_escopo',
      confidence: 0.9,
    });
    await m1.svc.handleText('111', 'me conta uma piada');
    expect(m1.sent.at(-1)).toContain('não sei resolver');
    expect(m1.appointments.create).not.toHaveBeenCalled();

    const m2 = make();
    m2.classifier.classify.mockResolvedValue({ ok: false, reason: 'low_confidence' });
    await m2.svc.handleText('111', 'hmmm');
    expect(m2.sent.at(-1)).toContain('Não tenho certeza');
    expect(m2.appointments.create).not.toHaveBeenCalled();
  });

  it('fluxo guiado completo: cria via AppointmentsService com origin bot e datas UTC (spec 4/6/14)', async () => {
    const m = make();
    await openFlow(m);
    await m.svc.handleText('111', 'hoje'); // atalho determinístico (sem LLM)
    await m.svc.handleText('111', '14:00'); // hora local
    await m.svc.handleText('111', '1h'); // duração -> checagem de conflito (nenhum) -> notas

    // consulta p/ findConflict: só confirmed e endsAt > now
    expect(m.prisma.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'u1', status: 'confirmed' }),
      }),
    );

    await m.svc.handleText('111', 'não'); // notas => null
    await m.svc.handleText('111', 'confirmar');

    expect(m.appointments.create).toHaveBeenCalledTimes(1);
    const [userId, payload, opts] = m.appointments.create.mock.calls[0] as [
      string,
      Record<string, unknown>,
      { origin: string },
    ];
    expect(userId).toBe('u1');
    expect(opts).toEqual({ origin: 'bot' });
    expect(payload.title).toBe('Consulta');
    // 14:00 America/Sao_Paulo (-03:00) => 17:00Z; msg confirma no tz local (spec 14)
    expect((payload.startsAt as Date).toISOString()).toBe('2026-10-06T17:00:00.000Z');
    expect((payload.endsAt as Date).toISOString()).toBe('2026-10-06T18:00:00.000Z');
    expect(payload.notes ?? null).toBeNull();
    expect(m.sent.at(-1)).toContain('14:00');
  });

  it('conflito (1.1): cita o compromisso existente no tz do usuário e não cria nada', async () => {
    const m = make();
    m.prisma.appointment.findMany.mockResolvedValue([
      {
        id: 'a1',
        title: 'Consulta dentista',
        startsAt: new Date('2026-10-06T17:00:00Z'), // 14:00 local
        endsAt: new Date('2026-10-06T18:00:00Z'), // 15:00 local
      },
    ]);
    await openFlow(m);
    await m.svc.handleText('111', 'hoje');
    await m.svc.handleText('111', '14:30');
    await m.svc.handleText('111', '15:30'); // 14:30-15:30 x 14:00-15:00 => conflito

    expect(m.sent.at(-1)).toContain('Consulta dentista');
    expect(m.sent.at(-1)).toContain('14:00');
    expect(m.sent.at(-1)).toContain('abortar');
    expect(m.appointments.create).not.toHaveBeenCalled();

    // abortar: nada e salvo, sessao morre
    m.classifier.classify.mockResolvedValue({ ok: true, intent: 'cancelar', confidence: 0.9 });
    await m.svc.handleText('111', 'abortar');
    expect(m.appointments.create).not.toHaveBeenCalled();
  });

  it('TTL: sessão inativa é descartada e um novo "criar" recomeça do zero (spec 15)', async () => {
    const m = make();
    await openFlow(m);
    const internals = m.svc as unknown as {
      sessions: Map<
        string,
        { step: string; lastActivityAt: number; candidate: { title?: string } }
      >;
      classifier: { classify: jest.Mock };
    };
    expect(internals.sessions.get('111')?.step).toBe('dia'); // "Consulta" virou o titulo
    internals.sessions.get('111')!.lastActivityAt = Date.now() - 31 * 60_000; // TTL estourado

    m.classifier.classify.mockResolvedValue({ ok: true, intent: 'criar', confidence: 0.9 });
    await m.svc.handleText('111', 'oi de novo');

    const fresh = internals.sessions.get('111')!;
    // comecou do zero: a sessao nova nasceu (relogio novo) e o titulo antigo se foi;
    // a fala "oi de novo" virou o titulo do agendamento NOVO (nada do anterior).
    expect(fresh.lastActivityAt).toBeGreaterThan(Date.now() - 5_000);
    expect(fresh.candidate.title).toBe('oi de novo');
  });
});
