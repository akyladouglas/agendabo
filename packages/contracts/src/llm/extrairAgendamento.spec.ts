import { describe, expect, it } from "vitest";
import {
  extrairAgendamentoSchema,
  extrairAgendamentoTool,
} from "./extrairAgendamento";

/**
 * Testes de parse da saida do LLM (testing.md no 2) para o schema ALTERADO da spec
 * fluxo-criacao-robusto (A1): `endsAt` opcional com a MESMA regex de offset do
 * `startsAt`. Cobre: payload valido com/sem endsAt, endsAt sem offset (rejeita),
 * endsAt ilegivel (rejeita), campo extra (strip — gotcha 4) e startsAt faltando.
 */
describe("extrairAgendamentoSchema", () => {
  it('1) payload valido COM endsAt parseia (intervalo "de 19h ate 17h segunda" — spec A1)', () => {
    const parsed = extrairAgendamentoSchema.safeParse({
      title: "viagem para lucena",
      startsAt: "2026-10-10T19:00:00-03:00",
      endsAt: "2026-10-12T17:00:00-03:00",
      confidence: 0.9,
      dateEvidence: "de 19h hoje e vai ate 17h na segunda",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.endsAt).toBe(
      "2026-10-12T17:00:00-03:00",
    );
  });

  it("2) payload valido SEM endsAt parseia (campo opcional — hoje continua ok)", () => {
    const parsed = extrairAgendamentoSchema.safeParse({
      title: "consulta",
      startsAt: "2026-10-08T14:00:00-03:00",
      durationMinutes: 45,
      confidence: 0.85,
    });
    expect(parsed.success).toBe(true);
    // cast: endsAt nao existe no tipo quando ausente — só checo a ausencia
    expect(
      (parsed.success && (parsed.data as Record<string, unknown>))["endsAt"],
    ).toBeUndefined();
  });

  it("3) endsAt SEM offset explicito => rejeita (mesma regra do startsAt — ADR-002)", () => {
    const parsed = extrairAgendamentoSchema.safeParse({
      title: "consulta",
      startsAt: "2026-10-08T14:00:00-03:00",
      endsAt: "2026-10-12T17:00",
      confidence: 0.9,
    });
    expect(parsed.success).toBe(false);
  });

  it('4) endsAt ilegivel ("not-a-date" no formato da regex) => rejeita', () => {
    const parsed = extrairAgendamentoSchema.safeParse({
      title: "consulta",
      startsAt: "2026-10-08T14:00:00-03:00",
      endsAt: "not-a-date",
      confidence: 0.9,
    });
    expect(parsed.success).toBe(false);
  });

  it("5) campo extra e ignorado (strip, NAO strict — gotcha 4)", () => {
    const parsed = extrairAgendamentoSchema.safeParse({
      title: "consulta",
      startsAt: "2026-10-08T14:00:00-03:00",
      endsAt: "2026-10-08T15:00:00-03:00",
      confidence: 0.9,
      motivo: "viagem",
    });
    expect(parsed.success).toBe(true);
    // cast: campo extra sumiu no strip
    expect(
      parsed.success && (parsed.data as Record<string, unknown>)["motivo"],
    ).toBeUndefined();
  });

  it("6) startsAt faltando => rejeita (obrigatorio como hoje)", () => {
    const parsed = extrairAgendamentoSchema.safeParse({
      title: "consulta",
      confidence: 0.9,
    });
    expect(parsed.success).toBe(false);
  });

  it('6b) confidence faltando => rejeita (obrigatoria — testing.md no 2 "campo faltando"; a borda trata safeParse fail como needs_review/guiado)', () => {
    const parsed = extrairAgendamentoSchema.safeParse({
      title: "consulta",
      startsAt: "2026-10-08T14:00:00-03:00",
      endsAt: "2026-10-08T15:00:00-03:00",
    });
    expect(parsed.success).toBe(false);
  });

  it('6c) confidence fora de 0..1 => rejeita (o payload do schema e o do payload INVALIDO; "confianca baixa VALIDA" (ex.: 0.3) e aceita pelo zod e vira needs_review na REGUA, nao no parse — ver classificar-extracao.spec.ts)', () => {
    expect(
      extrairAgendamentoSchema.safeParse({
        title: "consulta",
        startsAt: "2026-10-08T14:00:00-03:00",
        confidence: 1.5,
      }).success,
    ).toBe(false);
    expect(
      extrairAgendamentoSchema.safeParse({
        title: "consulta",
        startsAt: "2026-10-08T14:00:00-03:00",
        confidence: -0.1,
      }).success,
    ).toBe(false);
    // baixa confianca valida passa aqui e e a REGUA quem decide needs_review (ADR-010)
    expect(
      extrairAgendamentoSchema.safeParse({
        title: "consulta",
        startsAt: "2026-10-08T14:00:00-03:00",
        confidence: 0.3,
      }).success,
    ).toBe(true);
  });

  it("tool espelha o zod: endsAt em properties SEM estar em required, sem additionalProperties (gotcha 4)", () => {
    const tool = extrairAgendamentoTool.input_schema;
    expect(tool.required).toEqual(["title", "startsAt", "confidence"]);
    expect(tool.properties).toHaveProperty("endsAt");
    // sem strict (gotcha 4): additionalProperties continua ausente
    expect(
      (extrairAgendamentoTool.input_schema as Record<string, unknown>)[
        "additionalProperties"
      ],
    ).toBeUndefined();
  });
});
