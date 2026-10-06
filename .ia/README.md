# `.ia/` — Biblioteca canônica de IA (fonte única)

Esta pasta é a **fonte de verdade** para agentes, orquestradores, skills, regras e specs do
Agendabô. O projeto usa **várias IAs** (Claude Code, OpenCode, e outras); para não duplicar
conteúdo por harness, tudo é canônico aqui e sincronizado para as pastas que cada harness
escaneia.

## Estrutura

```
.ia/
├── agents/         # workers — fonte canônica
│   ├── spec-writer.md
│   ├── feature-builder.md      # API (NestJS) + web (Vue)
│   ├── bot-flow-builder.md     # fluxos de conversa do Telegram + LLM
│   ├── test-writer.md
│   ├── code-reviewer.md
│   ├── unit-test-code-reviewer.md
│   └── review-*.md             # 7 especialistas de review
├── orchestrators/  # orquestradores — fonte canônica
│   ├── feature-orchestrator.md
│   ├── refactor-orchestrator.md
│   └── review-orchestrator.md
├── skills/         # skills (espelhadas para .agents/skills, .claude/skills, .opencode/skills)
│   ├── vue-best-practices/
│   ├── coding-guidelines/
│   ├── security/
│   ├── tdd/
│   └── create-adr/
├── rules/          # regras temáticas — lidas por caminho .ia/rules/<nome>.md por qualquer IA
│   ├── default-architecture.md # camadas NestJS + monorepo
│   ├── schedule-core.md        # domínio puro
│   ├── testing.md
│   ├── vue.md
│   ├── llm.md                  # zod na saída, confiança → needs_review
│   ├── documentation.md
│   └── plans.md                # formato canônico de planos + contrato de orquestração
└── specs/          # specs de features (escritas pelo spec-writer), um por <domínio>/<feature>
```

## Como funciona o sync

`pnpm sync:ia` (script: `scripts/sync-ia.mjs`) lê `.ia/` e gera as pontas:

| Origem (canônico)        | Destino (pontas, não versionadas)                         | Transformação                                                               |
| ------------------------ | --------------------------------------------------------- | --------------------------------------------------------------------------- |
| `.ia/agents/*.md`        | `.claude/agents/*.md`                                     | idêntico (frontmatter Claude)                                               |
| `.ia/agents/*.md`        | `.opencode/agents/*.md`                                   | frontmatter adaptado (`mode: subagent`)                                     |
| `.ia/orchestrators/*.md` | `.claude/agents/*.md`                                     | frontmatter com `tools: Agent(<allowlist>)` + bloco `@claude` (modo inline) |
| `.ia/orchestrators/*.md` | `.opencode/agents/*.md`                                   | frontmatter com `permissions` + bloco `@opencode` (modo subagent)           |
| `.ia/skills/*`           | `.agents/skills/`, `.claude/skills/`, `.opencode/skills/` | espelho integral                                                            |
| `AGENTS.md` (raiz)       | `CLAUDE.md` (raiz)                                        | espelho integral                                                            |

Os orquestradores canônicos usam marcadores `<!-- @claude:begin -->` / `<!-- @opencode:begin -->`
para ter um bloco de execução por harness; o sync mantém apenas o bloco do harness de destino.

## Regras (obrigatórias)

1. **Edite aqui** (`.ia/`) — **nunca** edite as pontas (`.claude/agents/`, `.opencode/`,
   `.agents/`, `CLAUDE.md`). Elas começam com um comentário "gerado por sync-ia.mjs — não edite".
2. **Após editar qualquer arquivo em `.ia/` (ou `AGENTS.md`), rode `pnpm sync:ia`** antes de
   commitar.
3. **Regras temáticas** são referenciadas por caminho `.ia/rules/<nome>.md` (a fonte de verdade) —
   não dependem de descoberta automática de harness.
4. **Specs** são criadas pelo `spec-writer` em `.ia/specs/<domínio>/<feature>.spec.md`.
   **Toda feature vira spec antes de virar código.**
5. **Planos de trabalho** de qualquer IA vão para `ia-docs/plans/<feature>.plan.md`.
6. **ADRs** vivem em `ia-docs/decisions/pt-br/` (único lar de decisões; ver ADR-006).
