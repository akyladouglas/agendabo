# ADR-009: Worker BullMQ em processo próprio; outbox como fonte de verdade do disparo

- Data: 2026-10-07 | Status: Aceita
- Contexto: Fase 3 (notificações) | Refs: spec `.ia/specs/notificacoes/lembretes-e-resumo-diario.spec.md`, ADR-001 (monolito modular), ADR-002 (UTC + tz na borda), ADR-004 (LLM interpreta, regras decidem), gotcha 5 (`docs/gotchas.md`)

## Contexto

Lembretes e o resumo diário precisam disparar **mesmo quando a API ou o bot estão
fora do ar** por minutos, sem enviar duas vezes e sem nunca enviar lembrete
obsoleto. O repo já tinha `bullmq`/`@nestjs/bullmq` instalados e o modelo
`NotificationOutbox`, mas nenhum consumidor. As opções discutidas:

1. **Worker dentro do processo do bot** (`dev:bot`) — descartado: o bot é dono do
   único long-polling do token (gotcha 5) e é o processo mais instável do dev; um
   restart do fluxo conversacional pararia os disparos, e misturar responsabilidades
   viola a fronteira de módulos (bot = fluxo, notifications = disparo).
2. **Cron dentro da API consumindo o outbox** (sem BullMQ) — descartado: polling de
   banco no processo HTTP acopla disponibilidade de disparo à API, e reinício no meio
   da varredura exige lock/flag ad-hoc (a constraint única parcial já resolve isso).
3. **Status do envio dentro do payload do job BullMQ** — descartado: restart do
   worker em cima de um job "in-flight" reenviaria; o Postgres é o único lugar com
   idempotência real (outbox pattern já modelado no repo).

## Decisão

- **Processo próprio** `dev:worker` (`apps/api/src/workers/notifications-worker.ts`,
  script `nest build && node dist/workers/notifications-worker.js`): sobe um `Worker`
  BullMQ da fila `notifications-dispatch` apontando para a lógica testável de
  `modules/notifications/dispatch.service.ts` (montada via DI do Nest, mas sem
  `listen()` HTTP e sem o gateway do bot — depcruise proíbe).
- **Outbox é a fonte de verdade**: linha `pending` criada na mesma transação do
  compromisso; o job só carrega `{ outboxId }`; envio condicionado a
  `updateMany(pending→sent)` que afete exatamente 1 linha. Gates na hora do disparo:
  conta confirmada (`telegramId`+`emailConfirmedAt`), compromisso `confirmed`, atraso
  ≤ `NOTIFY_STALE_MINUTES` (30). Retry limitado a `NOTIFY_MAX_ATTEMPTS` (3).
- **Enfileiramento pós-commit e best-effort**: jobs nunca são enfileirados dentro da
  transação Prisma (transação não pode falhar por Redis caído; fila sem job é
  re-cobrável pela linha `pending`).
- **Digest diário**: cron `@nestjs/schedule` **na API** só enfileira (1 varredura por
  minuto, hora local por offset de `dates.ts`); a idempotência por usuário/dia vem da
  constraint única parcial `(userId, kind, firesAt) WHERE appointmentId IS NULL`
  criada no SQL da migração (Prisma `@@unique` não expressa índice parcial).

## Consequências

- Dev passa a ter três processos (`dev:api`, `dev:bot`, `dev:worker`); cada um é
  stateless ou dono de um único recurso — nenhum segundo long-polling é criado.
- Redis caiu ⇒ nada dispara naquele instante, mas nenhuma mensagem se perde ou
  duplica: as linhas ficam `pending` e o atraso além do limiar vira `failed`
  explícito (decisão D7 da spec — lembrete obsoleto piora a confiança).
- O worker compartilha o código de `modules/notifications` com a API (mesmo package,
  mesmo build `dist/`), sem importar o gateway: a fronteira é a interface do serviço.
- Testes: worker sem BullMQ real — a lógica vive em `DispatchService` testado com
  mocks planos (jest), o entrypoint do worker é só ligação.
