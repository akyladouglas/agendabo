# 0000 — Adotar o processo ADR

- Status: Aceito
- Data: 2026-10-05

## Contexto

O projeto é construído com IAs em sessões sem memória de contexto entre fases. Sem um
registro explícito de decisões, cada sessão re-ergue as mesmas discussões (UTC? magic
link? turbo?) e pode "corrigir" escolhas deliberadas.

## Decisão

- Toda decisão de arquitetura não-óbvia vira um ADR em `ia-docs/decisions/pt-br/` ANTES
  (ou no mesmo commit) do código que a implementa.
- ADR é curto (Contexto/Decisão/Consequências), numerado, imutável após Aceito.
- Skill `.ia/skills/create-adr` define o fluxo; `.ia/rules/documentation.md` vincula.

## Consequências

- Dúvida sobre "por que X?" tem resposta citável.
- Trocar de ideia exige ADR novo com `Supersede` — o histórico fica lido, não editado.
