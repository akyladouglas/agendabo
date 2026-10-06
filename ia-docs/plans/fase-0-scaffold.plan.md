# Plano — Fase 0: scaffold do monorepo + governança

- Data: 2026-10-05 | Status: concluído
- Orquestrador: humano + IA | Fase do roadmap: 0

## 1. Objetivo

Scaffold completo do monorepo (apps/api Nest, apps/web Vue, packages contracts/schedule-core),
infra local (Postgres+Redis), base de auth/cadastro funcional e a máquina de governança `.ia/`
com sync para os harnesses — base para as Fases 1–7.

## 2. Análise de profundidade

Base técnica herdada do projeto `financas` (mesma stack, gotchas mapeados em docs/gotchas.md)
e governança adaptada de `nucleus-vue` (`.ia/` canônico + sync-ia + ia-docs). Decisões
fechadas com o humano antes de codar (sem turbo; sync desde a Fase 0; ia-docs único lar dos
ADRs; todos os skills adaptados).

## 3. Decisões

| #   | Decisão                                     | Alternativa descartada | Por quê                                  |
| --- | ------------------------------------------- | ---------------------- | ---------------------------------------- |
| D1  | orquestração `pnpm -r`, sem turbo           | turbo.json             | alinhamento total com financas (ADR-001) |
| D2  | máquina de sync do nucleus desde a Fase 0   | pontas manuais         | multi-harness desde o dia 1              |
| D3  | ADRs só em `ia-docs/decisions/`             | docs/adr               | evita duas árvores (ADR-006)             |
| D4  | todos os skills adaptados na Fase 0         | levar só tdd           | regras vivas precisam de exemplos        |
| D5  | Postgres 5434 / Redis 6381                  | portas padrão          | conviver com financas local              |
| D6  | zod nas bordas (ValidationPipe passthrough) | class-validator        | contracts único (ADR)                    |

## 4. Etapas

| #   | Etapa                                                  | Worker | Status | Saída (condição de pronta)                                                       | Relatório |
| --- | ------------------------------------------------------ | ------ | ------ | -------------------------------------------------------------------------------- | --------- |
| 1   | raiz do monorepo + infra + gotchas                     | —      | feita  | install ok; compose sobe                                                         | —         |
| 2   | packages contracts + schedule-core + testes            | —      | feita  | 29 testes verdes; build ok                                                       | —         |
| 3   | apps/api (Nest + Prisma + BullMQ + guard + módulos)    | —      | feita  | typecheck/build/test/lint/lint:arch verdes; /health 200; migration init aplicada | —         |
| 4   | apps/web (Vite+Tailwind4+router+stores+placeholders)   | —      | feita  | build/test/lint verdes                                                           | —         |
| 5   | governança `.ia/` + `ia-docs/` + ADRs 0000–0007 + sync | —      | feita  | sync-ia gera pontas                                                              | —         |
| 6   | smoke do fluxo signup→código (banco) + commit inicial  | —      | feita  | user+verification_code criados                                                   | —         |

## 5. Próxima ação

Fase 1 (criar compromisso pelo bot — conflito 1.1 + notas 1.3): aguardar OK do humano;
spec em `.ia/specs/agendamento/criar-compromisso-bot.spec.md` primeiro.

## 6. Log

- 2026-10-05 23:00 — plano aprovado (4 perguntas respondidas pelo humano)
- 2026-10-06 00:30 — etapas 1–6 concluídas; todos os gates verdes; ADRs 0000–0007 aceitos
