# Architecture Overview — Agendabô

> Atualize junto da mudança que altera a estrutura (regra documentation.md).

## Sistema (como é hoje, Fase 0)

Monolito modular em monorepo pnpm (ADR-000). Orquestração de tasks via `pnpm -r`
(intencionalmente sem turbo).

```
Telegram ──▶ Bot (apps/api, long-polling Telegraf + cron do resumo) ─▶ services ─▶ schedule-core (regras)
                                        │                └▶ modules/ai (Anthropic SDK isolado)
apps/web (Vue) ─HTTP/JWT─▶ apps/api (Nest) ─▶ Prisma ─▶ Postgres
                              │  └▶ fila BullMQ "notifications-dispatch" ◀▶ Redis
pnpm dev:worker ─▶ PROCESSO WORKER próprio ─▶ DispatchService ─▶ Telegram (envio real)
Resend (email de verificação)
```

Três processos, um código (ADR-009): **API** (HTTP + cron de materialização do digest),
**bot** (long-polling único — gotcha 5) e **worker de notificações** (`apps/api/src/
workers/notifications-worker.ts`; pode viver tanto quanto um lembrete, restart do bot
não mata job em voo). Postgres = verdade dos disparos (outbox); Redis = só entrega.

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
- `notifications`: outbox (linha Postgres = verdade) + fila BullMQ `notifications-dispatch`
  consumida pelo **processo worker próprio** (ADR-009, `src/workers/notifications-worker.ts`).
  `OutboxService` materializa (computeTriggers, transacional)/enfileira/invalida;
  `DigestSchedulingService` (cron por minuto, no processo da API/bot) materializa resumos
  do dia (idempotente por usuário/dia via índice único parcial no Postgres);
  `DispatchService` envia (gates de `confirmed`, stale, retry/`failed`).
- `shared/prisma`, `shared/telegram` (client outbound), `shared/identity` (CurrentUser).

Guard global `JwtAuthGuard` deny-by-default (`@Public()` opt-in). Env tipado via
`config/env.validation.ts` (zod, espelho de `.env.example`).

## Fluxos-chave

**Agendar (bot)**: fala → LLM `extrair_agendamento` (zod+confiança) → needs_review se fraco
→ `findConflict` (schedule-core) → pergunta notas → pergunta lembretes → cria `confirmed` +
materializa `NotificationOutbox` (computeTriggers) → jobs BullMQ.

**Lembrete**: criação do compromisso → `computeTriggers` materializa N linhas de outbox
(uma por regra) na mesma transação; jobs com `delay` pós-commit. Worker → relê DB →
gate `confirmed` → Telegram → `sent` (claim condicional = envio idempotente). Retraso >
`NOTIFY_STALE_MINUTES` → `failed` sem enviar; 3 tentativas → `failed` + `lastError`.

**Resumo diário**: cron por minuto (processo API/bot) → usuários cujo `resumoDiarioHora`
(tz local) chegou na janela de 60s → materializa outbox `digest` do dia (índice único
parcial impede duplicata) → worker monta a mensagem dos `confirmed` do dia local
(vazio = "☀️ Hoje você está livre!") → envia.

**Conta nova**: signup → código sha256 TTL 15min (Resend) → verify → `emailConfirmedAt` →
login só então.

## Decisões estruturais

ADRs em `ia-docs/decisions/pt-br/` — 0000–0007 cobrem: processo ADR, monolito monorepo sem
microserviços, UTC+tz, código vs magic link, LLM não decide conflito, CJS nos packages,
ia-docs único lar dos ADRs, e o grafo de imports (`CROSS_MODULE_EDGES` em
`apps/api/.dependency-cruiser.cjs`). **0008**: (Fase 2) — revisar. **0009**: worker de
notificações como processo próprio (Fase 3).
