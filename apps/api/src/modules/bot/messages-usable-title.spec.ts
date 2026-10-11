import { describe, expect, it } from "vitest";
import { INTENTION_PREFIXES, usableTitle } from "./messages";

/**
 * Heurística B2 da spec fluxo-criacao-robusto (plano D4): título sugerido pelo modelo é
 * UTILIZÁVEL? Determinística e pura — a frase inteira (≥ 80% da fala normalizada) e
 * prefixo de intenção ("tenho um novo compromisso…") NUNCA viram título (B1/B3).
 */

const FALAincidente =
  "Tenho um novo compromisso, uma viagem para lucena de 19h hoje e vai até 17h na segunda";

describe("usableTitle — heurística B2 (título nunca é a fala)", () => {
  it("falsa quando o título é vazio/sofrível de espaço", () => {
    expect(usableTitle("", FALAincidente)).toBe(false);
    expect(usableTitle("   ", FALAincidente)).toBe(false);
  });

  it("falsa quando o título ≈ a fala quase integralmente (>= 0.8 do comprimento normalizado)", () => {
    // a fala inteira como título (o bug de produção de 2026-10-10)
    expect(usableTitle(FALAincidente, FALAincidente)).toBe(false);
    // 90% da fala (ainda é frase, não nome)
    const quase = FALAincidente.slice(
      0,
      Math.round(FALAincidente.length * 0.9),
    );
    expect(usableTitle(quase, FALAincidente)).toBe(false);
  });

  it("falsa quando o título COMEÇA com prefixo de intenção (lista testável)", () => {
    expect(
      usableTitle(
        "tenho um novo compromisso",
        "tenho um novo compromisso amanhã",
      ),
    ).toBe(false);
    expect(
      usableTitle("Quero marcar consulta", "quero marcar consulta sexta"),
    ).toBe(false);
    expect(usableTitle("bora consulta", "bora consulta amanhã às 9h")).toBe(
      false,
    );
    for (const prefix of INTENTION_PREFIXES) {
      expect(
        usableTitle(`${prefix} tal`, `${prefix} tal amanhã às 9h do lado`),
      ).toBe(false);
    }
  });

  it("verdadeira para título curto do evento (ecoado sem pergunta — B4)", () => {
    expect(usableTitle("viagem para Lucena", FALAincidente)).toBe(true);
    expect(
      usableTitle("Consulta", "marca consulta quinta que vem umas 14h"),
    ).toBe(true);
  });

  it("normalização simples: acento, caixa e espaços não mudam o veredito", () => {
    // mesmo texto com acento/caixa/espaços duplicados continua sendo "a fala"
    expect(
      usableTitle(FALAincidente.toUpperCase(), `  ${FALAincidente}  `),
    ).toBe(false);
    expect(usableTitle("Viagem  para  Lucena", FALAincidente)).toBe(true);
    expect(
      usableTitle("fábrica de pães", "vou na fábrica de pães amanhã"),
    ).toBe(true);
  });

  it("título que só CONTÉM o prefixo (não começa com ele) é utilizável", () => {
    // "reunião sobre metas" não é verbo de intenção no início
    expect(
      usableTitle("reunião de metas", "marca reunião de metas sexta às 10h"),
    ).toBe(true);
  });
});
