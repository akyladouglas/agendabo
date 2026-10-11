import { describe, expect, it } from "vitest";
import {
  NOTES_MIN_PHRASE_WORDS,
  NOTES_PREFIX_RE,
  parseNotesAnswer,
  parseYesNo,
} from "./messages";

/**
 * Spec notas-e-fim-na-web (regra A, decisões #1–#3): nota que COMEÇA com "não" mas é
 * frase real (≥ 4 palavras normalizadas) é NOTA LITERAL; negação curta (≤ 3) é
 * negativa ⇒ null. Correção do bug de produção 2026-10-10 ("Não esquecer nada na
 * volta" gravou sem nota) — gotcha 24. Regra pura de borda, zero LLM (ADR-004).
 */

describe("parseNotesAnswer — negação vs. frase real (spec A1–A4)", () => {
  it("negação isolada ⇒ sem nota (não regride: cada NO_WORDS sozinha)", () => {
    for (const no of ["não", "n", "no", "negado", "sem", "depois", "nenhuma"]) {
      expect(parseNotesAnswer(no)).toBeNull();
    }
    expect(parseNotesAnswer("não.")).toBeNull();
    expect(parseNotesAnswer("NADA")).toBeNull();
    expect(parseNotesAnswer("agora não")).toBeNull();
  });

  it("sinônimos curtos de \"não tenho\" ⇒ sem nota (≤ 3 palavras, casa negação na cabeça)", () => {
    expect(parseNotesAnswer("não tenho")).toBeNull();
    expect(parseNotesAnswer("não anota nada")).toBeNull();
    expect(parseNotesAnswer("sem notas")).toBeNull();
  });

  it("caso do bug de produção: \"Não escrever nada na volta\"? não — a real: frase ≥4 palavras é nota LITERAL integral", () => {
    expect(parseNotesAnswer("Não esquecer nada na volta")).toBe(
      "Não esquecer nada na volta",
    );
    // texto integral: sem stripping além do NOTES_PREFIX_RE, sem "limpeza"
    expect(parseNotesAnswer("não preciso levar nada")).toBe(
      "não preciso levar nada",
    );
  });

  it("fronteira exata da constante (spec A2): 3 palavras ⇒ null; 4 palavras ⇒ nota literal (parametrizado)", () => {
    expect(NOTES_MIN_PHRASE_WORDS).toBe(4);
    // 3 palavras normalizadas começando com negação ⇒ sem nota
    expect(parseNotesAnswer("não tenho nada")).toBeNull();
    // 4 palavras ⇒ nota literal
    expect(parseNotesAnswer("não esquecer nada aqui")).toBe(
      "não esquecer nada aqui",
    );
    // acento/pontuação não mudam a contagem (normalização da borda)
    expect(parseNotesAnswer("Não, não tenho nada!")).toBe(
      "Não, não tenho nada!",
    );
  });

  it("não regridem: \"anotar: X\" faz stripping do prefixo; \"sim\" não vira negativa; ruído segue o fluxo de hoje", () => {
    expect(parseNotesAnswer("anotar: levar o orçamento")).toBe(
      "levar o orçamento",
    );
    expect(parseNotesAnswer("Anotar levar o orçamento")).toBe(
      "levar o orçamento",
    );
    expect(NOTES_PREFIX_RE.test("obs: X")).toBe(true);
    // "sim" sozinha: hoje o form do passo trata sim como nota? parseYesNo continua true;
    // parseNotesAnswer devolve o texto (comportamento de hoje preservado — não vira null)
    expect(parseYesNo("sim")).toBe(true);
    expect(parseNotesAnswer("sim")).toBe("sim");
    // ruído curto ambíguo: devolve o texto cru (a máquina é quem re-pergunta ≤3 chars)
    expect(parseNotesAnswer("hm")).toBe("hm");
  });

  it("prefixo de nota NÃO casa dentro de frase longa que começa com negação (stripping só no começo)", () => {
    expect(parseNotesAnswer("não anotar nada antes de sair")).toBe(
      "não anotar nada antes de sair",
    );
  });
});
