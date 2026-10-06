# Processo — Agendabô

## Roadmap em fases (PROMPT.md)

Trabalhamos **fase por fase com deparo humano**: uma fase só termina quando build+test+
lint+lint:arch verdes, specs/planos atualizados, ADRs novos registrados, e o humano aprovar.

| Fase | Entrega                                                          |
| ---- | ---------------------------------------------------------------- |
| 0    | scaffold do monorepo + governança (este plano)                   |
| 1    | criar compromisso pelo bot (conflito 1.1, notas 1.3)             |
| 2    | lembretes parametrizáveis (1.2) + outbox/workers                 |
| 3    | extração em linguagem natural (LLM + needs_review)               |
| 4    | resumo diário parametrizável (2.1)                               |
| 5    | consulta de agenda em linguagem natural (2.2)                    |
| 6    | web: cadastro + confirmação por código (3.1/3.1.1) + login (3.2) |
| 7    | web: calendário (3.4) + fila de revisão (3.3)                    |

## Ciclo de uma feature

```
pedido → spec-writer → [humano aprova spec] → plano (ia-docs/plans/) → [humano aprova plano]
→ feature-builder / bot-flow-builder (+ test-writer; TDD obrigatório p/ regra)
→ gate: pnpm build && pnpm test && pnpm lint && pnpm lint:arch
→ review-orchestrator → resolve Crítico/Médio → commit convencional → deparo
```

## Convenções de commit

- [Conventional Commits](https://www.conventionalcommits.org/) em pt-br ou en
  (`feat(bot): ...`, `fix(schedule-core): ...`, `chore(deps): ...`).
- Hooks do husky: `commit-msg` valida com commitlint; `pre-commit` roda lint-staged
  (prettier em md/json/yml).
- Um commit por etapa do plano sempre que possível; nunca commitar `.env`.

## Infra de desenvolvimento

- `pnpm infra:up` (Postgres 5434, Redis 6381) — portas fora do padrão para conviver com
  outros projetos locais.
- `.env` na raiz (copiar de `.env.example`); nunca commitado.
- Bot em dev: `pnpm dev:bot` (processo único — gotcha 5).
