# 0006 — `ia-docs/decisions/` é o único lar dos ADRs

- Status: Aceito
- Data: 2026-10-05

## Contexto

O PROMPT menciona `docs/adr` (herança do financas) e `ia-docs/decisions` (herança do
nucleus-vue). Duas árvores de decisão divergem com o tempo: alguém lê uma, outra apodrece,
e a IA da próxima sessão não sabe qual consultar.

## Decisão

- ADRs vivem **somente** em `ia-docs/decisions/pt-br/` com índice em
  `ia-docs/decisions/README.md` e template `TEMPLATE-pt-br.md`.
- `docs/` fica para material operativo: `gotchas.md` (e afins).
- `.ia/rules/documentation.md` e a skill `create-adr` apontam todos para lá.

## Consequências

- Uma busca, um índice, um índice de verdade.
- Qualquer link antigo "docs/adr" (inclusive no PROMPT.md histórico) lê-se como
  `ia-docs/decisions`.
