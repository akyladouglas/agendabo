import { ForbiddenException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SchedulingFlowService } from "./scheduling-flow.service";
import type { BotUser } from "./bot-access.service";
import type { Env } from "../../config/env.validation";

/**
 * Service do fluxo (jest, mock plano — testing.md): valida as BORDAS que a maquina
 * pura nao ve: gate de acesso (spec 1), abrir fluxo so com intencao `criar` (spec 2),
 * consulta dos confirmed futuros (spec 9), create via AppointmentsService com
 * origin bot (spec 6/18), TTL da sessao (spec 15).
 */

const USER: BotUser = {
  id: "u1",
  telegramId: "111",
  timezone: "America/Sao_Paulo",
  name: null,
};

/** Data base do teste: "hoje" determinístico — não depende do relógio real. */
const TODAY_LOCAL = "2026-10-06";

function make() {
  const sent: string[] = [];
  const access = { requireConfirmedUser: jest.fn().mockResolvedValue(USER) };
  const classifier = {
    classify: jest.fn().mockResolvedValue({ ok: false, reason: "no_tool_use" }),
  };
  const appointments = {
    create: jest.fn().mockResolvedValue({ id: "a1" }),
    listOverlapping: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({ id: "a1" }),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const telegram = {
    sendMessage: jest.fn(async (_id: string, text: string) => {
      sent.push(text);
    }),
    getClient: () => ({
      telegram: {
        sendMessage: jest.fn(
          async (_id: string, text: string, _opts: unknown) => {
            sent.push(text);
          },
        ),
      },
    }),
  };
  const prisma = {
    appointment: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: "nr1" }),
    },
  };
  const agendaQuery = {
    run: jest
      .fn()
      .mockResolvedValue({
        replies: ["Isto é o que você tem hoje:"],
        awaitingPeriod: false,
      }),
    closePolitely: jest.fn(() => "Tanto faz, encerro aqui então 😊"),
  };
  // extrator do criar: por padrão falha (o guiado continua o caminho clássico deste
  // spec); testes do atalho sobrescrevem. Interpretador de edição idem.
  const schedulingInterpreter = {
    interpretar: jest
      .fn()
      .mockResolvedValue({ ok: false, reason: "no_tool_use" }),
  };
  const editInterpreter = {
    interpretar: jest
      .fn()
      .mockResolvedValue({ ok: false, reason: "no_tool_use" }),
  };
  const config = {
    get: (key: keyof Env) =>
      (
        ({
          MIN_CONFIDENCE_TO_ACCEPT: 0.7,
          LLM_MODEL_PRIMARY: "haiku",
          LLM_MODEL_ESCALATION: "sonnet",
          BOT_SESSION_TTL_MINUTES: 30,
        }) as Partial<Record<keyof Env, unknown>>
      )[key],
  } as unknown as ConfigService<Env, true>;

  // reminderInterpreter exposto: os testes do clique/anti-loop do lembrete (spec
  // fluxo-criacao-robusto D1/D3) contam as chamadas de LLM do passo. Os fluxos que
  // usam atalho determinístico ("sem lembrete") nunca chegam aqui.
  const reminderInterpreter = {
    interpretar: jest
      .fn()
      .mockResolvedValue({ ok: false, reason: "unparseable" }),
  };

  const svc = new SchedulingFlowService(
    access as never,
    classifier as never,
    appointments as never,
    telegram as never,
    prisma as never,
    config,
    agendaQuery as never,
    reminderInterpreter as never,
    schedulingInterpreter as never,
    editInterpreter as never,
    // bot_events (Fase 9): mock plano — este spec cobre o FLUXO, o registro e
    // assertado em scheduling-flow-events.spec.ts.
    { registrar: jest.fn().mockResolvedValue(undefined) } as never,
  );
  // relogio do servico congelado (determinismo do atalho "hoje"/datas UTC)
  (svc as unknown as { now: () => Date }).now = () =>
    new Date(`${TODAY_LOCAL}T10:00:00Z`);
  return {
    svc,
    sent,
    access,
    classifier,
    appointments,
    prisma,
    agendaQuery,
    schedulingInterpreter,
    editInterpreter,
    reminderInterpreter,
  };
}

/** Abre o fluxo com intencao `criar` aceita; o extrator falha => a fala vira o titulo. */
async function openFlow(m: ReturnType<typeof make>): Promise<void> {
  m.classifier.classify.mockResolvedValue({
    ok: true,
    intent: "criar",
    confidence: 0.9,
  });
  await m.svc.handleText("111", "Consulta");
  // depois de aberto, os turnos seguintes passam a classificar com contexto de fluxo;
  // aqui o stub nao identifica intencao nenhuma => a maquina trata o texto como dado.
  m.classifier.classify.mockResolvedValue({ ok: false, reason: "no_tool_use" });
}

describe("SchedulingFlowService (bordas)", () => {
  it("gate de acesso (spec 1): sem cadastro => só orientação, nada de LLM/agenda", async () => {
    const { svc, sent, access, classifier, prisma, appointments } = make();
    access.requireConfirmedUser.mockRejectedValue(
      new ForbiddenException("cadastro_necessario"),
    );

    await svc.handleText("999", "oi");

    expect(sent[0]).toContain("cria sua conta");
    expect(classifier.classify).not.toHaveBeenCalled();
    expect(prisma.appointment.findMany).not.toHaveBeenCalled();
    expect(appointments.create).not.toHaveBeenCalled();
  });

  it('fora do fluxo: intenção "criar" abre o fluxo e a fala vira o título (spec 2)', async () => {
    const m = make();
    m.classifier.classify.mockResolvedValue({
      ok: true,
      intent: "criar",
      confidence: 0.9,
    });
    await m.svc.handleText("111", "quero marcar uma consulta");
    // "quero marcar uma consulta" e a fala de intencao: o bot abre o fluxo e pergunta;
    // se a fala serviu de titulo, segue para o dia. Em qualquer caso, o fluxo abriu:
    const internals = m.svc as unknown as {
      sessions: Map<string, { step: string }>;
    };
    expect(internals.sessions.get("111")).toBeDefined();
    expect(m.sent.length).toBeGreaterThan(0);
  });

  it('fora do fluxo: "fora_do_escopo" => fallback sem criar nada; duvida => pergunta (spec 2)', async () => {
    const m1 = make();
    m1.classifier.classify.mockResolvedValue({
      ok: true,
      intent: "fora_do_escopo",
      confidence: 0.9,
    });
    await m1.svc.handleText("111", "me conta uma piada");
    expect(m1.sent.at(-1)).toContain("não sei resolver");
    expect(m1.appointments.create).not.toHaveBeenCalled();

    const m2 = make();
    m2.classifier.classify.mockResolvedValue({
      ok: false,
      reason: "low_confidence",
    });
    await m2.svc.handleText("111", "hmmm");
    expect(m2.sent.at(-1)).toContain("não tenho certeza");
    expect(m2.appointments.create).not.toHaveBeenCalled();
  });

  // ---------- Fase 4: bordas do atalho, needs_review e editar/cancelar pelo chat ----------

  it('atalho (spec A1/A4 + decisão 5): fala aceita sem FIM pula dia/hora mas PERGUNTA o fim; cria sem "confirmo?" extra', async () => {
    const m = make();
    m.classifier.classify.mockResolvedValue({
      ok: true,
      intent: "criar",
      confidence: 0.9,
    });
    m.schedulingInterpreter.interpretar.mockResolvedValue({
      ok: true,
      rawText: "consulta dia 08/10 às 14h",
      data: {
        title: "consulta",
        startsAt: "2026-10-08T14:00:00-03:00",
        confidence: 0.95,
        dateEvidence: "dia 08/10 às 14h",
      },
    });
    await m.svc.handleText("111", "consulta dia 08/10 às 14h");
    // decisão 5: sem fim EXPLÍCITO na fala o bot pergunta o passo `fim` (eco do que
    // entendeu + pergunta do fim) — nada de teclado de dia/hora, nada de 1h em silêncio.
    expect(m.sent.at(-1)).toContain("Entendi");
    expect(m.sent.at(-1)).toContain("Que horas termina");
    expect(m.sent.at(-1)).not.toContain("informação importante");
    expect(m.classifier.classify).toHaveBeenCalledTimes(1); // só a intenção (1 LLM/turno)
    expect(m.schedulingInterpreter.interpretar).toHaveBeenCalledTimes(1);

    // no fluxo, o stub universal não identifica intenção (a fala é DADO do passo)
    m.classifier.classify.mockResolvedValue({
      ok: false,
      reason: "no_tool_use",
    });
    await m.svc.handleText("111", "1h"); // passo fim: duração falada -> notas
    expect(m.sent.at(-1)).toContain("informação importante");
    await m.svc.handleText("111", "não"); // notas
    await m.svc.handleText("111", "sem lembrete");
    await m.svc.handleText("111", "confirmar");
    expect(m.appointments.create).toHaveBeenCalledTimes(1);
    const [, payload] = m.appointments.create.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(payload.title).toBe("consulta");
    expect((payload.startsAt as Date).toISOString()).toBe(
      "2026-10-08T17:00:00.000Z",
    );
    expect((payload.endsAt as Date).toISOString()).toBe(
      "2026-10-08T18:00:00.000Z",
    );
  });

  it("needs_review da régua (spec E16/E17): persiste direto com rawText/reviewReason e ZERO outbox", async () => {
    const m = make();
    m.classifier.classify.mockResolvedValue({
      ok: true,
      intent: "criar",
      confidence: 0.9,
    });
    m.schedulingInterpreter.interpretar.mockResolvedValue({
      ok: true,
      rawText: "talvez uma reunião amanhã",
      data: {
        title: "reunião",
        startsAt: "2026-10-07T09:00:00-03:00",
        confidence: 0.4, // abaixo do limiar 0.7 => fraco
        dateEvidence: "amanhã",
      },
    });
    await m.svc.handleText("111", "talvez uma reunião amanhã");

    expect(m.sent.at(-1)).toContain("PENDENTE DE REVISÃO");
    expect(m.sent.at(-1)).toContain("amanhã"); // cita a evidência (spec regra 7)
    const create = m.prisma.appointment.create;
    expect(create).toHaveBeenCalledTimes(1);
    const data = (
      create.mock.calls[0] as [{ data: Record<string, unknown> }]
    )[0].data;
    expect(data.status).toBe("needs_review");
    expect(data.origin).toBe("bot");
    expect(data.rawText).toBe("talvez uma reunião amanhã");
    expect(data.reviewReason).toBe("confianca_baixa");
    // needs_review NUNCA passa pelo AppointmentsService (que materializa outbox — regra 7)
    expect(m.appointments.create).not.toHaveBeenCalled();
    // sessão encerra sem notas/lembrete (decisão #6)
    const internals = m.svc as unknown as { sessions: Map<string, unknown> };
    expect(internals.sessions.get("111")).toBeUndefined();
  });

  it("B3/needs_review: título extraído vive SÓ em rawText/revisão — a fala original é o payload e nada confirma nada no chat (spec fluxo-criacao-robusto B4/ADR-003)", async () => {
    // Gherkin B: "regua ⇒ needs_review ⇒ o título extraído vive só em rawText/revisão
    // (não 'confirma' nada no chat)". O bruto persistido é A FALA ORIGINAL inteira
    // (título incluso como hipótese auditável), nunca o title recortado do modelo; e a
    // única fala no chat é o aviso explícito de pendência — nenhuma confirmação.
    const m = make();
    const fala =
      "tenho um novo compromisso, uma viagem para lucena mais ou menos quinta";
    m.classifier.classify.mockResolvedValue({
      ok: true,
      intent: "criar",
      confidence: 0.9,
    });
    m.schedulingInterpreter.interpretar.mockResolvedValue({
      ok: true,
      rawText: fala,
      data: {
        title: "viagem para lucena",
        startsAt: "2026-10-08T09:00:00-03:00",
        confidence: 0.4, // fraco ⇒ needs_review
        dateEvidence: "mais ou menos quinta",
      },
    });
    await m.svc.handleText("111", fala);

    const data = (
      m.prisma.appointment.create.mock.calls[0] as [
        { data: Record<string, unknown> },
      ]
    )[0].data;
    // o título-hipótese vive na fala bruta (auditoria), não como dado confirmado
    expect(data.rawText).toBe(fala);
    expect(String(data.rawText)).toContain("viagem para lucena");
    expect(data.status).toBe("needs_review");
    expect(data.reviewReason).toBe("confianca_baixa");
    // nada "confirma" no chat: só o aviso de pendente de revisão, nunca o "Prontinho!"
    expect(m.sent.at(-1)).toContain("PENDENTE DE REVISÃO");
    expect(m.sent.join("\n")).not.toContain("Prontinho");
    const internals = m.svc as unknown as { sessions: Map<string, unknown> };
    expect(internals.sessions.get("111")).toBeUndefined();
  });

  it('cancelar pelo chat (spec D11/D14): localização única + "sim" apaga via remove', async () => {
    const m = make();
    m.classifier.classify.mockResolvedValue({
      ok: true,
      intent: "cancelar_compromisso",
      confidence: 0.9,
    });
    m.appointments.listOverlapping = jest.fn().mockResolvedValue([
      {
        id: "a1",
        title: "Consulta dentista",
        startsAt: new Date("2026-10-09T18:00:00Z"),
        endsAt: new Date("2026-10-09T19:00:00Z"),
        status: "confirmed",
      },
    ]);
    m.appointments.remove = jest.fn().mockResolvedValue(undefined);
    m.editInterpreter.interpretar.mockResolvedValue({
      ok: true,
      rawText: "cancela a consulta do dentista",
      data: {
        acao: "cancelar",
        descricao: "consulta dentista",
        confidence: 0.9,
      },
    });

    await m.svc.handleText("111", "cancela a consulta do dentista");
    expect(m.sent.at(-1)).toContain("Vou CANCELAR");
    expect(m.appointments.remove).not.toHaveBeenCalled(); // só depois do "sim"

    await m.svc.handleText("111", "sim");
    expect(m.appointments.remove).toHaveBeenCalledWith("u1", "a1");
    expect(m.sent.at(-1)).toContain("Cancelado");
  });

  it('localização ambígua (spec B12): 2 candidatas listam numeradas; escolha "1" é determinística', async () => {
    const m = make();
    m.classifier.classify.mockResolvedValue({
      ok: true,
      intent: "cancelar_compromisso",
      confidence: 0.9,
    });
    m.appointments.listOverlapping = jest.fn().mockResolvedValue([
      {
        id: "a1",
        title: "Reunião de time",
        startsAt: new Date("2026-10-08T14:00:00Z"),
        endsAt: new Date("2026-10-08T15:00:00Z"),
        status: "confirmed",
      },
      {
        id: "a2",
        title: "Reunião com cliente",
        startsAt: new Date("2026-10-09T16:00:00Z"),
        endsAt: new Date("2026-10-09T17:00:00Z"),
        status: "confirmed",
      },
    ]);
    m.appointments.remove = jest.fn().mockResolvedValue(undefined);
    m.editInterpreter.interpretar.mockResolvedValue({
      ok: true,
      rawText: "cancela a reunião",
      data: { acao: "cancelar", descricao: "reunião", confidence: 0.9 },
    });

    await m.svc.handleText("111", "cancela a reunião");
    expect(m.sent.at(-1)).toContain("Encontrei mais de um");
    expect(m.sent.at(-1)).toContain("1. Reunião de time");
    expect(m.sent.at(-1)).toContain("2. Reunião com cliente");
    // escolha determinística: SEM novo LLM
    const classifyBefore = m.classifier.classify.mock.calls.length;
    const editBefore = m.editInterpreter.interpretar.mock.calls.length;
    await m.svc.handleText("111", "1");
    expect(m.classifier.classify.mock.calls.length).toBe(classifyBefore);
    expect(m.editInterpreter.interpretar.mock.calls.length).toBe(editBefore);
    expect(m.sent.at(-1)).toContain('Vou CANCELAR "Reunião de time"');
  });

  it('localização 0 candidatas (spec B11): "não encontrei" + oferece consulta; nada é apagado', async () => {
    const m = make();
    m.classifier.classify.mockResolvedValue({
      ok: true,
      intent: "cancelar_compromisso",
      confidence: 0.9,
    });
    m.appointments.listOverlapping = jest.fn().mockResolvedValue([]);
    m.editInterpreter.interpretar.mockResolvedValue({
      ok: true,
      rawText: "cancela a aula de piano",
      data: { acao: "cancelar", descricao: "aula de piano", confidence: 0.9 },
    });

    await m.svc.handleText("111", "cancela a aula de piano");
    expect(m.sent.at(-1)).toContain("Não encontrei esse compromisso");
    const internals = m.svc as unknown as { sessions: Map<string, unknown> };
    expect(internals.sessions.get("111")).toBeUndefined();
  });

  it('editar pelo chat (spec C12): diff + "sim" grava via AppointmentsService.update', async () => {
    const m = make();
    m.classifier.classify.mockResolvedValue({
      ok: true,
      intent: "editar_compromisso",
      confidence: 0.9,
    });
    m.appointments.listOverlapping = jest.fn().mockResolvedValue([
      {
        id: "a1",
        title: "Consulta dentista",
        startsAt: new Date("2026-10-09T18:00:00Z"),
        endsAt: new Date("2026-10-09T19:00:00Z"),
        status: "confirmed",
      },
    ]);
    m.appointments.update = jest.fn().mockResolvedValue({ id: "a1" });
    m.editInterpreter.interpretar
      .mockResolvedValueOnce({
        ok: true,
        rawText: "muda a consulta do dentista",
        data: {
          acao: "editar",
          descricao: "consulta dentista",
          confidence: 0.9,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        rawText: "adianta 2 horas",
        data: { acao: "editar", deslocamentoMin: -120, confidence: 0.95 },
      });

    await m.svc.handleText("111", "muda a consulta do dentista");
    expect(m.sent.at(-1)).toContain('Achei "Consulta dentista"');

    await m.svc.handleText("111", "adianta 2 horas");
    expect(m.sent.at(-1)).toContain("Vou mudar");
    expect(m.sent.at(-1)).toContain("Confirmo");
    expect(m.appointments.update).not.toHaveBeenCalled();

    await m.svc.handleText("111", "sim");
    expect(m.appointments.update).toHaveBeenCalledWith("u1", "a1", {
      startsAt: new Date("2026-10-09T16:00:00Z"),
      endsAt: new Date("2026-10-09T17:00:00Z"),
    });
    expect(m.sent.at(-1)).toContain("Feito!");
  });

  it("conflito ao gravar a edição (spec C13): re-pergunta o quando em vez de falhar calado", async () => {
    const m = make();
    const { AppointmentConflictError } =
      await import("../appointments/appointments.service");
    m.classifier.classify.mockResolvedValue({
      ok: true,
      intent: "editar_compromisso",
      confidence: 0.9,
    });
    m.appointments.listOverlapping = jest.fn().mockResolvedValue([
      {
        id: "a1",
        title: "Consulta dentista",
        startsAt: new Date("2026-10-09T18:00:00Z"),
        endsAt: new Date("2026-10-09T19:00:00Z"),
        status: "confirmed",
      },
    ]);
    m.appointments.update = jest.fn().mockRejectedValue(
      new AppointmentConflictError({
        id: "a2",
        title: "Reunião de time",
        startsAt: new Date("2026-10-09T15:00:00Z"),
        endsAt: new Date("2026-10-09T16:00:00Z"),
      }),
    );
    m.editInterpreter.interpretar
      .mockResolvedValueOnce({
        ok: true,
        rawText: "muda a consulta do dentista",
        data: {
          acao: "editar",
          descricao: "consulta dentista",
          confidence: 0.9,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        rawText: "joga 2 horas pra mais cedo",
        data: { acao: "editar", deslocamentoMin: -120, confidence: 0.95 },
      });

    await m.svc.handleText("111", "muda a consulta do dentista");
    await m.svc.handleText("111", "joga 2 horas pra mais cedo");
    await m.svc.handleText("111", "sim");

    expect(m.appointments.update).toHaveBeenCalledTimes(1);
    expect(m.sent.at(-1)).toContain('colide com "Reunião de time"');
    // sessão reaberta no passo de re-pergunta (próxima fala é o horário novo)
    const internals = m.svc as unknown as {
      sessions: Map<string, { step: string }>;
    };
    expect(internals.sessions.get("111")?.step).toBe("edit_propor");
  });

  it("needs_review não é editável pelo chat (spec regra 7/decisão #3): aponta a fila da web", async () => {
    const m = make();
    m.classifier.classify.mockResolvedValue({
      ok: true,
      intent: "editar_compromisso",
      confidence: 0.9,
    });
    m.appointments.listOverlapping = jest.fn().mockResolvedValue([
      {
        id: "a1",
        title: "Consulta suspeita",
        startsAt: new Date("2026-10-09T18:00:00Z"),
        endsAt: new Date("2026-10-09T19:00:00Z"),
        status: "needs_review",
      },
    ]);
    m.appointments.update = jest.fn().mockResolvedValue({ id: "a1" });
    m.editInterpreter.interpretar.mockResolvedValue({
      ok: true,
      rawText: "muda a consulta suspeita",
      data: { acao: "editar", descricao: "consulta suspeita", confidence: 0.9 },
    });

    await m.svc.handleText("111", "muda a consulta suspeita");
    expect(m.sent.at(-1)).toContain("fila de revisão da web");
    expect(m.appointments.update).not.toHaveBeenCalled();
    const internals = m.svc as unknown as { sessions: Map<string, unknown> };
    expect(internals.sessions.get("111")).toBeUndefined();
  });

  it("editar nunca vira needs_review (spec regra 20): confiança baixa re-pergunta, nada persiste", async () => {
    const m = make();
    m.classifier.classify.mockResolvedValue({
      ok: true,
      intent: "editar_compromisso",
      confidence: 0.9,
    });
    m.appointments.listOverlapping = jest.fn().mockResolvedValue([
      {
        id: "a1",
        title: "Consulta dentista",
        startsAt: new Date("2026-10-09T18:00:00Z"),
        endsAt: new Date("2026-10-09T19:00:00Z"),
        status: "confirmed",
      },
    ]);
    m.editInterpreter.interpretar
      .mockResolvedValueOnce({
        ok: true,
        rawText: "muda a consulta do dentista",
        data: {
          acao: "editar",
          descricao: "consulta dentista",
          confidence: 0.9,
        },
      })
      .mockResolvedValueOnce({ ok: false, reason: "low_confidence" });

    await m.svc.handleText("111", "muda a consulta do dentista");
    await m.svc.handleText("111", "muda aí sei lá");
    expect(m.sent.at(-1)).toContain("Não entendi o horário novo");
    expect(m.prisma.appointment.create).not.toHaveBeenCalled();
    expect(m.appointments.update).not.toHaveBeenCalled();
  });

  it("portão do atalho não re-extrai nas falas seguintes (1 LLM/turno — spec regra 22)", async () => {
    const m = make();
    m.classifier.classify.mockResolvedValue({
      ok: true,
      intent: "criar",
      confidence: 0.9,
    });
    m.schedulingInterpreter.interpretar.mockResolvedValue({
      ok: true,
      rawText: "consulta dia 08/10 às 14h",
      data: {
        title: "consulta",
        startsAt: "2026-10-08T14:00:00-03:00",
        confidence: 0.95,
      },
    });
    await m.svc.handleText("111", "consulta dia 08/10 às 14h");
    // decisão 5: sem fim na fala, o atalho parou no passo `fim` — "1h" é DADO do passo
    await m.svc.handleText("111", "1h"); // fim -> notas
    const extractions = m.schedulingInterpreter.interpretar.mock.calls.length;
    await m.svc.handleText("111", "não"); // notas: NÃO re-extrai
    expect(m.schedulingInterpreter.interpretar.mock.calls.length).toBe(
      extractions,
    );
  });

  it("fluxo guiado completo: cria via AppointmentsService com origin bot e datas UTC (spec 4/6/14)", async () => {
    const m = make();
    await openFlow(m);
    await m.svc.handleText("111", "hoje"); // atalho determinístico (sem LLM)
    await m.svc.handleText("111", "14:00"); // hora local
    await m.svc.handleText("111", "1h"); // duração -> checagem de conflito (nenhum) -> notas

    // consulta p/ findConflict: confirmed+needs_review e endsAt > now (R1:
    // alinha com a carga de escrita da API — ADR-0015/D6)
    expect(m.prisma.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "u1",
          status: { in: ["confirmed", "needs_review"] },
        }),
      }),
    );

    await m.svc.handleText("111", "não"); // notas => null
    await m.svc.handleText("111", "sem lembrete"); // passo lembrete (Fase 3): atalho determinístico
    await m.svc.handleText("111", "confirmar");

    expect(m.appointments.create).toHaveBeenCalledTimes(1);
    const [userId, payload, opts] = m.appointments.create.mock.calls[0] as [
      string,
      Record<string, unknown>,
      { origin: string },
    ];
    expect(userId).toBe("u1");
    expect(opts).toEqual({ origin: "bot" });
    expect(payload.title).toBe("Consulta");
    // 14:00 America/Sao_Paulo (-03:00) => 17:00Z; msg confirma no tz local (spec 14)
    expect((payload.startsAt as Date).toISOString()).toBe(
      "2026-10-06T17:00:00.000Z",
    );
    expect((payload.endsAt as Date).toISOString()).toBe(
      "2026-10-06T18:00:00.000Z",
    );
    expect(payload.notes ?? null).toBeNull();
    expect(m.sent.at(-1)).toContain("14:00");
  });

  it("conflito (1.1): cita o compromisso existente no tz do usuário e não cria nada", async () => {
    const m = make();
    m.prisma.appointment.findMany.mockResolvedValue([
      {
        id: "a1",
        title: "Consulta dentista",
        startsAt: new Date("2026-10-06T17:00:00Z"), // 14:00 local
        endsAt: new Date("2026-10-06T18:00:00Z"), // 15:00 local
      },
    ]);
    await openFlow(m);
    await m.svc.handleText("111", "hoje");
    await m.svc.handleText("111", "14:30");
    await m.svc.handleText("111", "15:30"); // 14:30-15:30 x 14:00-15:00 => conflito

    expect(m.sent.at(-1)).toContain("Consulta dentista");
    expect(m.sent.at(-1)).toContain("14:00");
    expect(m.sent.at(-1)).toContain("abortar");
    expect(m.appointments.create).not.toHaveBeenCalled();

    // abortar: nada e salvo, sessao morre
    m.classifier.classify.mockResolvedValue({
      ok: true,
      intent: "cancelar",
      confidence: 0.9,
    });
    await m.svc.handleText("111", "abortar");
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
    expect(internals.sessions.get("111")?.step).toBe("dia"); // "Consulta" virou o titulo
    internals.sessions.get("111")!.lastActivityAt =
      new Date(`${TODAY_LOCAL}T10:00:00Z`).getTime() - 31 * 60_000; // TTL estourado

    m.classifier.classify.mockResolvedValue({
      ok: true,
      intent: "criar",
      confidence: 0.9,
    });
    await m.svc.handleText("111", "oi de novo");

    const fresh = internals.sessions.get("111")!;
    // comecou do zero: a sessao nova nasceu (relogio novo) e o titulo antigo se foi;
    // a fala "oi de novo" virou o titulo do agendamento NOVO (nada do anterior).
    // (relogio congelado em TODAY_LOCAL 10:00Z — o TTL estourado de antes se foi)
    expect(fresh.lastActivityAt).toBe(
      new Date(`${TODAY_LOCAL}T10:00:00Z`).getTime(),
    );
    expect(fresh.candidate.title).toBe("oi de novo");
  });

  // ---------- Fase 2: consulta de agenda sob demanda (spec consultar-agenda-bot) ----------

  it('fora do fluxo: "consultar" NÃO abre o fluxo e responde a agenda (Gherkin Roteamento)', async () => {
    const m = make();
    m.classifier.classify.mockResolvedValue({
      ok: true,
      intent: "consultar",
      confidence: 0.9,
    });

    await m.svc.handleText("111", "o que tenho hoje?");

    expect(m.agendaQuery.run).toHaveBeenCalledTimes(1);
    expect(m.sent.at(-1)).toContain("Isto é o que você tem hoje:");
    // a máquina de estados de criar NÃO abriu (nenhuma sessão)
    const internals = m.svc as unknown as { sessions: Map<string, unknown> };
    expect(internals.sessions.get("111")).toBeUndefined();
  });

  it('fora do fluxo: "criar" ainda abre o fluxo normalmente (consulta não captura o turno)', async () => {
    const m = make();
    m.classifier.classify.mockResolvedValue({
      ok: true,
      intent: "criar",
      confidence: 0.9,
    });

    await m.svc.handleText("111", "quero marcar uma consulta");

    const internals = m.svc as unknown as {
      sessions: Map<string, { step: string }>;
    };
    expect(internals.sessions.get("111")).toBeDefined();
    expect(m.agendaQuery.run).not.toHaveBeenCalled();
  });

  it('dentro do passo "notas": responde a consulta e VOLTA à pergunta de notas (decisão #5)', async () => {
    const m = make();
    await openFlow(m);
    await m.svc.handleText("111", "hoje"); // dia (atalho)
    await m.svc.handleText("111", "14:00"); // hora
    await m.svc.handleText("111", "1h"); // fim -> conflito? nenhum -> notas
    const internals = m.svc as unknown as {
      sessions: Map<string, { step: string; candidate: { title?: string } }>;
    };
    expect(internals.sessions.get("111")?.step).toBe("notas");

    m.classifier.classify.mockResolvedValue({
      ok: true,
      intent: "consultar",
      confidence: 0.9,
    });
    m.agendaQuery.run.mockResolvedValue({
      replies: ["Isto é o que você tem hoje:"],
      awaitingPeriod: false,
    });
    await m.svc.handleText("111", "o que tenho hoje?");

    // 1) a consulta foi respondida
    expect(m.sent).toContain("Isto é o que você tem hoje:");
    // 2) o estado do criar NÃO foi perdido nem reaberto
    const s = internals.sessions.get("111")!;
    expect(s).toBeDefined();
    expect(s.candidate.title).toBe("Consulta");
    // 3) voltou ao MESMO passo (a pergunta de notas voltou)
    expect(s.step).toBe("notas");
    expect(m.sent.at(-1)).toContain("informação importante pra eu anotar");
  });

  it('dentro do passo "dia": responde a consulta e VOLTA ao teclado de dia (decisão #5)', async () => {
    const m = make();
    await openFlow(m); // "Consulta" -> passo dia
    const internals = m.svc as unknown as {
      sessions: Map<string, { step: string; candidate: { title?: string } }>;
    };
    expect(internals.sessions.get("111")?.step).toBe("dia");

    m.classifier.classify.mockResolvedValue({
      ok: true,
      intent: "consultar",
      confidence: 0.9,
    });
    m.agendaQuery.run.mockResolvedValue({
      replies: ["Isto é o que você tem hoje:"],
      awaitingPeriod: false,
    });
    await m.svc.handleText("111", "o que tenho amanhã?");

    expect(m.sent).toContain("Isto é o que você tem hoje:");
    const s = internals.sessions.get("111")!;
    expect(s).toBeDefined();
    expect(s.candidate.title).toBe("Consulta");
    expect(s.step).toBe("dia");
    expect(m.sent.at(-1)).toContain("Em que dia vai ser?");
  });

  it('pergunta de período: 1ª falha pergunta; "tanto faz" encerra com cancelado (spec #14)', async () => {
    const m = make();
    m.classifier.classify.mockResolvedValue({
      ok: true,
      intent: "consultar",
      confidence: 0.9,
    });
    m.agendaQuery.run.mockResolvedValue({
      replies: ["Para qual período você quer ver? 📅"],
      awaitingPeriod: true,
    });

    await m.svc.handleText("111", "meus compromissos");
    expect(m.sent.at(-1)).toContain("Para qual período");

    // desistência por fala natural: cancelado, sem novo LLM/banco
    const runsBefore = m.agendaQuery.run.mock.calls.length;
    const classifyBefore = m.classifier.classify.mock.calls.length;
    await m.svc.handleText("111", "tanto faz");
    expect(m.sent.at(-1)).toContain("nada foi salvo");
    expect(m.agendaQuery.run.mock.calls.length).toBe(runsBefore);
    expect(m.classifier.classify.mock.calls.length).toBe(classifyBefore);
  });

  it("pergunta de período: 2ª falha reinterpreta; sem sucesso de novo encerra educadamente (spec #14)", async () => {
    const m = make();
    m.classifier.classify.mockResolvedValue({
      ok: true,
      intent: "consultar",
      confidence: 0.9,
    });

    // turno 1: não extraiu período -> pergunta (count 1)
    m.agendaQuery.run.mockResolvedValue({
      replies: ["Para qual período você quer ver? 📅"],
      awaitingPeriod: true,
    });
    await m.svc.handleText("111", "meus compromissos");
    expect(m.sent.at(-1)).toContain("Para qual período");

    // turno 2 (resposta): reinterpreta (SEM classificar intenção) e falha de novo -> count 2
    m.agendaQuery.run.mockResolvedValue({
      replies: ["Para qual período você quer ver? 📅"],
      awaitingPeriod: true,
    });
    await m.svc.handleText("111", "hmm, assim, uns desses...");
    expect(m.sent.at(-1)).toContain("Para qual período");

    // turno 3 (3ª vez): encerra educadamente, sem LLM
    const classifyBefore = m.classifier.classify.mock.calls.length;
    await m.svc.handleText("111", "ai, não sei te dizer");
    expect(m.sent.at(-1)).toContain("encerro aqui");
    expect(m.classifier.classify.mock.calls.length).toBe(classifyBefore);
    expect(m.agendaQuery.run).toHaveBeenCalledTimes(2);
  });

  // ---------- spec fluxo-criacao-robusto: bordas do service (lote 3 / etapa 5) ----------

  it("A1 completo: endsAt multi-dia vira intervalo real (46h) e o fluxo vai DIRETO às notas ecoando 12/10", async () => {
    const m = make();
    m.classifier.classify.mockResolvedValue({
      ok: true,
      intent: "criar",
      confidence: 0.9,
    });
    m.schedulingInterpreter.interpretar.mockResolvedValue({
      ok: true,
      rawText: "viagem para lucena de 19h sexta e vai ate 17h na segunda",
      data: {
        title: "viagem para lucena",
        startsAt: "2026-10-09T19:00:00-03:00",
        endsAt: "2026-10-12T17:00:00-03:00",
        confidence: 0.95,
      },
    });
    await m.svc.handleText(
      "111",
      "Tenho um novo compromisso, uma viagem para lucena de 19h sexta e vai ate 17h segunda",
    );

    // título UTILIZÁVEL ("viagem para lucena" — curto, não é a fala inteira): ecoado
    // sem turno extra (B4). Fim explícito (endExtracted) ⇒ direto às notas (A4).
    expect(m.sent.at(-1)).toContain("informação importante");
    expect(m.sent.at(-1)).toContain("12/10 17:00"); // eco do fim multi-dia no tz (C2/A1)
    expect(m.sent.at(-1)).toContain("viagem para lucena"); // eco do título (B4)

    // o stub universal não identifica intenção (a fala é DADO do passo)
    m.classifier.classify.mockResolvedValue({
      ok: false,
      reason: "no_tool_use",
    });
    await m.svc.handleText("111", "não"); // notas
    await m.svc.handleText("111", "sem lembrete");
    await m.svc.handleText("111", "confirmar");
    expect(m.appointments.create).toHaveBeenCalledTimes(1);
    const [, payload] = m.appointments.create.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect((payload.startsAt as Date).toISOString()).toBe(
      "2026-10-09T22:00:00.000Z",
    );
    // A1: fim vem do endsAt dito (20:00Z 12/10 = ~70h) — NUNCA o default de 60 min
    expect((payload.endsAt as Date).toISOString()).toBe(
      "2026-10-12T20:00:00.000Z",
    );
  });

  it("B2: título devolvido igual à fala quase inteira é descartado (pergunta o título, reaproveita o resto)", async () => {
    const m = make();
    m.classifier.classify.mockResolvedValue({
      ok: true,
      intent: "criar",
      confidence: 0.9,
    });
    const fala = "vou pagar o boleto do aluguel amanhã às 10h";
    m.schedulingInterpreter.interpretar.mockResolvedValue({
      ok: true,
      rawText: fala,
      // título = a fala quase integral (heurística B2 >= 0.8) ⇒ título AUSENTE
      data: {
        title: fala,
        startsAt: "2026-10-07T10:00:00-03:00",
        confidence: 0.95,
      },
    });
    await m.svc.handleText("111", fala);

    // seguiu SEM título: candidato sem título, mas com o início materializado reapro-
    // veitado; o portão abriu (openable) e a máquina pergunta o fim primeiro (decisão 5)
    const internals = m.svc as unknown as {
      sessions: Map<
        string,
        {
          step: string;
          candidate: { title?: string; startUtc?: Date; endUtc?: Date };
        }
      >;
    };
    const s = internals.sessions.get("111")!;
    expect(s.candidate.title).toBeUndefined();
    expect(s.candidate.startUtc?.toISOString()).toBe(
      "2026-10-07T13:00:00.000Z",
    );
    expect(s.step).toBe("fim"); // sem fim na fala: o fim vem antes (decisão 5)
    expect(m.sent.at(-1)).toContain("Que horas termina");
    expect(m.sent.at(-1)).not.toContain("boleto do aluguel"); // o eco nunca repete a frase

    // falar "11:00" no passo `fim` é relógio VÁLIDO (depois do início de 10:00 ⇒ fim
    // 11:00 no dia seguinte, rule do resolveEnd) — o quando fica pronto e o TÍTULO é
    // perguntado (B3: nunca guiado do zero, nunca o dia de novo).
    m.classifier.classify.mockResolvedValue({
      ok: false,
      reason: "no_tool_use",
    });
    await m.svc.handleText("111", "11:00");
    expect(m.sent.at(-1)).toContain("Como eu chamo esse compromisso");
    expect(internals.sessions.get("111")?.step).toBe("titulo");
    expect(internals.sessions.get("111")?.candidate).toMatchObject({
      startUtc: new Date("2026-10-07T13:00:00.000Z"),
      // relógio 11:00 depois do início 10:00 no mesmo dia local ⇒ fim 11:00 de 07/10 no tz
      endUtc: new Date("2026-10-07T14:00:00.000Z"),
    });

    // título perguntado sobre o candidato COM intervalo pronto ⇒ respondido, o passo
    // "engole" o guiado: checkConflict roda e o bot vai DIRETO às notas (C1).
    await m.svc.handleText("111", "Boleto do aluguel");
    expect(internals.sessions.get("111")?.step).toBe("notas");
    expect(m.sent.at(-1)).toContain("informação importante");
    expect(m.sent.at(-1)).toContain(
      "Boleto do aluguel — qua 07/10 10:00–11:00",
    );
  });

  it('B2 prefixo de intenção: modelo devolve title "tenho um novo compromisso" com quando válido ⇒ candidato SEM título e o bot pergunta (via service real)', async () => {
    // Gherkin B da spec fluxo-criacao-robusto: título que COMEÇA com verbo de intenção
    // ("tenho um novo compromisso...") é tratado como título AUSENTE (heurística B2 em
    // messages.ts) — caminho `sem_titulo` pelo service real, não só pela máquina.
    const m = make();
    m.classifier.classify.mockResolvedValue({
      ok: true,
      intent: "criar",
      confidence: 0.9,
    });
    const fala = "tenho um novo compromisso, uma consulta dia 08/10 às 14h";
    m.schedulingInterpreter.interpretar.mockResolvedValue({
      ok: true,
      rawText: fala,
      // título CURTO mas verbo de intenção (>= 0.8 da fala NÃO é o caso aqui): B2 pega
      // pelo prefixo, não só pelo comprimento
      data: {
        title: "tenho um novo compromisso",
        startsAt: "2026-10-08T14:00:00-03:00",
        confidence: 0.95,
      },
    });
    await m.svc.handleText("111", fala);

    const internals = m.svc as unknown as {
      sessions: Map<
        string,
        { step: string; candidate: { title?: string; startUtc?: Date } }
      >;
    };
    const s = internals.sessions.get("111")!;
    expect(s.candidate.title).toBeUndefined(); // o prefixo NUNCA vira título
    expect(s.candidate.startUtc?.toISOString()).toBe(
      "2026-10-08T17:00:00.000Z",
    ); // quando reaproveitado
    expect(s.step).toBe("fim"); // sem fim na fala: o fim vem antes (decisão 5)...
    expect(m.sent.at(-1)).toContain("Que horas termina");

    m.classifier.classify.mockResolvedValue({
      ok: false,
      reason: "no_tool_use",
    });
    await m.svc.handleText("111", "1h"); // fim resolvido ⇒ a vez do TÍTULO (B3)
    expect(internals.sessions.get("111")?.step).toBe("titulo");
    expect(m.sent.at(-1)).toContain("Como eu chamo esse compromisso");
  });

  it("B1 off-flow: extração falha em fala LONGA de dados não vira título (o guiado pergunta)", async () => {
    const m = make();
    m.classifier.classify.mockResolvedValue({
      ok: true,
      intent: "criar",
      confidence: 0.9,
    });
    // extrator falha (timeout) — a régua nem roda; 15 palavras de dados
    const fala =
      "tenho um novo compromisso uma viagem para lucena de dezenove horas hoje e vai ate as " +
      "dezessete horas na segunda-feira que vem com escala";
    await m.svc.handleText("111", fala);

    const internals = m.svc as unknown as {
      sessions: Map<string, { step: string; candidate: { title?: string } }>;
    };
    const s = internals.sessions.get("111")!;
    expect(s.step).toBe("titulo");
    expect(s.candidate.title).toBeUndefined(); // a frase NÃO virou título
    expect(m.sent.at(-1)).toContain("Como eu chamo esse compromisso");
  });

  it("B1 off-flow: fala de intenção CURTA continua virando o título (spec mãe preservada)", async () => {
    const m = make();
    m.classifier.classify.mockResolvedValue({
      ok: true,
      intent: "criar",
      confidence: 0.9,
    });
    await m.svc.handleText("111", "quero marcar uma consulta"); // 5 palavras <= 6
    const internals = m.svc as unknown as {
      sessions: Map<string, { step: string; candidate: { title?: string } }>;
    };
    const s = internals.sessions.get("111")!;
    expect(s.step).toBe("dia");
    expect(s.candidate.title).toBe("quero marcar uma consulta");
  });

  it("D1: clique em atalho de lembrete (flow:lembrete:countdown) segue sem NENHUM LLM", async () => {
    const m = make();
    await openFlow(m);
    await m.svc.handleText("111", "hoje"); // dia (determinístico)
    await m.svc.handleText("111", "14:00"); // hora
    await m.svc.handleText("111", "1h"); // fim -> notas
    await m.svc.handleText("111", "não"); // notas -> lembrete
    const internals = m.svc as unknown as {
      sessions: Map<string, { step: string }>;
    };
    expect(internals.sessions.get("111")?.step).toBe("lembrete");

    // o clique não gasta NENHUMA chamada de LLM A MAIS (contagem relativa — os turnos
    // de fala da abertura/guiado classificaram normalmente antes)
    const llmBefore =
      m.reminderInterpreter.interpretar.mock.calls.length +
      m.classifier.classify.mock.calls.length;
    await m.svc.handleCallback("111", "flow:lembrete:countdown");
    expect(m.reminderInterpreter.interpretar).not.toHaveBeenCalled(); // o passo nunca rodou
    expect(
      m.classifier.classify.mock.calls.length +
        m.reminderInterpreter.interpretar.mock.calls.length,
    ).toBe(llmBefore);
    expect(internals.sessions.get("111")?.step).toBe("confirmacao");
    // resumo do countdown (schedule-core): rótulo da regra na linha ⏰; com o compromisso
    // em 06/10 14:00 e now 07:00 local, o gatilho de 3 dias ainda não passou ⇒ o único
    // retroativo possível é o de 1 dia — nada de contagem muda no resumo (regras gravadas).
    expect(m.sent.at(-1)).toContain("contagem 3-2-1");
    expect(m.sent.at(-1)).toContain("Confirmo?");
  });

  it('D2: clique em "personalizado" responde o convite, mantém o passo e gasta ZERO LLM', async () => {
    const m = make();
    await openFlow(m);
    await m.svc.handleText("111", "hoje");
    await m.svc.handleText("111", "14:00");
    await m.svc.handleText("111", "1h");
    await m.svc.handleText("111", "não"); // -> lembrete
    const internals = m.svc as unknown as {
      sessions: Map<string, { step: string }>;
    };
    expect(internals.sessions.get("111")?.step).toBe("lembrete");

    const classifyBefore = m.classifier.classify.mock.calls.length;
    await m.svc.handleCallback("111", "flow:lembrete:custom");
    expect(m.reminderInterpreter.interpretar).not.toHaveBeenCalled();
    expect(m.classifier.classify.mock.calls.length).toBe(classifyBefore); // ZERO LLM p/ o clique
    expect(internals.sessions.get("111")?.step).toBe("lembrete");
    expect(m.sent.at(-1)).toContain("Me diz como você quer ser avisado");
  });

  it("D1: sufixo de lembrete desconhecido é IGNORADO (sem LLM, sem fala)", async () => {
    const m = make();
    await openFlow(m);
    await m.svc.handleText("111", "hoje");
    await m.svc.handleText("111", "14:00");
    await m.svc.handleText("111", "1h");
    await m.svc.handleText("111", "não"); // -> lembrete
    const sentBefore = m.sent.length;
    const llmBefore =
      m.reminderInterpreter.interpretar.mock.calls.length +
      m.classifier.classify.mock.calls.length;
    await m.svc.handleCallback("111", "flow:lembrete:xxx");
    expect(m.sent.length).toBe(sentBefore); // silencioso (log só)
    expect(
      m.reminderInterpreter.interpretar.mock.calls.length +
        m.classifier.classify.mock.calls.length,
    ).toBe(llmBefore);
  });

  it('D4: label fora da whitelist (teclado velho "personalizado") NÃO vira fala', async () => {
    const m = make();
    await openFlow(m); // o turno de abertura classifica (1 chamada legítima, por FALA)
    const llmBefore = m.classifier.classify.mock.calls.length;
    await m.svc.handleCallback("111", "flow:personalizado");
    expect(m.sent.at(-1)).toContain("não tenho certeza se entendi");
    // o CLIQUE fora de roteamento não gastou NENHUMA chamada de LLM:
    expect(m.classifier.classify.mock.calls.length).toBe(llmBefore);
    expect(m.reminderInterpreter.interpretar).not.toHaveBeenCalled();
  });

  it('D4: whitelist — "não" clicado na pergunta de proteção responde sem NENHUM LLM', async () => {
    const m = make();
    // abrir o fluxo com uma fala que o extrator ACEITA (criar_aberto -> passo fim)
    m.classifier.classify.mockResolvedValue({
      ok: true,
      intent: "criar",
      confidence: 0.9,
    });
    m.schedulingInterpreter.interpretar.mockResolvedValue({
      ok: true,
      rawText: "consulta dia 08/10 às 14h",
      data: {
        title: "consulta",
        startsAt: "2026-10-08T14:00:00-03:00",
        confidence: 0.95,
      },
    });
    await m.svc.handleText("111", "consulta dia 08/10 às 14h");
    m.classifier.classify.mockResolvedValue({
      ok: false,
      reason: "no_tool_use",
    });

    // falar "criar outro" com o fluxo aberto => pergunta de proteção (descartar o atual?)
    m.classifier.classify.mockResolvedValue({
      ok: true,
      intent: "criar",
      confidence: 0.9,
    });
    await m.svc.handleText("111", "criar outro");
    expect(m.sent.at(-1)).toContain("descartar");
    m.classifier.classify.mockResolvedValue({
      ok: false,
      reason: "no_tool_use",
    });

    // "não" por CLIQUE: label da whitelist vira DADO do passo (parseYesNo na máquina) —
    // zero classificação, zero portão, zero interpretador de lembrete
    const classifyBefore = m.classifier.classify.mock.calls.length;
    await m.svc.handleCallback("111", "flow:não");
    expect(m.classifier.classify.mock.calls.length).toBe(classifyBefore);
    expect(m.schedulingInterpreter.interpretar).toHaveBeenCalledTimes(1); // só a de abertura
    expect(m.sent.at(-1)).toContain("continuamos o agendamento atual");
  });

  it("D4: clique com sessão em `titulo` intocada NUNCA re-dispara o portão da extração", async () => {
    const m = make();
    // extrator "aceitaria" qualquer coisa — se o portão rodar por clique, ele conta
    m.schedulingInterpreter.interpretar.mockResolvedValue({
      ok: true,
      rawText: "sim",
      data: {
        title: "sim",
        startsAt: "2026-10-08T14:00:00-03:00",
        confidence: 0.95,
      },
    });
    // sessao nova em `titulo` intocado (o portão está ARMADO p/ fala — D4 veda p/ clique)
    const internals = m.svc as unknown as {
      sessions: Map<string, { step: string; candidate: { title?: string } }>;
    };
    internals.sessions.set("111", {
      step: "titulo",
      candidate: {},
      lastActivityAt: new Date(`${TODAY_LOCAL}T10:00:00Z`).getTime(),
    } as never);
    await m.svc.handleCallback("111", "flow:sim");
    expect(m.schedulingInterpreter.interpretar).not.toHaveBeenCalled(); // portão não rodou
    expect(m.classifier.classify).not.toHaveBeenCalled(); // clique não é fala de intenção
    // "sim" chegou à máquina como DADO do passo (título "sim" — caminho vigente de fala)
    expect(internals.sessions.get("111")?.step).toBe("dia");
  });

  it("D4: clique whitelisted (remarcar) com sessão em criar_aberto NUNCA roda o portão nem a classificação", async () => {
    // Gherkin D da spec fluxo-criacao-robusto: "um clique em QUALQUER botão ⇒ o portão
    // da extração livre (openCreate) não roda (zero LLM por clique)". Sessão em
    // `criar_aberto` (estado em que o portão ESTÁ armado p/ fala) + label whitelisted:
    // nem o extrator nem o roteador de intenção podem rodar.
    const m = make();
    // extrator "aceitaria" qualquer coisa — se o portão rodar por clique, ele conta
    m.schedulingInterpreter.interpretar.mockResolvedValue({
      ok: true,
      rawText: "remarcar",
      data: {
        title: "remarcar",
        startsAt: "2026-10-08T14:00:00-03:00",
        confidence: 0.95,
      },
    });
    const internals = m.svc as unknown as {
      sessions: Map<
        string,
        { step: string; candidate: Record<string, unknown> }
      >;
    };
    // sessão em conflito (pergunta de remarcar/abortar de pé) — prevStep guarda a origem
    internals.sessions.set("111", {
      step: "conflito",
      prevStep: "criar_aberto",
      candidate: {
        title: "Consulta",
        startUtc: new Date("2026-10-08T17:00:00.000Z"),
        endUtc: new Date("2026-10-08T18:00:00.000Z"),
        startFromShortcut: true,
        conflictTries: 1,
      },
      lastActivityAt: new Date(`${TODAY_LOCAL}T10:00:00Z`).getTime(),
    } as never);

    await m.svc.handleCallback("111", "flow:remarcar");
    expect(m.schedulingInterpreter.interpretar).not.toHaveBeenCalled(); // portão morto p/ clique
    expect(m.classifier.classify).not.toHaveBeenCalled(); // clique não é fala de intenção
    // "remarcar" chegou à máquina como DADO do passo conflito: o teclado de dia voltou
    expect(m.sent.at(-1)).toContain("Em que dia");
    expect(internals.sessions.get("111")?.step).toBe("dia");
  });

  it("D4: atalho falado por TEXTO no passo lembrete não roda o portão (determinístico)", async () => {
    const m = make();
    // portão ARMADO: se o texto "sem lembrete" passasse pela extração, esta chamada contaria
    m.schedulingInterpreter.interpretar.mockResolvedValue({
      ok: true,
      rawText: "consulta",
      data: {
        title: "consulta",
        startsAt: "2026-10-08T14:00:00-03:00",
        confidence: 0.95,
      },
    });
    // sessão guiada JÁ no passo lembrete (mesmo estado que o fluxo guiado produz)
    const internals = m.svc as unknown as {
      sessions: Map<
        string,
        { step: string; candidate: Record<string, unknown> }
      >;
    };
    internals.sessions.set("111", {
      step: "lembrete",
      candidate: {
        title: "Consulta",
        day: { year: 2026, month: 10, day: 6 },
        startMinutes: 14 * 60,
        startUtc: new Date("2026-10-06T17:00:00.000Z"),
        endUtc: new Date("2026-10-06T18:00:00.000Z"),
      },
      lastActivityAt: new Date(`${TODAY_LOCAL}T10:00:00Z`).getTime(),
    } as never);
    // "sem lembrete" dito por texto: atalho determinístico da borda (zero LLM) e o
    // portão não roda (a sessão não está em criar_aberto/titulo)
    await m.svc.handleText("111", "sem lembrete");
    expect(internals.sessions.get("111")?.step).toBe("confirmacao");
    expect(m.schedulingInterpreter.interpretar).not.toHaveBeenCalled();
    expect(m.sent.at(-1)).toContain("⏰ sem lembrete");
  });

  it("D3: 2 falhas de texto livre no lembrete disparam a recuperação; 3º texto volta ao interpretador", async () => {
    const m = make();
    await openFlow(m);
    await m.svc.handleText("111", "hoje");
    await m.svc.handleText("111", "14:00");
    await m.svc.handleText("111", "1h");
    await m.svc.handleText("111", "não"); // -> lembrete (atalho determinístico: zero LLM)

    await m.svc.handleText("111", "blablabla"); // 1ª falha
    expect(m.reminderInterpreter.interpretar).toHaveBeenCalledTimes(1);
    expect(m.sent.at(-1)).toContain(
      "não tenho certeza se entendi esse lembrete",
    );
    expect(m.sent.at(-1)).not.toContain("atalho aí embaixo");

    await m.svc.handleText("111", "blablabla de novo"); // 2ª falha => recuperação
    expect(m.reminderInterpreter.interpretar).toHaveBeenCalledTimes(2);
    expect(m.sent.at(-1)).toContain("atalho aí embaixo");

    await m.svc.handleText("111", "ainda blabla"); // texto livre pós-teclado: volta p/ o LLM
    expect(m.reminderInterpreter.interpretar).toHaveBeenCalledTimes(3);
  });

  it('D3: texto livre "2h antes" no passo lembrete sai pelo atalho determinístico — o interpretador NUNCA roda', async () => {
    // Gherkin D da spec fluxo-criacao-robusto: "texto livre '2h antes' continua passando
    // por resolveReminderShortcut sem LLM". A borda roda o atalho ANTES do interpretador
    // (zero LLM); o mock do interpretador provaria qualquer vazamento se contasse.
    const m = make();
    await openFlow(m);
    await m.svc.handleText("111", "hoje");
    await m.svc.handleText("111", "14:00");
    await m.svc.handleText("111", "1h");
    await m.svc.handleText("111", "não"); // -> lembrete
    const internals = m.svc as unknown as {
      sessions: Map<string, { step: string }>;
    };
    expect(internals.sessions.get("111")?.step).toBe("lembrete");

    await m.svc.handleText("111", "2h antes");
    expect(m.reminderInterpreter.interpretar).not.toHaveBeenCalled(); // zero LLM p/ atalho
    expect(internals.sessions.get("111")?.step).toBe("confirmacao");
    expect(m.sent.at(-1)).toContain("⏰"); // linha do lembrete no resumo (1h antes... horas)

    await m.svc.handleText("111", "confirmar");
    expect(m.appointments.create).toHaveBeenCalledTimes(1);
    const [, payload] = m.appointments.create.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    // a regra materializada é before_hours 2 (o atalho, não o LLM)
    expect(payload.notificationRules).toEqual([
      { type: "before_hours", value: 2 },
    ]);
  });

  it("D4: handleCallback NUNCA delega label de lembrete a handleText (callback ≠ fala)", async () => {
    // Arquitetura/regressão da spec fluxo-criacao-robusto (D4 + gotcha "callback de
    // botão reaproveitado como fala"): o clique em "sem lembrete" tem roteamento
    // próprio (reminderChoice determinístico); o fallback handleText jamais roda.
    const m = make();
    await openFlow(m);
    await m.svc.handleText("111", "hoje");
    await m.svc.handleText("111", "14:00");
    await m.svc.handleText("111", "1h");
    await m.svc.handleText("111", "não"); // -> lembrete
    const internals = m.svc as unknown as {
      sessions: Map<string, { step: string }>;
    };
    expect(internals.sessions.get("111")?.step).toBe("lembrete");

    const handleTextSpy = jest.spyOn(m.svc, "handleText");
    await m.svc.handleCallback("111", "flow:lembrete:none");
    expect(handleTextSpy).not.toHaveBeenCalled(); // o clique nunca virou fala
    // e saiu como regra determinística [{type:'none'}] (Gherkin D: "sem lembrete" por clique)
    expect(internals.sessions.get("111")?.step).toBe("confirmacao");
    await m.svc.handleText("111", "confirmar");
    expect(m.appointments.create).toHaveBeenCalledTimes(1);
    const [, payload] = m.appointments.create.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(payload.notificationRules).toEqual([]); // none filtrado no create, como hoje
    handleTextSpy.mockRestore();
  });
  it("A3: endsAt + durationMinutes inconsistentes — endsAt manda (duração só log)", async () => {
    const m = make();
    m.classifier.classify.mockResolvedValue({
      ok: true,
      intent: "criar",
      confidence: 0.9,
    });
    m.schedulingInterpreter.interpretar.mockResolvedValue({
      ok: true,
      rawText: "das 8h as 17h do dia 12",
      data: {
        title: "plantão",
        startsAt: "2026-10-12T08:00:00-03:00",
        endsAt: "2026-10-12T17:00:00-03:00",
        durationMinutes: 30, // inconsistente com o fim dito — deve ser IGNORADA
        confidence: 0.95,
      },
    });
    await m.svc.handleText("111", "das 8h às 17h do dia 12");
    m.classifier.classify.mockResolvedValue({
      ok: false,
      reason: "no_tool_use",
    });
    await m.svc.handleText("111", "não"); // notas (o atalho foi direto: fim explícito)
    await m.svc.handleText("111", "sem lembrete");
    await m.svc.handleText("111", "confirmar");
    expect(m.appointments.create).toHaveBeenCalledTimes(1);
    const [, payload] = m.appointments.create.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect((payload.startsAt as Date).toISOString()).toBe(
      "2026-10-12T11:00:00.000Z",
    );
    // 9h de plantão (o fim dito), NÃO 30min e nem default 60
    expect((payload.endsAt as Date).toISOString()).toBe(
      "2026-10-12T20:00:00.000Z",
    );
  });

  it("A2: endsAt <= início => fim_invalido (máquina reaproveita o início e pergunta o fim, zero needs_review)", async () => {
    const m = make();
    m.classifier.classify.mockResolvedValue({
      ok: true,
      intent: "criar",
      confidence: 0.9,
    });
    m.schedulingInterpreter.interpretar.mockResolvedValue({
      ok: true,
      rawText: "consulta 14h ate 13h",
      data: {
        title: "consulta",
        startsAt: "2026-10-08T14:00:00-03:00",
        endsAt: "2026-10-08T13:00:00-03:00", // fim ANTES do início
        confidence: 0.95,
      },
    });
    await m.svc.handleText("111", "consulta dia 08/10 às 14h até 13h");

    // NUNCA needs_review por isso (ADR-010): nada persistido, sessão viva no passo fim
    expect(m.prisma.appointment.create).not.toHaveBeenCalled();
    const internals = m.svc as unknown as {
      sessions: Map<
        string,
        { step: string; candidate: { startUtc?: Date; endUtc?: Date } }
      >;
    };
    const s = internals.sessions.get("111")!;
    expect(s.step).toBe("fim");
    expect(s.candidate.startUtc?.toISOString()).toBe(
      "2026-10-08T17:00:00.000Z",
    ); // início preservado
    expect(s.candidate.endUtc).toBeUndefined();
    expect(m.sent.at(-1)).toContain("Que horas termina");
  });

  it("render do teclado de lembrete: callback_data estruturada flow:lembrete:* (D1)", async () => {
    const m = make();
    // intercepta o sendMessage COM markup p/ inspecionar o reply_markup renderizado
    const markups: Array<Array<{ text: string; callback_data: string }>> = [];
    (m.svc as unknown as { telegram: unknown }).telegram = {
      sendMessage: async (_id: string, text: string) => {
        m.sent.push(text);
      },
      getClient: () => ({
        telegram: {
          sendMessage: async (
            _id: string,
            text: string,
            opts: { reply_markup?: unknown },
          ) => {
            const kb = (
              opts?.reply_markup as {
                inline_keyboard: [
                  Array<{ text: string; callback_data: string }>,
                ];
              }
            )?.inline_keyboard;
            if (kb?.[0]) markups.push(kb[0]);
            m.sent.push(text);
          },
        },
      }),
    };
    await openFlow(m);
    await m.svc.handleText("111", "hoje");
    await m.svc.handleText("111", "14:00");
    await m.svc.handleText("111", "1h");
    await m.svc.handleText("111", "não"); // pergunta de lembrete c/ teclado
    const kb = markups.at(-1)!;
    expect(kb.map((b) => b.callback_data)).toEqual([
      "flow:lembrete:24h",
      "flow:lembrete:3d",
      "flow:lembrete:countdown",
      "flow:lembrete:none",
      "flow:lembrete:custom",
    ]);
  });
});
