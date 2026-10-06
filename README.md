# Agendabô 🤖📅

Bot de agenda no **Telegram** com visão **web**. Você marca compromissos conversando com o
bot em linguagem natural; ele avisa sobre conflitos, pergunta notas e lembretes, e envia
lembretes + resumo diário. A web cuida de cadastro (com confirmação por email), calendário
e fila de revisão.

> Produto: LLM **interpreta**, regras **determinísticas** decidem (conflito/lembrete/data
> vivem em `packages/schedule-core`, 100% testados). Ver `PROMPT.md` e `ia-docs/`.

## Stack

- **apps/api** — NestJS 10, Prisma/Postgres, BullMQ/Redis, Telegraf, Anthropic SDK (isolado), argon2, Resend
- **apps/web** — Vue 3 + Vite 6 + Tailwind 4 + radix-vue + TanStack Vue Query + pinia
- **packages/contracts** — zod único das bordas (API ↔ web ↔ LLM)
- **packages/schedule-core** — domínio puro (conflito, triggers, datas)

## Subindo o projeto

```bash
cp .env.example .env      # preencha os segredos
pnpm install
pnpm infra:up             # Postgres :5434 + Redis :6381
pnpm --filter @agendabo/api prisma:migrate
pnpm build                # contracts → schedule-core → api → web
pnpm dev:api              # API em :3001
pnpm dev:web              # web em :5174
```

## Qualidade

```bash
pnpm test        # vitest (packages/api/web) + jest (services Nest)
pnpm lint        # eslint em tudo
pnpm lint:arch   # dependency-cruiser (grafo de módulos — ADR-007)
```

## Onde fica o quê

| Caminho           | O que é                                                               |
| ----------------- | --------------------------------------------------------------------- |
| `PROMPT.md`       | produto + roadmap (8 fases)                                           |
| `AGENTS.md`       | onboarding de qualquer IA — **leia antes de codar**                   |
| `.ia/`            | fonte canônica de agents/regras/skills/specs (`pnpm sync:ia` propaga) |
| `ia-docs/`        | arquitetura, ADRs, domínio, planos, processo                          |
| `docs/gotchas.md` | armadilhas reais já encontradas                                       |

Status: **Fase 0 concluída** (scaffold + governança). Ver `ia-docs/process/process.md`.
