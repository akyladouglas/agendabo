# Plano — Fase 3: notificações (lembretes 1.2 + resumo diário 2.1)

- Data: 2026-10-07 | Status: CONCLUÍDA (gates 4/4 verdes; pendências no §7)
- Spec: `.ia/specs/notificacoes/lembretes-e-resumo-diario.spec.md` (aprovada) | Fase do roadmap: 3
- Orquestrador: feature-orchestrator | v1

## 1. Objetivo

O bot passa a perguntar o esquema de **lembrete** a cada agendamento (os 5 cenários do
PROMPT.md: 24h antes · 1/2/3 dias · contagem 3-2-1 · combinação livre · sem lembrete),
materializa os disparos determinísticos no **outbox + BullMQ**, e envia o **resumo
diário** na hora local do usuário. Regra central preservada: `computeTriggers` decide
QUANDO; o LLM só traduz a fala das regras (ADR-004/008).

## 2. Análise de profundidade (o que já existe)

- `schedule-core/notifications.ts`: `computeTriggers(startsAt, rules, { now })` (descarta
  passado, dedupe 24h≡1d, expande 3-2-1) + `appointmentsOnUserDay` — **testados, a feature
  consome**. Estender só se necessário (com teste no mesmo commit).
- Prisma: `NotificationRule` (type/value, N:1 Appointment) — sem campo novo;
  `NotificationOutbox` (appointmentId, firesAt, status pending|sent|failed, attempts,
  lastError) — **migração**: `kind` (reminder|daily_digest), `userId`, `appointmentId`
  nullable, status `cancelled`, única parcial p/ digest. `User.resumoDiarioHora` já existe.
- `contracts`: `notificationRuleInputSchema` (borda já usada pelo create web); padrão de
  tool llm consolidado (extrairAgendamento/classifyIntent/interpretarConsulta).
- `modules/ai`: padrão de interpretador estabelecido (IntentClassifierService /
  ConsultaInterpreterService) — terceiro serviço segue o mesmo trilho.
- `modules/bot`: máquina de estados com passos até `notas → confirmacao`; insere `lembrete`
  no meio. `messages.ts` com textos PT-BR.
- `AppointmentsService.create/update`: create grava regras; **update ainda não invalida
  outbox** (regra 9 da spec). BullMQ/`@nestjs/schedule`: pacotes instalados, nenhum worker.
- Redis no docker (6381); `REDIS_URL` no env.

## 3. Decisões

| #   | Decisão                                                                                             | Alternativa descartada        | Por quê                                                                 |
| --- | --------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------- |
| D1  | Multi-regra por compromisso (N `NotificationRule`)                                                  | cardápio de 1 opção           | decisão do humano; habilita combinação livre e 3-2-1                    |
| D2  | Passo `lembrete` na máquina entre notas e confirmação                                               | fluxo separado                | decisão do humano; PROMPT.md: "a cada agendamento, perguntar"           |
| D3  | Extração por LLM só das regras (`extrairLembreteSchema`); "não"/"sem lembrete" determinístico       | LLM decide tudo               | ADR-004; resposta curta inequívoca não gasta LLM (precedente das notas) |
| D4  | Outbox é a fonte de verdade da idempotência (`pending→sent` condicional); job só carrega `outboxId` | status no job BullMQ          | restart/retry nunca reenvia; spec regra 12                              |
| D5  | Worker BullMQ em processo próprio (`dev:worker`)                                                    | rodar dentro do bot ou da API | gotcha 5 + responsabilidade única; cron da API só ENFILEIRA digest      |
| D6  | Digest idempotente por constraint única parcial `(userId, kind, firesAt)`                           | lock/flag no cron             | API reiniciada no meio da varredura não duplica (spec 16)               |
| D7  | Gatro atrasado > `NOTIFY_STALE_MINUTES` (30) ⇒ `failed`                                             | enviar mesmo atrasado         | lembrete obsoleto piora a confiança (spec 14)                           |
| D8  | Worker revalida `confirmed` na hora do disparo                                                      | confiar no estado da criação  | needs_review/cancelado nunca vaza lembrete (decisão #4)                 |

## 4. Etapas

| #   | Etapa                                                                                                                                                                                | Worker           | Status | Saída (condição de pronta)                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- | ------ | ------------------------------------------------------------------------------------- |
| 1   | `contracts`: `extrairLembreteSchema`/`Tool` (regras: `NotificationRuleInput[]` + confidence; sem `.strict`) + testes de parse (4 payloads)                                           | feature-builder  | ✅     | build+test contracts ok                                                               |
| 2   | Migração Prisma: outbox `kind`/`userId`/nullable/`cancelled` + única parcial + relação User                                                                                          | feature-builder  | ✅     | `prisma:migrate` aplicado; `prisma generate` ok                                       |
| 3   | `modules/notifications`: `OutboxService` (materializar regras→linhas pending, invalidar/recriar no update, enfileirar jobs) + módulo BullMQ (`REDIS_URL`)                            | feature-builder  | ✅     | testes: materializa N linhas, update cancela+recria, gatilho passado gera zero linhas |
| 4   | `AppointmentsService`: create passa a materializar outbox na transação; update invalida/recria (regras 6/9/10)                                                                       | feature-builder  | ✅     | testes de serviço (prisma mock): fluxo completo + update                              |
| 5   | `modules/ai`: `ReminderInterpreterService` (padrão dos outros dois; "não"/atalhos determinísticos ANTES do LLM)                                                                      | feature-builder  | ✅     | testes com stub (5 payloads: combinada, 3-2-1, low confidence, parse falho, none)     |
| 6   | Máquina de estados: novo passo `lembrete` (pergunta com atalhos, fala natural, re-pergunta em dúvida, aviso de gatilho retroativo), resumo final com `⏰`, rewind "alterar lembrete" | feature-builder  | ✅     | testes da máquina cobrindo spec (Gherkin A)                                           |
| 7   | Worker de disparo (`src/workers/`): idempotência, gate de conta, retry 3x backoff, stale, needs_review→cancelled; digest: monta mensagem via schedule-core + outbox                  | bot-flow-builder | ✅     | testes jest cobrindo Gherkin C/D; script `dev:worker`                                 |
| 8   | Resumo diário: cron `@nestjs/schedule` na API enfileira digest por usuário no horário local (tz borda); mensagens PT-BR (dia livre, vencendo hoje)                                   | bot-flow-builder | ✅     | testes: 2 fusos, idempotência mesmo firesAt, dia vazio, vencendo-hoje                 |
| 9   | Textos PT-BR em `messages.ts` (pergunta de lembrete, aviso retroativo, lembrete, resumo, dia livre)                                                                                  | bot-flow-builder | ✅     | strings centralizadas; humano revisa no PR                                            |
| 10  | `.dependency-cruiser.cjs`: arestas `bot→notifications`, `appointments→notifications`, workers; scripts `dev:worker` no package.json                                                  | feature-builder  | ✅     | `pnpm lint:arch` verde                                                                |
| 11  | Testes mínimos (spec 23) + smoke manual (bot real + worker + redis)                                                                                                                  | test-writer      | ✅     | `pnpm test` verde; Gherkin da spec coberto                                            |
| 12  | Gate + docs: `docs/cenarios-do-bot.md` (seção lembretes/resumo + mover "ainda não faz"), `architecture-overview` (processo worker), gotcha se nascer                                 | code-reviewer    | ✅     | 4 gates verdes; docs atualizados no mesmo commit                                      |

Status: pendente | em execução | feita | bloqueada | feita com ressalvas

## 5. Próxima ação

Aguardar **aprovação humana**. Ao aprovar: etapas 1→2→3→4 (esqueleto determinístico com
TDD) → 5→6 (fluxo do bot) → 7→8 (worker + digest) → 9→12.

## 6. Riscos

- **BullMQ × gotcha 5**: três processos em dev (api, bot, worker) — documentar no plano
  de smoke; nenhum deles pode criar segundo consumidor Telegram.
- **Migração em tabela com dados**: outbox tem poucas linhas em dev; migration tolerante
  (appointmentId nullable + defaults) testada com `prisma migrate dev` local.
- **Cron por minuto × fusos**: varredura usa offset de `dates.ts` (nunca hora do servidor);
  teste com `now` fixado em transbordo de meia-noite.
- **Dedupe 24h/1d** já é do computeTriggers — não reimplementar.

## 7. Log

- 2026-10-07 — spec aprovada (6 decisões + multi-regra + passo no criar). Plano v1
  escrito; aguardando aprovação (não implementar antes).
- 2026-10-07 — plano aprovado; implementação (esta sessão). Notas de execução:
  - **D1–D6 + multi-regra** implementados como aprovado. Extra: passo `lembrete` entre
    `notas` e `confirmacao`; rewind "alterar lembretes"; aviso de gatilho retrassado só
    no bot (web silencioso — D3).
  - **schedule-core**: só texto puro novo (`reminder-text.ts`: `describeLeadTime`/
    `ruleLabelPtBr`/`rulesLabelsPtBr` + 10 testes). Quando continua 100% `computeTriggers`.
  - **Processos (ADR-009)**: worker próprio `src/workers/notifications-worker.ts`
    (`pnpm dev:worker`, raiz + api); HTTP/cron no `dev:api`; bot em `dev:bot`. O cron de
    digest só roda no processo da API/bot (no worker os @Cron ficam sem SchedulerRegistry).
  - **Queue renomeada** `notifications-dispatch` (era placeholder `notifications-schedule`);
    nome mora em `notifications.queue.ts` (quebra circular depcruise). `workers` entrou no
    grafo (`.dependency-cruiser.cjs`) e pode importar services.
  - **Retry (critério 9)**: BullMQ backoff + contador em memória do DispatchService — 3ª
    falha in-process ⇒ `failed`+`lastError` (não relança). Restart do worker zera o
    contador in-process; `attempts` no banco é a verdade p/ stale. Aceito (spec 14).
  - **Índice único parcial do digest**: a migration `20261007160136_fase3_outbox_kind` NÃO
    o contém (Prisma não expressa índice parcial). Aplicado via `prisma db execute` no dev
    - SQL documentado na própria migration. **Antes de deploy: regenerar migrations em
      ambiente limpo** e conferir o índice.
  - **Testes**: +50 casos novos (contracts 2 specs, reminder-text 10, reminder-shortcut,
    reminder-interpreter 7, digest 6, outbox 7, dispatch 11, digest-scheduling 6,
    appointments-outbox 4, máquina +6 Gherkin). Fluxos antigos adaptados ao passo `lembrete`.
- 2026-10-07 — **GATES FINAIS: build ✅ · test ✅ (contracts + schedule-core + api
  vitest/jest + web) · lint ✅ · lint:arch ✅ (97 módulos, 0 violações).**
  Docs etapa 12: `docs/cenarios-do-bot.md` (B5/C1/C2 + D atualizada + F dev:worker) e
  `architecture-overview.md` (3 processos, ADR-009, fluxos). Etapa 10 (web) pulada — já
  existia da Fase 2.
- PENDENTE para o humano: revisão final (task `code-reviewer` — subagent aninhado está
  bloqueado por limite de profundidade neste ambiente) e smoke manual (bot real +
  `dev:worker` + redis). Não commitar sem isso.
