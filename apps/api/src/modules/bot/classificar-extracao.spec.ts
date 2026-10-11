import { describe, expect, it } from "vitest";
import {
  classificarEdicao,
  classificarExtracao,
  dayFromResolvedUtc,
  type EdicaoVeredito,
  type ExtracaoVeredito,
} from "./extraction-ruler";

/**
 * A RÉGUA da Fase 4 (spec llm-avancado regra 6 / D1 do plano) — domínio puro, testado
 * ANTES da máquina mexer (risco de regressão do plano). Payload no shape BRUTO da tool
 * `extrair_agendamento` (o safeParse do zod é a primeira barreira; a régua é a segunda).
 */

const MIN_CONF = 0.7;
const NOW = new Date("2026-10-06T15:00:00Z"); // 12:00 em America/Sao_Paulo (-180)
const OFFSET = -180;

function payload(overrides: Record<string, unknown> = {}) {
  return {
    title: "Consulta",
    startsAt: "2026-10-08T14:00:00-03:00",
    durationMinutes: 60,
    confidence: 0.9,
    dateEvidence: "quinta que vem umas 14h",
    ...overrides,
  };
}

function classify(overrides: Record<string, unknown> = {}): ExtracaoVeredito {
  return classificarExtracao(payload(overrides), {
    minConfidence: MIN_CONF,
    now: NOW,
    offsetMinutes: OFFSET,
  });
}

describe("classificarExtracao — a régua (spec regra 6)", () => {
  it("aceito: confianca >= limiar e data futura => startUtc/endUtc materializados", () => {
    const v = classify();
    expect(v.verdict).toBe("aceito");
    if (v.verdict === "aceito") {
      expect(v.candidate.startUtc.toISOString()).toBe(
        "2026-10-08T17:00:00.000Z",
      );
      expect(v.candidate.endUtc.toISOString()).toBe("2026-10-08T18:00:00.000Z");
      expect(v.candidate.title).toBe("Consulta");
      expect(v.candidate.dateEvidence).toBe("quinta que vem umas 14h");
    }
  });

  it("duracao ausente => default da borda 60min (contrato do schema)", () => {
    const v = classify({ durationMinutes: undefined });
    expect(v.verdict).toBe("aceito");
    if (v.verdict === "aceito") {
      expect(
        v.candidate.endUtc.getTime() - v.candidate.startUtc.getTime(),
      ).toBe(60 * 60_000);
    }
  });

  // Gherkin A da spec fluxo-criacao-robusto: "das 8h às 17h do dia 12 sem duração
  // ⇒ o compromisso criado dura 9h (nada de default 60 min)".
  it("das 8h as 17h do dia 12 sem duracao => aceito com 9h exatas (540min), nao o default 60", () => {
    const v = classify({
      title: "plantao",
      startsAt: "2026-10-12T08:00:00-03:00",
      endsAt: "2026-10-12T17:00:00-03:00",
      durationMinutes: undefined,
    });
    expect(v.verdict).toBe("aceito");
    if (v.verdict === "aceito") {
      expect(v.candidate.startUtc.toISOString()).toBe(
        "2026-10-12T11:00:00.000Z",
      );
      expect(v.candidate.endUtc.toISOString()).toBe("2026-10-12T20:00:00.000Z");
      const durMin =
        (v.candidate.endUtc.getTime() - v.candidate.startUtc.getTime()) /
        60_000;
      expect(durMin).toBe(540); // 9h — o fim dito, nunca o default de 60min
    }
  });

  it("fraco: confianca baixa COM titulo e inicio => needs_review confianca_baixa", () => {
    const v = classify({ confidence: 0.4 });
    expect(v.verdict).toBe("fraco");
    if (v.verdict === "fraco") {
      expect(v.reviewReason).toBe("confianca_baixa");
      expect(v.candidate.startUtc.toISOString()).toBe(
        "2026-10-08T17:00:00.000Z",
      );
    }
  });

  it("fraco por confianca baixa => o TITULO extraido e so hipotese (via no candidate; B4/ADR-003: vive em rawText/revisao)", () => {
    // Gherkin B da spec fluxo-criacao-robusto: "regua => needs_review: o titulo
    // extraido vive so em rawText/revisao". A regua entrega a hipotese de titulo no
    // candidate (igual a qualquer campo); QUEM decide e o service: o bruto da fala e o
    // payload do needs_review (coberto ponta-a-ponta no jest do service).
    const v = classify({ title: "viagem para lucena", confidence: 0.3 });
    expect(v.verdict).toBe("fraco");
    if (v.verdict === "fraco") {
      expect(v.candidate.title).toBe("viagem para lucena"); // hipotese, nunca confirmacao
      expect(v.reviewReason).toBe("confianca_baixa");
    }
  });

  it("suspeito: confianca alta mas o instante resolvido esta no PASSADO => needs_review", () => {
    const v = classify({ startsAt: "2026-10-06T09:00:00-03:00" }); // hoje 09:00, agora 12:00 local
    expect(v.verdict).toBe("suspeito");
    if (v.verdict === "suspeito") {
      expect(v.reviewReason).toBe("data_no_passado");
    }
  });

  it("sem-quando: inicio ilegivel => re-pergunta (nunca needs_review na criacao)", () => {
    const v = classify({ startsAt: "2026-13-45T99:00:00-03:00" }); // data impossível
    expect(v.verdict).toBe("sem_quando");
  });

  it("inicio sem offset explicito => sem_quando (borda precisa do offset — ADR-002); a regex do zod já barra, a régua é cinto de segurança", () => {
    const v = classify({ startsAt: "2026-10-08T14:00:00" });
    expect(v.verdict).toBe("sem_quando");
  });

  it("offset devolvido inconsistente com o tz do usuario => fraco/parse_falho (spec regra 3: nunca confirmado em silêncio)", () => {
    // conta em -03:00, payload em -05:00: "quinta 14:00" não bate com o tz da conta
    const v = classify({ startsAt: "2026-10-08T14:00:00-05:00" });
    expect(v.verdict).toBe("fraco");
    if (v.verdict === "fraco") expect(v.reviewReason).toBe("parse_falho");
  });

  it("offset consistente (mesma conta em outro horário) NÃO é rejeitado", () => {
    const v = classify({ startsAt: "2026-10-08T20:30:00-03:00" });
    expect(v.verdict).toBe("aceito");
  });

  it("titulo vazio => invalido (cai no guiado em titulo — spec regra 5)", () => {
    const v = classify({ title: "   " });
    expect(v.verdict).toBe("invalido");
    if (v.verdict === "invalido") expect(v.reason).toBe("sem_titulo");
  });

  it("instante exatamente AGORA não é passado (half-open: só < now é suspeito)", () => {
    const v = classify({ startsAt: "2026-10-06T12:00:00-03:00" }); // == NOW
    expect(v.verdict).toBe("aceito");
  });

  it("dayFromResolvedUtc: dia no calendario local do usuario (quando parcial — decisao #5)", () => {
    // a borda resolveu "quinta" no tz da conta: qui 08/10 09:00 local (-03:00) = 12:00Z
    const day = dayFromResolvedUtc(new Date("2026-10-08T12:00:00Z"), OFFSET);
    expect(day).toEqual({ year: 2026, month: 10, day: 8 });
  });

  it("dayFromResolvedUtc: instante invalido => null (guiado do zero)", () => {
    expect(dayFromResolvedUtc(new Date("quando der"), OFFSET)).toBeNull();
  });
});

/**
 * Spec fluxo-criacao-robusto (A2/A3, decisao 5): `endsAt` explícito na extracao.
 * A regua materializa o fim dito pelo usuario (nunca calcula), precede durationMinutes
 * e NUNCA manda pra revisao por fim ilegitimo — re-pergunta (fim_invalido, ADR-010).
 */
describe("classificarExtracao — endsAt explícito (spec fluxo-criacao-robusto A2/A3)", () => {
  it("aceito multi-dia: endsAt valido => endUtc do endsAt, sem cap de duracao (Gherkin R1)", () => {
    // sáb 10/10 19:00-03:00 -> seg 12/10 17:00-03:00 (~46h, "viagem para lucena")
    const v = classify({
      title: "viagem para lucena",
      startsAt: "2026-10-10T19:00:00-03:00",
      endsAt: "2026-10-12T17:00:00-03:00",
      durationMinutes: undefined,
    });
    expect(v.verdict).toBe("aceito");
    if (v.verdict === "aceito") {
      expect(v.candidate.startUtc.toISOString()).toBe(
        "2026-10-10T22:00:00.000Z",
      );
      expect(v.candidate.endUtc.toISOString()).toBe("2026-10-12T20:00:00.000Z");
      const durMin =
        (v.candidate.endUtc.getTime() - v.candidate.startUtc.getTime()) /
        60_000;
      expect(durMin).toBe(46 * 60); // multi-dia licito: o cap de 1440 nao se aplica
    }
  });

  it("endsAt == startsAt => fim_invalido com o candidato do inicio (SEM needs_review)", () => {
    const v = classify({ endsAt: "2026-10-08T14:00:00-03:00" }); // mesmo instante do inicio
    expect(v.verdict).toBe("fim_invalido");
    if (v.verdict === "fim_invalido") {
      expect(v.candidate.title).toBe("Consulta");
      expect(v.candidate.startUtc.toISOString()).toBe(
        "2026-10-08T17:00:00.000Z",
      );
      expect(v.candidate).not.toHaveProperty("endUtc");
    }
  });

  it("endsAt ANTES do inicio => fim_invalido (re-pergunta o fim no ponto faltante)", () => {
    const v = classify({ endsAt: "2026-10-08T13:00:00-03:00" }); // 1h antes do inicio
    expect(v.verdict).toBe("fim_invalido");
  });

  it("endsAt cruzando meia-noite => aceito (caso-limite da spec: 22:00 -> 01:00 seguinte)", () => {
    const v = classify({
      startsAt: "2026-10-07T22:00:00-03:00",
      endsAt: "2026-10-08T01:00:00-03:00",
      durationMinutes: undefined,
    });
    expect(v.verdict).toBe("aceito");
    if (v.verdict === "aceito") {
      expect(v.candidate.endUtc.toISOString()).toBe("2026-10-08T04:00:00.000Z");
      const durMin =
        (v.candidate.endUtc.getTime() - v.candidate.startUtc.getTime()) /
        60_000;
      expect(durMin).toBe(180);
    }
  });

  it("endsAt sem offset explicito => fim_invalido (inicio preservado no candidate)", () => {
    const v = classify({ endsAt: "2026-10-08T17:00" });
    expect(v.verdict).toBe("fim_invalido");
    if (v.verdict === "fim_invalido") {
      expect(v.candidate.startUtc.toISOString()).toBe(
        "2026-10-08T17:00:00.000Z",
      );
      expect(v.candidate).not.toHaveProperty("endUtc");
    }
  });

  it("endsAt ilegivel (data impossivel com offset) => fim_invalido (regex da borda e cinto; a regua barreira 2)", () => {
    const v = classify({ endsAt: "2026-13-45T99:00:00-03:00" });
    expect(v.verdict).toBe("fim_invalido");
  });

  it("endsAt com offset != tz da conta => fraco/parse_falho mesmo com confianca alta (spec A2, regra do startsAt)", () => {
    const v = classify({ endsAt: "2026-10-08T20:00:00+00:00" }); // conta em -03:00
    expect(v.verdict).toBe("fraco");
    if (v.verdict === "fraco") {
      expect(v.reviewReason).toBe("parse_falho");
      // candidate materializado COM o endUtc do endsAt (mesma regra do startsAt divergente)
      expect(v.candidate.endUtc.toISOString()).toBe("2026-10-08T20:00:00.000Z");
    }
  });

  it("endsAt + durationMinutes inconsistentes => endUtc deriva do endsAt (precedencia A3)", () => {
    const v = classify({
      endsAt: "2026-10-08T17:00:00-03:00",
      durationMinutes: 15,
    });
    expect(v.verdict).toBe("aceito");
    if (v.verdict === "aceito") {
      expect(v.candidate.endUtc.toISOString()).toBe("2026-10-08T20:00:00.000Z"); // 3h, nao 15min
    }
  });

  it("endsAt ausente => default 60 (regressao: comportamento de hoje intacto)", () => {
    const v = classify({ durationMinutes: undefined });
    expect(v.verdict).toBe("aceito");
    if (v.verdict === "aceito") {
      expect(
        v.candidate.endUtc.getTime() - v.candidate.startUtc.getTime(),
      ).toBe(60 * 60_000);
    }
  });

  it("fraco por confianca baixa COM endsAt valido => candidate.endUtc do endsAt", () => {
    const v = classify({
      confidence: 0.4,
      endsAt: "2026-10-08T16:30:00-03:00",
    });
    expect(v.verdict).toBe("fraco");
    if (v.verdict === "fraco") {
      expect(v.reviewReason).toBe("confianca_baixa");
      expect(v.candidate.endUtc.toISOString()).toBe("2026-10-08T19:30:00.000Z");
    }
  });

  it("suspeito (inicio no passado) COM endsAt valido => endUtc do endsAt preservado no needs_review", () => {
    const v = classify({
      startsAt: "2026-10-06T09:00:00-03:00", // passado
      endsAt: "2026-10-06T11:00:00-03:00",
    });
    expect(v.verdict).toBe("suspeito");
    if (v.verdict === "suspeito") {
      expect(v.candidate.endUtc.toISOString()).toBe("2026-10-06T14:00:00.000Z");
    }
  });
});

describe("classificarEdicao — quando novo do editar (spec regra 10/20)", () => {
  function edit(overrides: Record<string, unknown> = {}): EdicaoVeredito {
    return classificarEdicao(
      {
        acao: "editar",
        confidence: 0.9,
        novoInicio: "2026-10-09T16:00:00-03:00",
        ...overrides,
      },
      { minConfidence: MIN_CONF, now: NOW, offsetMinutes: OFFSET },
    );
  }

  it("novo inicio confiante e futuro => ok com novoStartUtc (borda materializou a data)", () => {
    const v = edit();
    expect(v.verdict).toBe("ok");
    if (v.verdict === "ok") {
      expect(v.novoStartUtc?.toISOString()).toBe("2026-10-09T19:00:00.000Z");
    }
  });

  it("sem horario novo na fala (nem novoInicio, nem delta) => re-pergunta o horario", () => {
    const v = edit({ novoInicio: undefined });
    expect(v.verdict).toBe("reperguntar");
    if (v.verdict === "reperguntar") expect(v.reason).toBe("sem_quando");
  });

  it('apenas delta ("adianta 1h") => ok SEM novoStartUtc (a borda aplica applyShift na candidata)', () => {
    const v = edit({ novoInicio: undefined, deslocamentoMin: -60 });
    expect(v.verdict).toBe("ok");
    if (v.verdict === "ok") expect(v.novoStartUtc).toBeUndefined();
  });

  it("confianca baixa com horario plausivel => reperguntar confianca_baixa (NUNCA needs_review — regra 20)", () => {
    const v = edit({ confidence: 0.3 });
    expect(v.verdict).toBe("reperguntar");
    if (v.verdict === "reperguntar") expect(v.reason).toBe("confianca_baixa");
  });

  it("novo horario no passado => reperguntar data_no_passado", () => {
    const v = edit({ novoInicio: "2026-10-05T14:00:00-03:00" });
    expect(v.verdict).toBe("reperguntar");
    if (v.verdict === "reperguntar") expect(v.reason).toBe("data_no_passado");
  });

  it("offset inconsistente com o tz da conta => reperguntar offset_inconsistente (spec regra 3)", () => {
    const v = edit({ novoInicio: "2026-10-09T16:00:00-05:00" });
    expect(v.verdict).toBe("reperguntar");
    if (v.verdict === "reperguntar")
      expect(v.reason).toBe("offset_inconsistente");
  });

  it("novaDuracaoMin acompanha o ok (mudar duracao junto do horario)", () => {
    const v = edit({ novaDuracaoMin: 90 });
    expect(v.verdict).toBe("ok");
    if (v.verdict === "ok") expect(v.novaDuracaoMin).toBe(90);
  });
});
