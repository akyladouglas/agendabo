# Architecture Overview — Agendabô

> Atualize junto da mudança que altera a estrutura (regra documentation.md).

## Sistema (como é hoje, Fase 0)

Monolito modular em monorepo pnpm (ADR-000). Orquestração de tasks via `pnpm -r`
(intencionalmente sem turbo).

```
Telegram ──▶ Bot (apps/api, long-polling Telegraf) ─▶ services ─▶ schedule-core (regras)
                                        │                └▶ modules/ai (Anthropic SDK isolado)
apps/web (Vue) ─HTTP/JWT─▶ apps/api (Nest) ─▶ Prisma ─▶ Postgres
                              │  └▶ BullMQ workers ◀▶ Redis (disparos de lembrete, resumo)
Resend (email de verificação)
```

## Packages & apps

| Unit                     | Papel                                                  | Regras                              |
| ------------------------ | ------------------------------------------------------ | ----------------------------------- |
| `packages/contracts`     | zod único p/ bordas API↔web↔LLM + tool schemas         | fonte de DTO; CJS build             |
| `packages/schedule-core` | domínio puro: conflito, triggers, datas                | `.ia/rules/schedule-core.md`        |
| `apps/api`               | Nest 10 + Prisma + BullMQ + Telegraf + Anthropic SDK   | `.ia/rules/default-architecture.md` |
| `apps/web`               | Vue 3 + Vite + Tailwind 4 + radix-vue + TanStack Query | `.ia/rules/vue.md`                  |

## API — módulos

- `auth`: signup/verificação de código (quota 3/30min)/login/refresh; JWT dual (access 15m
  em memória + refresh 30d cookie httpOnly rotacionado); dono do `MailService` (Resend).
- `users`: perfil/preferências (timezone, resumoDiarioHora).
- `appointments`: CRUD + check-conflict (regra em schedule-core; 409 com o compromisso que
  choca).
- `bot`: handler Telegraf fino + máquina de estados do agendamento + `BotAccessService`
  (gate de telegramId confirmado). Único com Telegraf além de `shared/telegram`.
- `ai`: único com Anthropic SDK; expõe `AnthropicMessagesClient` (interface) + cascata
  haiku→sonnet; prompts com bloco estável cacheável + bloco volatile (hoje/tz).
- `notifications`: outbox (linha Postgres = verdade) + workers BullMQ (`notifications-dispatch`,
  `notifications-schedule`) + cron do resumo diário (idempotente por usuário/dia).
- `shared/prisma`, `shared/telegram` (client outbound), `shared/identity` (CurrentUser).

Guard global `JwtAuthGuard` deny-by-default (`@Public()` opt-in). Env tipado via
`config/env.validation.ts` (zod, espelho de `.env.example`).

## Fluxos-chave

**Agendar (bot)**: fala → LLM `extrair_agendamento` (zod+confiança) → needs_review se fraco
→ `findConflict` (schedule-core) → pergunta notas → pergunta lembretes → cria `confirmed` +
materializa `NotificationOutbox` (computeTriggers) → jobs BullMQ.

**Lembrete**: job dispara → lê outbox → Telegram → status `sent/failed` (retry/backoff).

**Resumo diário**: cron por minuto → usuários cujo `resumoDiarioHora` (tz local) chegou →
compromissos do dia civil + lembretes que vencem hoje → mensagem → marca enviado (idempotente).

**Conta nova**: signup → código sha256 TTL 15min (Resend) → verify → `emailConfirmedAt` →
login só então.

## Decisões estruturais

ADRs em `ia-docs/decisions/pt-br/` — 0000–0007 cobrem: processo ADR, monolito monorepo sem
microserviços, UTC+tz, código vs magic link, LLM não decide conflito, CJS nos packages,
ia-docs único lar dos ADRs, e o grafo de imports (`CROSS_MODULE_EDGES` em
`apps/api/.dependency-cruiser.cjs`).
