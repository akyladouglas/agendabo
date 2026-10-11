import { describe, expect, it } from "vitest";
import {
  SchedulingFlowMachine,
  type FlowSession,
  type HandleTurnInput,
} from "./scheduling-flow.machine";
import type { BotUser } from "./bot-access.service";
import type { AppointmentLike } from "@agendabo/schedule-core";

/**
 * Fase 4 (spec llm-avancado): testes da máquina ANTES de mexer nela (risco de regressão
 * do plano). Cobre o atalho do criar (bloco A / regra 6), os passos `confirmar_edicao`/
 * `confirmar_cancelamento_compromisso`/`escolher_candidata` e o aviso de needs_review.
 */

const NOW = new Date("2026-10-06T15:00:00Z"); // 12:00 em America/Sao_Paulo (-180)
const OFFSET = -180;
const TTL = 30 * 60_000;
const MIN_CONF = 0.7;

const user: BotUser = {
  id: "u1",
  telegramId: "111",
  timezone: "America/Sao_Paulo",
  name: null,
};

function machine(): SchedulingFlowMachine {
  return new SchedulingFlowMachine(TTL, MIN_CONF);
}

function session(overrides: Partial<FlowSession> = {}): FlowSession {
  return {
    step: "titulo",
    candidate: { conflictTries: 0 },
    lastActivityAt: NOW.getTime(),
    ...overrides,
  };
}

function baseInput(
  overrides: Partial<HandleTurnInput> = {},
): Omit<HandleTurnInput, "session" | "text"> {
  return { user, existing: [], offsetMinutes: OFFSET, now: NOW, ...overrides };
}

function texts(outcome: {
  replies: Array<{ kind: string; text: string }>;
}): string {
  return outcome.replies.map((r) => r.text).join("\n");
}

const intent = (intentName: string, confidence = 0.95) => ({
  ok: true as const,
  intent: intentName as never,
  confidence,
});

/** Candidato do atalho: qui 08/10 14:00–15:00 local (-03:00). */
function extracted(overrides: Record<string, unknown> = {}) {
  return {
    title: "Consulta",
    startUtc: new Date("2026-10-08T17:00:00Z"),
    endUtc: new Date("2026-10-08T18:00:00Z"),
    // decisão 5 da spec fluxo-criacao-robusto: a borda diz se a RÉGUA viu fim explícito
    endExtracted: true,
    dateEvidence: "quinta que vem umas 14h",
    ...overrides,
  };
}

const dentista: AppointmentLike = {
  id: "a1",
  title: "Consulta dentista",
  startsAt: new Date("2026-10-08T17:00:00Z"), // 14:00 local de qui
  endsAt: new Date("2026-10-08T18:00:00Z"), // 15:00 local
};

describe("Máquina Fase 4 — atalho do criar (spec A4/A5, D2)", () => {
  it("extração aceita: pula dia/hora/fim e a confirmação final; pergunta notas com o resumo do que entendeu", async () => {
    const m = machine();
    const s = session();
    const out = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: "quero marcar consulta quinta que vem umas 14h por 1 hora",
      extracted: { kind: "aceito", data: extracted() },
    });
    expect(s.step).toBe("notas");
    expect(s.candidate.title).toBe("Consulta");
    expect(s.candidate.startUtc?.toISOString()).toBe(
      "2026-10-08T17:00:00.000Z",
    );
    expect(texts(out)).toContain("Entendi");
    expect(texts(out)).toContain("14:00"); // tz do usuário, não UTC
    expect(texts(out)).toContain("anotar");
    expect(texts(out)).not.toContain("Confirmo?"); // a fala já é a confirmação (regra A4)
  });

  it("extração aceita COM conflito: findConflict roda antes das notas e pergunta remarcar/abortar", async () => {
    const m = machine();
    const s = session();
    const out = await m.handleTurn({
      ...baseInput({ existing: [dentista] }),
      session: s,
      text: "marca consulta quinta 14h",
      extracted: { kind: "aceito", data: extracted() },
    });
    expect(s.step).toBe("conflito");
    expect(texts(out)).toContain("Consulta dentista");
    expect(texts(out)).toContain("14:00");
    const buttons = out.replies.flatMap((r) =>
      r.kind === "buttons" ? r.buttons : [],
    );
    expect(buttons).toEqual(expect.arrayContaining(["remarcar", "abortar"]));
  });

  it("extração com quando parcial (só título): pula o que tem, pergunta só a HORA (decisão #5)", async () => {
    const m = machine();
    const s = session();
    const out = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: "quero marcar consulta quinta que vem",
      extracted: {
        kind: "quando_parcial",
        data: { title: "Consulta", day: { year: 2026, month: 10, day: 8 } },
      },
    });
    expect(s.step).toBe("hora");
    expect(s.candidate.title).toBe("Consulta");
    expect(s.candidate.day).toEqual({ year: 2026, month: 10, day: 8 });
    expect(texts(out)).toContain("08/10");
    expect(texts(out)).toContain("que horas");
  });

  it("falha de extração (B1): NUNCA usa a fala/hint como título — cai no guiado perguntando o título", async () => {
    const m = machine();
    const s = session();
    const out = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: "tenho um novo compromisso, uma viagem para lucena de 19h hoje",
      extracted: { kind: "falhou", reason: "parse" },
    });
    expect(s.step).toBe("titulo");
    expect(s.candidate.title).toBeUndefined(); // B1: a frase jamais vira título
    expect(texts(out)).toContain("Como eu chamo");
  });

  it("B2/B3 `sem_titulo` com fim explícito: pergunta o título reaproveitando o intervalo (nada é re-perguntado)", async () => {
    const m = machine();
    const s = session();
    const out = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: "vou pagar o boleto do aluguel amanhã às 10h",
      extracted: {
        kind: "sem_titulo",
        data: {
          startUtc: new Date("2026-10-07T13:00:00Z"),
          endUtc: new Date("2026-10-07T14:00:00Z"),
          endExtracted: true,
        },
      },
    });
    expect(s.step).toBe("titulo");
    expect(s.candidate.title).toBeUndefined();
    expect(s.candidate.startUtc?.toISOString()).toBe(
      "2026-10-07T13:00:00.000Z",
    ); // quando preservado
    expect(s.candidate.endUtc?.toISOString()).toBe("2026-10-07T14:00:00.000Z");
    expect(texts(out)).toContain("Como eu chamo");
    expect(texts(out)).not.toContain("Em que dia"); // dia/hora NUNCA re-perguntados

    // respondido o título: o fluxo segue direto p/ notas (findConflict com o intervalo
    // pronto — checkConflict), sem guiado do zero
    const next = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: "Boleto do aluguel",
    });
    expect(s.step).toBe("notas");
    expect(s.candidate.title).toBe("Boleto do aluguel");
    expect(texts(next)).toContain("07/10");
  });

  it("B2/B3 `sem_titulo` SEM fim: pergunta o `fim` primeiro (decisão 5) e só depois o título", async () => {
    const m = machine();
    const s = session();
    const out = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: "vou pagar o boleto do aluguel amanhã às 10h",
      extracted: {
        kind: "sem_titulo",
        data: {
          startUtc: new Date("2026-10-07T13:00:00Z"),
          endExtracted: false,
        },
      },
    });
    expect(s.step).toBe("fim");
    expect(texts(out)).toContain("Que horas termina");
    expect(texts(out)).not.toContain(" — ter"); // eco sem título (sem separador órfão)

    await m.handleTurn({ ...baseInput(), session: s, text: "11:00" });
    expect(s.step).toBe("titulo"); // o título continua faltando — é a vez dele
    expect(s.candidate.endUtc?.toISOString()).toBe("2026-10-07T14:00:00.000Z");

    const done = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: "Boleto",
    });
    expect(s.step).toBe("notas"); // fim + título fechados: seguem as notas
    expect(texts(done)).toContain("Boleto");
  });
});

describe("Máquina — decisão 5/B1/C1: atalho reaproveita e pergunta só o que falta (spec fluxo-criacao-robusto)", () => {
  it("aceito endExtracted:true MULTI-DIA (sáb 22:00Z → seg 20:00Z): pula dia/hora/fim, eco cita os dois dias (A1/B4)", async () => {
    const m = machine();
    const s = session();
    const out = await m.handleTurn({
      ...baseInput({ now: new Date("2026-10-10T15:00:00Z") }),
      session: s,
      text: "tenho um novo compromisso, uma viagem para lucena de 19h hoje e vai até 17h na segunda",
      extracted: {
        kind: "aceito",
        data: {
          title: "viagem para Lucena",
          startUtc: new Date("2026-10-10T22:00:00Z"),
          endUtc: new Date("2026-10-12T20:00:00Z"),
          endExtracted: true,
          dateEvidence: "de 19h hoje e vai até 17h na segunda",
        },
      },
    });
    expect(s.step).toBe("notas"); // dia/hora/fim pulados (régua viu o fim)
    const t = texts(out);
    expect(t).toContain("Entendi");
    expect(t).toContain("viagem para Lucena"); // título ecoado, nunca silencioso (B4)
    expect(t).toContain("sáb 10/10 19:00"); // início no tz do usuário
    expect(t).toContain("seg 12/10 17:00"); // fim multi-dia no tz do usuário (A1/C2)
  });

  it('aceito endExtracted:false: pergunta o passo `fim` ecoando título+início (decisão 5), depois "1h30" segue', async () => {
    const m = machine();
    const s = session();
    const out = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: "marca consulta quinta 14h",
      extracted: {
        kind: "aceito",
        data: {
          title: "Consulta",
          startUtc: new Date("2026-10-08T17:00:00Z"),
          endUtc: new Date("2026-10-08T18:00:00Z"), // materializado pela borda — NÃO vale
          endExtracted: false,
        },
      },
    });
    expect(s.step).toBe("fim"); // decisão 5: sem fim explícito ⇒ SEMPRE perguntar
    expect(s.candidate.endUtc).toBeUndefined(); // fim indefinido até o usuário responder
    expect(s.candidate.startDayLocal).toEqual({
      year: 2026,
      month: 10,
      day: 8,
    });
    const t = texts(out);
    expect(t).toContain("Entendi");
    expect(t).toContain("Consulta"); // eco obrigatório do que entendeu
    expect(t).toContain("14:00"); // início ecoado no tz do usuário
    expect(t).toMatch(/termina|dura/); // e pergunta só o fim

    // responde a duração: endUtc = start + 90min, segue checkConflict → notas
    const out2 = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: "1h30",
    });
    expect(s.candidate.endUtc?.toISOString()).toBe("2026-10-08T18:30:00.000Z");
    expect(s.step).toBe("notas");
    expect(texts(out2)).toContain("anotar");
  });

  it("M1 do review: atalho multi-dia com fim extraído → conflito → remarcar → dia/hora novos ⇒ MESMA duração preservada (eco/endUtc)", async () => {
    // M1 do review: `setDay` zera start/end; sem a duração guardada do atalho, o fim
    // extraído ("até 17h segunda") se perdia em silêncio e o usuário re-digitava o fim.
    const m = machine();
    const s = session();
    const reu: AppointmentLike = {
      id: "r1",
      title: "Reunião",
      startsAt: new Date("2026-10-11T12:00:00Z"),
      endsAt: new Date("2026-10-11T13:00:00Z"),
    };
    const turn = (over: Record<string, unknown> = {}) => ({
      ...baseInput({
        now: new Date("2026-10-10T15:00:00Z"),
        existing: [reu],
        ...over,
      }),
      session: s,
    });
    // sáb 10/10 19:00 → seg 12/10 17:00 local (46h) — choca com a Reunião de dom (A5)
    const out = await m.handleTurn({
      ...turn(),
      text: "viagem para lucena de 19h hoje ate 17h segunda",
      extracted: {
        kind: "aceito",
        data: {
          title: "Viagem para Lucena",
          startUtc: new Date("2026-10-10T22:00:00Z"),
          endUtc: new Date("2026-10-12T20:00:00Z"),
          endExtracted: true,
        },
      },
    });
    expect(s.step).toBe("conflito");
    expect(texts(out)).toContain("Reunião");
    // duração original guardada: 46h = 165_600_000 ms
    expect(s.candidate.shortcutDurationMs).toBe(165_600_000);

    await m.handleTurn({ ...turn(), text: "remarcar" }); // ramo de remarcação → dia
    expect(s.step).toBe("dia");
    await m.handleTurn({
      ...turn(),
      text: "",
      dayChoice: { year: 2026, month: 10, day: 13 },
    }); // setDay zera start/end mas NÃO a duração
    expect(s.step).toBe("hora");
    expect(s.candidate.startUtc).toBeUndefined();
    expect(s.candidate.endUtc).toBeUndefined();

    const hora = await m.handleTurn({ ...turn(), text: "19:00" });
    // setStart aplica a duração guardada: 13/10 19:00 local → 15/10 17:00 local = 46h
    expect(s.candidate.startUtc?.toISOString()).toBe(
      "2026-10-13T22:00:00.000Z",
    );
    expect(s.candidate.endUtc?.toISOString()).toBe("2026-10-15T20:00:00.000Z");
    expect(texts(hora)).not.toContain("termina"); // fim NÃO é re-perguntado
    // checkConflict com o intervalo recalculado (sem choque) → notas ecoando os 2 dias
    expect(s.step).toBe("notas");
    const t = texts(hora);
    expect(t).toContain("ter 13/10 19:00");
    expect(t).toContain("qui 15/10 17:00"); // eco com a MESMA duração de ~46h
    expect(s.candidate.shortcutDurationMs).toBe(165_600_000); // segue viva p/ nova remarcação
  });

  it("M1 do review: sem fim extraído (shortcutDurationMs ausente) a remarcar continua perguntando o fim", async () => {
    const m = machine();
    const s = session();
    const turn = (over: Record<string, unknown> = {}) => ({
      ...baseInput({ now: new Date("2026-10-10T15:00:00Z"), ...over }),
      session: s,
    });
    await m.handleTurn({
      ...turn(),
      text: "viagem para lucena de 19h hoje",
      extracted: {
        kind: "aceito",
        data: {
          title: "Viagem para Lucena",
          startUtc: new Date("2026-10-10T22:00:00Z"),
          endUtc: new Date("2026-10-10T23:00:00Z"), // fallback da régua — não vale
          endExtracted: false,
        },
      },
    });
    expect(s.step).toBe("fim"); // decisão 5: fim perguntado
    expect(s.candidate.shortcutDurationMs).toBeUndefined(); // só com fim extraído
    await m.handleTurn({ ...turn(), text: "17:00" });
    expect(s.step).toBe("notas");
    expect(s.candidate.shortcutDurationMs).toBeUndefined();

    // rewind para o dia (ex.: "alterar o dia" no resumo final, após lembrete) ⇒ hora
    await m.handleTurn({ ...turn(), text: "não" }); // notas
    await m.handleTurn({
      ...turn(),
      text: "sem lembrete",
      reminder: { ok: true, regras: [{ type: "none" }] },
    });
    expect(s.step).toBe("confirmacao");
    await m.handleTurn({ ...turn(), text: "alterar o dia" });
    expect(s.step).toBe("dia");
    await m.handleTurn({
      ...turn(),
      text: "",
      dayChoice: { year: 2026, month: 10, day: 13 },
    });
    expect(s.step).toBe("hora");
    const fim = await m.handleTurn({ ...turn(), text: "19:00" });
    expect(s.step).toBe("fim"); // comportamento vigente: sem duração guardada, pergunta
    expect(texts(fim)).toContain("termina");
  });

  it("Gherkin A5 literal: multi-dia endExtracted:true sobreposição com confirmed ⇒ conflito cita o conflitante, remarcar/abortar", async () => {
    const m = machine();
    const s = session();
    const reu: AppointmentLike = {
      id: "r1",
      title: "Reunião",
      startsAt: new Date("2026-10-11T12:00:00Z"),
      endsAt: new Date("2026-10-11T13:00:00Z"),
    };
    const out = await m.handleTurn({
      ...baseInput({ now: new Date("2026-10-10T15:00:00Z"), existing: [reu] }),
      session: s,
      text: "viagem para lucena de 19h hoje ate 17h segunda",
      extracted: {
        kind: "aceito",
        data: {
          title: "Viagem para Lucena",
          startUtc: new Date("2026-10-10T22:00:00Z"),
          endUtc: new Date("2026-10-12T20:00:00Z"),
          endExtracted: true,
        },
      },
    });
    expect(s.step).toBe("conflito"); // findConflict vê a sobreposição multi-dia (A5)
    expect(texts(out)).toContain("Reunião");
    const buttons = out.replies.flatMap((r) =>
      r.kind === "buttons" ? r.buttons : [],
    );
    expect(buttons).toEqual(expect.arrayContaining(["remarcar", "abortar"]));
  });

  it("falhou (B1): NUNCA usa hint/fala como título — cai no guiado perguntando o título", async () => {
    const m = machine();
    const s = session();
    const out = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: "tenho um novo compromisso, uma viagem para lucena de 19h hoje",
      extracted: { kind: "falhou", reason: "parse" },
    });
    expect(s.step).toBe("titulo");
    expect(s.candidate.title).toBeUndefined();
    expect(texts(out)).toContain("Como eu chamo");
  });

  it('fim_invalido: reaproveita o início (título+dia), passo `fim` com eco; texto inválido re-pergunta; "1h" segue (D2/A2)', async () => {
    const m = machine();
    const s = session();
    const out = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: "consulta quinta 14h até deu ruim no fim",
      extracted: {
        kind: "fim_invalido",
        data: {
          title: "Consulta",
          startUtc: new Date("2026-10-08T17:00:00Z"),
          dateEvidence: "quinta 14h",
        },
      },
    });
    expect(s.step).toBe("fim");
    expect(s.candidate.title).toBe("Consulta");
    expect(s.candidate.startUtc?.toISOString()).toBe(
      "2026-10-08T17:00:00.000Z",
    );
    expect(s.candidate.startDayLocal).toEqual({
      year: 2026,
      month: 10,
      day: 8,
    });
    expect(s.candidate.endUtc).toBeUndefined();
    const t = texts(out);
    expect(t).toContain("Entendi"); // eco do que entendeu (C1)
    expect(t).toContain("Consulta");
    expect(t).toMatch(/termina|dura/); // pede só o que falta

    // texto ilegível p/ o fim: re-pergunta com erro, nada se perde (spec 12)
    const bad = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: "sei lá",
    });
    expect(s.step).toBe("fim");
    expect(texts(bad)).toContain("depois do início");
    expect(s.candidate.startUtc?.toISOString()).toBe(
      "2026-10-08T17:00:00.000Z",
    );

    // "1h" resolve a partir do startUtc do atalho (sem `day`): segue p/ notas
    const ok = await m.handleTurn({ ...baseInput(), session: s, text: "1h" });
    expect(s.candidate.endUtc?.toISOString()).toBe("2026-10-08T18:00:00.000Z");
    expect(s.step).toBe("notas");
    expect(texts(ok)).toContain("anotar");
  });

  it('B4 ponta-a-ponte na máquina: título curto ecoado sem pergunta, no resumo final, e "alterar título" cai no passo título', async () => {
    // Gherkin B da spec fluxo-criacao-robusto: "título curto válido extraído ⇒ nenhuma
    // pergunta de título E a fala de eco e o resumo final mostram o título E 'alterar'
    // lista título como item alterável (mecânica rewindTo vigente)".
    const m = machine();
    const s = session();
    const out = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: "viagem para lucena de 19h hoje ate 17h de amanha",
      extracted: {
        kind: "aceito",
        data: {
          title: "Viagem para Lucena",
          startUtc: new Date("2026-10-10T22:00:00Z"),
          endUtc: new Date("2026-10-11T18:00:00Z"),
          endExtracted: true,
        },
      },
    });
    // nenhuma pergunta de título (passou reto às notas) + eco na fala de pulo (B4)
    expect(s.step).toBe("notas");
    expect(texts(out)).toContain("Entendi");
    expect(texts(out)).toContain("Viagem para Lucena");
    expect(texts(out)).not.toContain("Como eu chamo");

    await m.handleTurn({ ...baseInput(), session: s, text: "não" }); // notas
    const rem = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: "sem lembrete",
      reminder: { ok: true, regras: [{ type: "none" }] },
    });
    // resumo final mostra o título ecoado + "alterar" lista o título como alterável
    expect(texts(rem)).toContain("Viagem para Lucena");
    expect(texts(rem)).toContain("alterar");

    const alter = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: "alterar o título",
    });
    expect(s.step).toBe("titulo"); // rewindTo('titulo') — o título é item alterável
    expect(texts(alter)).toContain("Como eu chamo");
  });

  it("Gherkin C1 da spec mãe: quando_parcial ecoa título+dia e pergunta só a hora; responder hora segue SEM re-perguntar título", async () => {
    const m = machine();
    const s = session();
    const out = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: "viagem para Lucena no dia 12",
      extracted: {
        kind: "quando_parcial",
        data: {
          title: "Viagem para Lucena",
          day: { year: 2026, month: 10, day: 12 },
        },
      },
    });
    expect(s.step).toBe("hora");
    const t = texts(out);
    expect(t).toContain("Entendi");
    expect(t).toContain("Viagem para Lucena"); // título mantido E ecoado (C1)
    expect(t).toContain("12/10"); // dia mantido E ecoado
    expect(t).toContain("que horas"); // pergunta SÓ a hora
    const buttons = out.replies.flatMap((r) =>
      r.kind === "buttons" ? r.buttons : [],
    );
    expect(buttons).toHaveLength(24); // teclado de horas continua

    await m.handleTurn({ ...baseInput(), session: s, text: "08:00" });
    expect(s.step).toBe("fim"); // sem re-pergunta de título/dia (C1)
    expect(s.candidate.title).toBe("Viagem para Lucena");
    expect(s.candidate.startUtc?.toISOString()).toBe(
      "2026-10-12T11:00:00.000Z",
    );
  });
});

describe("Máquina — lembrete D3: clique ≠ fala, anti-loop de 2 tentativas", () => {
  function lembreteSession(tries?: number): FlowSession {
    return session({
      step: "lembrete",
      candidate: {
        title: "Consulta",
        day: { year: 2026, month: 10, day: 9 },
        startMinutes: 14 * 60,
        startUtc: new Date("2026-10-09T17:00:00Z"),
        endUtc: new Date("2026-10-09T18:00:00Z"),
        notes: null,
        conflictTries: 0,
        ...(tries !== undefined ? { reminderTries: tries } : {}),
      },
    });
  }

  it('reminderChoice "countdown" (clique 3-2-1): regras determinísticas + confirmação, zero LLM', async () => {
    const m = machine();
    const s = lembreteSession();
    const out = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: "3-2-1", // label do clique — a máquina nem olha (callback decodificado na borda)
      reminderChoice: "countdown",
    });
    expect(s.step).toBe("confirmacao");
    expect(s.candidate.reminderRules).toEqual([{ type: "countdown_3_2_1" }]);
    expect(texts(out)).toContain("3-2-1"); // linha ⏰ do resumo final
    const yes = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: "confirmar",
    });
    expect(yes.create?.notificationRules).toEqual([
      { type: "countdown_3_2_1" },
    ]);
  });

  it.each([
    ["24h", [{ type: "before_days", value: 1 }]],
    ["3d", [{ type: "before_days", value: 3 }]],
    ["none", [{ type: "none" }]],
  ] as const)(
    'reminderChoice "%s": regra exata e passo confirmacao',
    async (choice, regras) => {
      const m = machine();
      const s = lembreteSession();
      await m.handleTurn({
        ...baseInput(),
        session: s,
        text: "",
        reminderChoice: choice,
      });
      expect(s.step).toBe("confirmacao");
      expect(s.candidate.reminderRules).toEqual(regras);
    },
  );

  it('reminderChoice "custom" (clique personalizado): convite de texto livre, passo segue `lembrete` (D2)', async () => {
    const m = machine();
    const s = lembreteSession();
    const out = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: "personalizado",
      reminderChoice: "custom",
    });
    expect(s.step).toBe("lembrete");
    expect(s.candidate.reminderRules).toBeUndefined();
    expect(texts(out)).toContain("Me diz como você quer ser avisado");
  });

  it("anti-loop D3: 1ª falha re-pergunta com atalhos; 2ª falha seguida traz a recuperação + teclado fixo", async () => {
    const m = machine();
    const s = lembreteSession();
    const first = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: "blablabla",
      reminder: { ok: false, reason: "unparseable" },
    });
    expect(s.step).toBe("lembrete");
    expect(s.candidate.reminderTries).toBe(1);
    expect(texts(first)).toContain("não tenho certeza se entendi"); // re-pergunta com exemplo
    expect(texts(first)).not.toContain("atalho aí embaixo"); // recuperação só na 2ª

    const second = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: "blablabla de novo",
      reminder: { ok: false, reason: "unparseable" },
    });
    expect(s.step).toBe("lembrete");
    expect(s.candidate.reminderTries).toBe(2);
    expect(texts(second)).toContain("atalho aí embaixo"); // fala de recuperação (D3)
    const buttons = second.replies.flatMap((r) =>
      r.kind === "buttons" ? r.buttons : [],
    );
    expect(buttons).toEqual([
      "24h antes",
      "3 dias antes",
      "3-2-1",
      "sem lembrete",
      "personalizado",
    ]);
  });

  it("sucesso zera o contador: nova falha depois de texto ok volta a ser 1ª falha", async () => {
    const m = machine();
    const s = lembreteSession(1); // já tinha falhado uma vez
    await m.handleTurn({
      ...baseInput(),
      session: s,
      text: "2 horas antes",
      reminder: { ok: true, regras: [{ type: "before_hours", value: 2 }] },
    });
    expect(s.step).toBe("confirmacao");
    expect(s.candidate.reminderTries).toBe(0); // contador limpo no sucesso

    // rewind para o lembrete e falha de novo: é 1ª falha (1→2? não: 0→1)
    s.step = "lembrete";
    const out = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: "blabla outra vez",
      reminder: { ok: false, reason: "unparseable" },
    });
    expect(s.candidate.reminderTries).toBe(1);
    expect(texts(out)).not.toContain("atalho aí embaixo");
  });

  it("falha já na 2ª tentativa (contador pré-carregado) também mostra a recuperação com teclado fixo", async () => {
    const m = machine();
    const s = lembreteSession(1);
    const out = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: "hmm",
      reminder: { ok: false, reason: "low_confidence" },
    });
    expect(s.candidate.reminderTries).toBe(2);
    expect(texts(out)).toContain("atalho aí embaixo");
  });

  it("clique num atalho (sucesso) zera o contador: 2ª falha isolada depois é 1ª de novo (D3 — anti-loop, não porta de saída)", async () => {
    // Caso-limite das notas técnicas da spec: "2ª falha seguida por texto válido zera
    // o contador". Aqui o "válido" é o CLIQUE (reminderChoice): sucesso ⇒ tries 0, e a
    // primeira falha seguinte volta a ser 1ª (re-pergunta SEM a recuperação de teclado).
    const m = machine();
    const s = lembreteSession(1); // já vinha de 1ª falha
    await m.handleTurn({
      ...baseInput(),
      session: s,
      text: "",
      reminderChoice: "24h",
    });
    expect(s.candidate.reminderTries).toBe(0);

    // rewind para o lembrete (ex.: "alterar o lembrete") e falha de texto de novo:
    s.step = "lembrete";
    const out = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: "blablabla",
      reminder: { ok: false, reason: "unparseable" },
    });
    expect(s.candidate.reminderTries).toBe(1); // não é 2 ⇒ nenhuma recuperação exibida
    expect(texts(out)).toContain("não tenho certeza se entendi esse lembrete");
    expect(texts(out)).not.toContain("atalho aí embaixo");
  });
});

describe("Máquina Fase 4 — needs_review do atalho (spec E16)", () => {
  it("fraco: needs_review com aviso citando a evidência, sessão encerra, NADA de create/outbox (regra 6/D7)", async () => {
    const m = machine();
    const s = session();
    const out = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: "mais ou menos uma consulta quinta",
      extracted: {
        kind: "fraco",
        data: {
          title: "consulta",
          startUtc: new Date("2026-10-08T17:00:00Z"),
          endUtc: new Date("2026-10-08T18:00:00Z"),
          dateEvidence: "mais ou menos... quinta",
        },
        reviewReason: "confianca_baixa",
        rawText: "mais ou menos uma consulta quinta",
      },
    });
    expect(out.done).toBe(true);
    expect(out.create).toBeUndefined();
    expect(out.needsReview).toBeDefined();
    expect(out.needsReview?.title).toBe("consulta");
    expect(out.needsReview?.rawText).toBe("mais ou menos uma consulta quinta");
    expect(out.needsReview?.reviewReason).toContain("confianca_baixa");
    expect(out.needsReview?.startsAt.toISOString()).toBe(
      "2026-10-08T17:00:00.000Z",
    );
    expect(texts(out)).toContain("⚠️");
    expect(texts(out)).toContain("mais ou menos... quinta"); // cita a evidência (Aberto #1→a)
  });

  it("suspeito (aceito-no-passado): needs_review com reviewReason de passado", async () => {
    const m = machine();
    const s = session();
    const out = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: "anota aí a consulta de ontem às 9h",
      extracted: {
        kind: "suspeito",
        data: {
          title: "Consulta",
          startUtc: new Date("2026-10-05T12:00:00Z"),
          endUtc: new Date("2026-10-05T13:00:00Z"),
        },
        reviewReason: "data_no_passado",
        rawText: "anota aí a consulta de ontem às 9h",
      },
    });
    expect(out.done).toBe(true);
    expect(out.needsReview?.reviewReason).toContain("data_no_passado");
  });

  it('atalho aceita o resto do fluxo: notas → lembrete → create SEM "confirmo?" extra (Gherkin R1)', async () => {
    const m = machine();
    const s = session();
    await m.handleTurn({
      ...baseInput(),
      session: s,
      text: "consulta quinta 14h por 1 hora",
      extracted: { kind: "aceito", data: extracted() },
    });
    await m.handleTurn({ ...baseInput(), session: s, text: "não" }); // notas
    await m.handleTurn({
      ...baseInput(),
      session: s,
      text: "sem lembrete",
      reminder: { ok: true, regras: [{ type: "none" }] },
    });
    expect(s.step).toBe("confirmacao"); // resumo final normal (fases 1/3 intactas)
    const fin = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: "confirmar",
    });
    expect(fin.done).toBe(true);
    expect(fin.create).toEqual({
      title: "Consulta",
      startsAt: new Date("2026-10-08T17:00:00Z"),
      endsAt: new Date("2026-10-08T18:00:00Z"),
      notes: null,
      notificationRules: [],
      timezone: "America/Sao_Paulo",
    });
  });
});

describe("Máquina Fase 4 — confirmar_edicao (spec C12)", () => {
  function editSession(): FlowSession {
    return session({
      step: "confirmar_edicao",
      candidate: {
        title: "Reunião",
        startUtc: new Date("2026-10-08T17:00:00Z"),
        endUtc: new Date("2026-10-08T18:00:00Z"),
        conflictTries: 0,
        edit: {
          action: "editar",
          appointmentId: "r1",
          fromTitle: "Reunião",
          fromStartUtc: new Date("2026-10-08T17:00:00Z"),
          fromEndUtc: new Date("2026-10-08T18:00:00Z"),
          toStartUtc: new Date("2026-10-09T19:00:00Z"),
          toEndUtc: new Date("2026-10-09T20:00:00Z"),
          tries: 0,
        },
      },
    });
  }

  it('"sim" emite update com o patch (nada mudou antes disto — D5)', async () => {
    const m = machine();
    const s = editSession();
    const out = await m.handleTurn({ ...baseInput(), session: s, text: "sim" });
    expect(out.done).toBe(true);
    expect(out.update).toMatchObject({
      appointmentId: "r1",
      patch: {
        startsAt: new Date("2026-10-09T19:00:00Z"),
        endsAt: new Date("2026-10-09T20:00:00Z"),
      },
    });
    expect(texts(out)).toContain("Reunião");
    expect(texts(out)).toContain("16:00"); // 19:00Z = 16:00 -03:00
  });

  it('"não": nada muda, nenhum update, turno encerra educadamente', async () => {
    const m = machine();
    const s = editSession();
    const out = await m.handleTurn({ ...baseInput(), session: s, text: "não" });
    expect(out.done).toBe(true);
    expect(out.update).toBeUndefined();
    expect(texts(out)).toContain("nada mudei");
  });

  it("texto ambíguo re-pergunta a confirmação (parseYesNo padrão)", async () => {
    const m = machine();
    const s = editSession();
    const out = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: "sei lá",
    });
    expect(s.step).toBe("confirmar_edicao");
    expect(out.done).toBeUndefined();
    expect(texts(out)).toContain("Confirmo");
  });

  it('conflito no "sim" (service reporta): mostra conflitante + re-pergunta o horário novo, máx 3 (spec C13)', async () => {
    const m = machine();
    const s = editSession();
    s.candidate.edit!.tries = 1;
    const out = await m.handleTurn({
      ...baseInput({ existing: [dentista] }),
      session: s,
      text: "agora choca",
      editConflict: {
        title: "Daily da equipe",
        startsAt: new Date("2026-10-09T19:00:00Z"),
        endsAt: new Date("2026-10-09T20:00:00Z"),
      },
    });
    expect(s.step).toBe("edit_propor");
    expect(texts(out)).toContain("Daily da equipe");
    expect(texts(out)).toContain("16:00");
    // 3ª tentativa com conflito de novo → sugere desistir mas ainda aceita tentar
    s.candidate.edit!.tries = 3;
    s.step = "edit_propor";
    // Passo `edit_propor` (pós-conflito): fala sem quando utilizável → re-posta a
    // pergunta COM o conflitante e a saída de desistir (máx 3 — spec C13). Zero LLM.
    const out2 = await m.handleTurn({
      ...baseInput({ existing: [dentista] }),
      session: s,
      text: "muda pro mesmo lugar",
      editConflict: {
        title: "Daily da equipe",
        startsAt: new Date("2026-10-09T19:00:00Z"),
        endsAt: new Date("2026-10-09T20:00:00Z"),
      },
    });
    expect(s.step).toBe("edit_propor");
    expect(texts(out2)).toContain("desistir");
  });
});

describe("Máquina Fase 4 — escolher_candidata (spec B11, decisão #4)", () => {
  function candidatesSession(): FlowSession {
    return session({
      step: "escolher_candidata",
      candidate: {
        conflictTries: 0,
        edit: {
          action: "cancelar",
          descricao: "reunião",
          intervalRange: {
            start: new Date("2026-10-08T03:00:00Z"),
            end: new Date("2026-10-09T03:00:00Z"),
          },
          candidates: [
            {
              id: "c1",
              title: "Reunião produto",
              startsAt: new Date("2026-10-08T14:00:00Z"),
              endsAt: new Date("2026-10-08T15:00:00Z"),
            },
            {
              id: "c2",
              title: "Reunião semanal",
              startsAt: new Date("2026-10-08T18:00:00Z"),
              endsAt: new Date("2026-10-08T19:00:00Z"),
            },
          ],
          tries: 0,
        },
      },
    });
  }

  it('"1" resolve a primeira candidata deterministicamente (zero LLM) e vai à confirmação de cancelar', async () => {
    const m = machine();
    const s = candidatesSession();
    const out = await m.handleTurn({ ...baseInput(), session: s, text: "1" });
    expect(s.step).toBe("confirmar_cancelamento_compromisso");
    expect(s.candidate.edit?.appointmentId).toBe("c1");
    expect(texts(out)).toContain("Reunião produto");
    expect(texts(out)).toContain("11:00"); // 14:00Z = 11:00 -03:00
    expect(texts(out)).toContain("(sim / não)");
  });

  it("número fora da lista re-pergunta; candidato intacto", async () => {
    const m = machine();
    const s = candidatesSession();
    const out = await m.handleTurn({ ...baseInput(), session: s, text: "7" });
    expect(s.step).toBe("escolher_candidata");
    expect(s.candidate.edit?.appointmentId).toBeUndefined();
    expect(texts(out)).toContain("1");
    expect(texts(out)).toContain("2");
  });

  it("escolha por texto (título da candidata) também resolve sem LLM", async () => {
    const m = machine();
    const s = candidatesSession();
    await m.handleTurn({ ...baseInput(), session: s, text: "reunião semanal" });
    expect(s.step).toBe("confirmar_cancelamento_compromisso");
    expect(s.candidate.edit?.appointmentId).toBe("c2");
  });
});

describe("Máquina Fase 4 — confirmar_cancelamento_compromisso (spec D14)", () => {
  function cancelSession(): FlowSession {
    return session({
      step: "confirmar_cancelamento_compromisso",
      candidate: {
        conflictTries: 0,
        edit: {
          action: "cancelar",
          appointmentId: "c1",
          fromTitle: "Consulta dentista",
          fromStartUtc: new Date("2026-10-08T17:00:00Z"),
          fromEndUtc: new Date("2026-10-08T18:00:00Z"),
          tries: 0,
        },
      },
    });
  }

  it('"sim" emite cancelar (service apaga + invalida outbox)', async () => {
    const m = machine();
    const s = cancelSession();
    const out = await m.handleTurn({ ...baseInput(), session: s, text: "sim" });
    expect(out.done).toBe(true);
    expect(out.cancelAppointment).toMatchObject({ appointmentId: "c1" });
    expect(texts(out)).toContain("Consulta dentista");
  });

  it('"não": nada muda', async () => {
    const m = machine();
    const s = cancelSession();
    const out = await m.handleTurn({ ...baseInput(), session: s, text: "não" });
    expect(out.done).toBe(true);
    expect(out.cancelAppointment).toBeUndefined();
  });

  it("ambíguo re-pergunta", async () => {
    const m = machine();
    const s = cancelSession();
    const out = await m.handleTurn({ ...baseInput(), session: s, text: "hm" });
    expect(s.step).toBe("confirmar_cancelamento_compromisso");
    expect(out.done).toBeUndefined();
  });
});

describe("Máquina Fase 4 — roteamento com fluxo aberto (spec regra 9)", () => {
  it('editar_compromisso/cancelar_compromisso com fluxo aberto: proteção "descartar o atual?" primeiro', async () => {
    const m = machine();
    const s = session({
      step: "notas",
      candidate: { title: "Atual", conflictTries: 0 },
    });
    for (const intentName of [
      "editar_compromisso",
      "cancelar_compromisso",
    ] as const) {
      s.step = "notas";
      const out = await m.handleTurn({
        ...baseInput(),
        session: s,
        text: "muda aquilo",
        classified: intent(intentName),
      });
      expect(s.step).toBe("confirmar_substituicao");
      expect(texts(out)).toContain("descartar");
    }
  });

  it("proteção preservada em confirmar_substituicao (re-classificou): re-posta a pergunta, nada descarta", async () => {
    const m = machine();
    const s = session({
      step: "confirmar_substituicao",
      prevStep: "notas",
      candidate: { title: "Atual", conflictTries: 0 },
    });
    const out = await m.handleTurn({
      ...baseInput(),
      session: s,
      text: "muda aquilo",
      classified: intent("editar_compromisso"),
    });
    expect(s.step).toBe("confirmar_substituicao"); // a pergunta continua de pé
    expect(out.done).toBeUndefined(); // nada descartado, nada salvo
    expect(texts(out)).toContain("descartar");
  });
});
