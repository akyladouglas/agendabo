# Plano — Fase 9: Observabilidade

- Data: 2026-10-09 | Status: planejado
- Spec: `.ia/specs/observabilidade/observabilidade.spec.md` | Fase do roadmap: 9
- Orquestrador: main session | v1 do plano
- ADRs: **0016** (GlitchTip SaaS / SDK Sentry / PII = só userId) e **0017**
  (tabelas de auditoria + admin/rollout) — já aceitos e commitados (`f1734d2`)

## 1. Objetivo

Entregar as três peças da Fase 9: (A) erros da plataforma ao **GlitchTip SaaS**
via SDK Sentry nos 4 processos (API, worker, bot, web) com scrub de PII
testado; (B) `bot_events` — interações do bot consultáveis por usuário com
rollout por flag; (C) `llm_calls` — tokens/custo por chamada e agregação
admin-only. Zero mudança de comportamento de negócio.

## 2. Análise de profundidade (read-only, feita 2026-10-09)

- **Fronteiras de env**: `apps/api/src/config/env.validation.ts` (zod, `Env`)
  recebe `SENTRY_DSN?`, `SENTRY_TRACES_SAMPLE_RATE`, `SENTRY_ENVIRONMENT`,
  `LLM_PRICE_*`; `.env.example` da raiz ganha as linhas. Na web, env é
  `VITE_SENTRY_DSN` (build-time).
- **Processos (ADR-0009 ⇒ 3 inits backend + 1 web)**: `apps/api/src/main.ts`
  (API), `apps/api/src/workers/notifications-worker.ts` (worker),
  `apps/api/src/bot-main.ts` (bot — sobe o AppModule inteiro, HTTP não escuta),
  `apps/web/src/main.ts` (`bootstrap()`).
- **Ponto único das 5 saídas LLM**: `modules/ai/anthropic-client.provider.ts`
  (`AnthropicClientProvider.create`) — hoje **descarta** `usage` e
  `model` da resposta do SDK (retorna só `content` + `stop_reason`; ver
  `MessagesCreateResult` em `anthropic-messages-client.ts`). O hook de
  `llm_calls` entra AQUI: `usage`/`model` entram no `MessagesCreateResult`
  (opcional) e o provider grava a linha. Ausência de `usage` ⇒ linha com
  tokens null (jamais chute). O `purpose`/`userId` do contexto chegam por um
  contexto de chamada (ver D-P2) — os 5 services de IA não conhecem custo.
- **Bot**: o orquestrador de turno é `modules/bot/scheduling-flow.service.ts`
  (`handleText`/`handleDayPick`/`handleTimePick` → `turn()`; máquina em
  `scheduling-flow.machine.ts`). Os pontos de registro B2 (início de turno,
  intent, decisão de regra, conflito, needs_review, abort) ficam no SERVICE,
  nunca no handler do gateway (invariante AGENTS.md).
- **Admin/rollout**: `users` não tem papel algum. Signup em
  `modules/auth/auth-signup.service.ts` linha 83 (`prisma.user.create` — SEM
  transação hoje). A regra "primeiro usuário = admin" exige `count()` +
  `create()` **dentro de uma `$transaction`** (a de criação já existe em
  parte — confirmar ao codar) + serialização: dois primeiros simultâneos não
  podem criar dois admins (teste de asserting; se necessário, lock via
  `SELECT ... FOR UPDATE` numa sentinela ou constraint parcial única em
  `isAdmin` — decidir na Etapa 1 mantendo teste).
- **Consulta**: `GET /bot-events` e `GET /llm-usage` +
  `PATCH /admin/users/:id/observabilidade` — zod em `contracts/api`, guard
  novo `AdminGuard` (`users.isAdmin`) em `modules/observabilidade`. Não-admin
  autenticado: `/bot-events` 200 só com flag true e só os próprios (userId do
  token, filtro da query ignorado); 403 sem vazar existência.
- **Web**: `main.ts` init condicional a `VITE_SENTRY_DSN`; zero páginas novas.
- **Testes**: domínio/registro com vitest; services Nest com jest
  (`apps/api` roda `vitest run && jest`); rotas com supertest em jest
  (padrão atual do repo — não há pasta test/ e2e).
- **Gaps confirmados**: provider não vê `usage` (ganha); signup sem tx no
  `create` (ganha); sem guard de admin (nasce); `TELEGRAM_SALT`? — o hash de
  telegramId usa HMAC com segredo: **reutilizar `JWT_SECRET` não é limpo**;
  decisão D-P3 abaixo.

## 3. Decisões

| #    | Decisão                                                                                                                                                                                                                                               | Alternativa descartada                           | Por quê                                                                                                                                      |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| D-P1 | Hook de `llm_calls` no `AnthropicClientProvider.create` (único ponto), com `usage`/`model` adicionados ao `MessagesCreateResult`                                                                                                                      | gravar em cada um dos 5 services de IA           | Services não conhecem custo (spec C2); stub testável já existe                                                                               |
| D-P2 | `purpose`/`userId` via **AsyncLocalStorage** (`LlmCallContext`) inicializado nos services de IA/bot; provider lê o contexto                                                                                                                           | assinar `create(params, meta)` em toda call-site | 5 call-sites + LLM do bot; ALS é o padrão Nest p/ contexto por requisição/turno e não vaza para o stub                                       |
| D-P3 | Salt do `telegramIdHash`: env novo `EVENTS_HASH_SECRET` (obrigatório quando houver bot) — **não** reusar `JWT_SECRET`                                                                                                                                 | HMAC com `JWT_SECRET`                            | segredo com um propósito só; vazar o de sessão não deve permitir correlacionar eventos                                                       |
| D-P4 | `beforeSend`/scrub como **função pura compartilhada** (`modules/observabilidade/sentry-scrub.ts`) testada com seed; os 4 processos importam a mesma                                                                                                   | scrub por processo duplicado                     | invariante testada uma vez, vale p/ API/worker/bot/web (web importa via alias ADR-005 ou cópia gerada — decidir na Etapa 3 mantendo o teste) |
| D-P5 | Migration única (`2026xxxx_fase9_observabilidade`): `BotEvent` + `LlmCall` (+ enums) + `users.isAdmin` + `users.observabilidadeEventosAtivo` + índices explícitos `(userId, createdAt)`, `(type, createdAt)`                                          | duas migrations                                  | spec; gotcha 21 (índices de FK declarados)                                                                                                   |
| D-P6 | Gravação de evento/linha **pós-commit, best-effort** (try/catch → Logger, nunca propaga); `llm_calls` grava mesmo em `outcome=error`/timeout                                                                                                          | gravar dentro da tx de negócio                   | ADR-0017; telemetria não derruba turno nem trava tx                                                                                          |
| D-P7 | Primeiro-admin: `count() === 0` + create dentro de `$transaction` + **constraint parcial única** (`CREATE UNIQUE INDEX ... ON users(is_admin) WHERE is_admin`) como trava de corrida                                                                  | lock em sentinela                                | banal de implementar na migration, teste de corrida determinístico, e impede 2 admins até multi-admin existir (ADR novo quando doer)         |
| D-P8 | Custo: `costUsdMicros = round(micros_in*price_in + micros_out*price_out)` com preços env inteiros (`LLM_PRICE_INPUT_USD_PER_MTOK` etc. — parse costuma ser 1/10 do output; valores default nos prices **obrigatórios** no zod p/ não chutarmos custo) | preço hardcoded / float USD                      | ADR-0017 (inteiro micro-USD, estimativa declarada)                                                                                           |
| D-P9 | SDKs: `@sentry/nestjs` (API), `@sentry/node` (worker+bot), `@sentry/vue`+`@sentry/vite-plugin` (web); `tracesSampleRate` do env (default 0); `sendDefaultPii: false`; tag `tags.process`                                                              | OTel puro                                        | ADR-0016                                                                                                                                     |

## 4. Etapas

| #   | Etapa                                                                                                                                                                                                                                                                                                                                                                | Worker                                | Status | Saída (condição de pronta)                                                  | Relatório                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | **Ningum faz nada antes da aprovação humana deste plano** (regra `plans.md` §4)                                                                                                                                                                                                                                                                                      | humano                                | feita  | "aprovado" explícito (2026-10-09: "vamos seguindo para implementação")      | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 1   | **Schema + contracts + env**: migration D-P5 (2 tabelas, enums, colunas em users, constraint D-P7, índices); zod dos `metadata`/inputs/outputs em `contracts`; env vars (`SENTRY_*`, `LLM_PRICE_*` obrigatórios, `EVENTS_HASH_SECRET`) + `.env.example`; `pnpm --filter @agendabo/api prisma:migrate` + generate                                                     | feature-builder                       | feita  | migration aplicada em dev; contracts exportam os schemas; gates verdes      | 14 testes novos em `observability.spec.ts`; dotenv-cli sumiu do bin — prisma via `node .../.pnpm/dotenv-cli@8.0.0/.../cli.js`; 4 arquivos CRLF pré-existentes normalizados com `eslint --fix`                                                                                                                                                                                                                                                                              |
| 2   | **Módulo `observabilidade` — eventos do bot** (TDD): `BotEventsService` (registrar best-effort, hash D-P3, metadata validada por zod ANTES de gravar — recusa campo proibido), chamadas nos pontos B2 do `scheduling-flow.service.ts`; testes: happy, metadata rejeitada sem estourar, falha de gravação não derruba turno, hash determinístico e sem telegramId cru | feature-builder + test-writer         | feita  | jest/vitest do service + fluxo com stub; gates verdes                       | 7 testes do service + 8 do orquestrador + sync contracts; `BotEventOutcome` ganhou `parse_fail`/`low_confidence`; `llm_extraction.metadata.outcome` restringido ao sub-conjunto da extração                                                                                                                                                                                                                                                                                |
| 3   | **`llm_calls`**: `usage`/`model` no `MessagesCreateResult` + hook no provider (D-P1/D-P2 ALS `purpose`/`userId`) + custo D-P8; `LlmUsageService` (preço/consulta/agregação); testes: provider grava linha ok/parse_fail/error, usage ausente ⇒ tokens null, custo inteiro correto, services de IA continuam com stub plano                                           | feature-builder + test-writer         | feita  | testes dos 5 purposes via stub + provider unit; gates verdes                | 7 testes do provider (jest); **D-P8a**: env de preço virou MICRO-USD/Mtok inteiro (`1000000` = $1/Mtok — `z.coerce.number().int()` não aceita fração e $1/Mtok = 1e-6 USD/token); conta exata `tokens×micro/1e6`; uma linha POR TENTATIVA (escalada = 2); `observability?: {userId}` opcional nos 5 services (mocks antigos intocados) + `LlmCallContextService` ALS (`run()` léxico); `AnthropicClientProvider` ganhou Prisma+ctx (ai.module→PrismaModule)                |
| 4   | **Rotas + guard**: `GET /bot-events` (admin tudo / rollout só-próprios com userId do token, 403 sem vazar), `GET /llm-usage` (admin-only), `PATCH /admin/users/:id/observabilidade` (admin-only, zod, só a flag); `AdminGuard`; signup com primeiro-admin (D-P7) + teste de corrida; supertest cobrindo 401/403/200 dos três cenários                                | feature-builder + test-writer         | feita  | testes de rota (todos os casos do Gherkin B5/B6) + gates verdes             | 11 testes do read-service + 3 do primeiro-admin (jest mock plano — repo não tem harness e2e/supertest; tradução 401/403/200 coberta na Etapa 6 smoke); `AdminGuard` (isAdmin lido da fonte, 403 genérico); signup em `$transaction` + retry no P2002 do índice parcial; **desvio**: queries zod `.strict()` (state de form proibido na rota de auditoria → 400 honesto)                                                                                                    |
| 5   | **Tracker (4 processos)**: função de scrub pura + testes de seed (A3/A5: e-mail/telegramId/corpo/headers arrancados, `user.id` presente quando autenticado); init condicional a DSN em `main.ts`/worker/bot/web com `tags.process`; smoke semeado apontando DSN p/ endpoint local mock (4 events) — GlitchTip real só no smoke final                                 | feature-builder + test-writer         | feita  | scrub 6 testes (vitest no schedule-core) + init no-op sem DSN; gates verdes | **micro-decisão D-P9a**: `scrubEvent` mora no `schedule-core` (fonte única dos 4 processos via alias ADR-005 — sem regra duplicada web/server); `error-tracker.ts` shared da API (init c/ `tags.process`); `loadRootEnv()` dev-only p/ worker/bot-main; web: `errorTracker.ts` + `setTrackerUser` no login/logout + `isAdmin` na sessão (contracts `loginResult`/`updateProfileResult`, select do `/me`); `@sentry/vite-plugin` removido (sem upload de sourcemap na fase) |
| 6   | **Gates + smoke**: `pnpm build && pnpm test && pnpm lint && pnpm lint:arch`; smoke real: cadastra 2 users (1º vira admin), flag rollout via PATCH, bot gera eventos, `GET /bot-events` nos dois papéis, `GET /llm-usage` com chamada LLM real, DSN mock recebendo events dos 3 processos; fixtures limpas                                                            | main session                          | feita  | tudo verde + smoke com roteiro executado; relatório ao humano               | **desvios do roteiro**: `GET /llm-usage` validado SEM chamada LLM real (buckets vazios; custo agregado por propósito já coberto por 7 testes unitários da Etapa 3 — evitar custo real de API na fase); o bot real (Telegram) ficou fora do smoke local porque o processo `bot` usa o MESMO init do `worker`, validado com crash semeado + grepe de scrub no envelope (tools/); o primeiro-admin foi forçado via update local no banco (dev já tinha usuário)               |
| 7   | **Review multi-agente** (review-orchestrator no diff da fase) + pacote de correções + `pnpm sync:ia` + docs de fase (spec status, ADR notes se necessário)                                                                                                                                                                                                           | review-orchestrator + feature-builder | feita  | findings P0/P1 fechados; gates verdes                                       | review consolidado: 2 P0 / 7 P1 / 14 P2 — pacote aplicado (ver Log)                                                                                                                                                                                                                                                                                                                                                                                                        |

Status permitidos: `pendente` | `em execução` | `feita` | `bloqueada` | `feita com ressalvas`

## 5. Próxima ação

Fase 9 encerrada — aguardando o deparo humano (regra de fim de fase). Pendencia
aceita de backlog da fase: precificar cache de LLM (emenda ADR-0017, pede decisao
humana com tabela oficial de precos) e UI de auditoria (fora de escopo da spec).

## 6. Log

- 2026-10-09 — plano escrito (v1) após spec aprovada + ADR-0016/0017
  commitados (`f1734d2`). Análise read-only confirmou: provider descarta
  `usage` (ganha hook), signup sem tx (ganha tx+constraint p/ primeiro-admin),
  zero guards de admin hoje, 4 entrypoints para init.
- 2026-10-09 — spec, ADR-0016 e ADR-0017 commitados (`f1734d2`); `sync:ia` não
  rodado (a spec é fonte canônica nova; roda junto com a Etapa 7 ou quando o
  humano mandar).
- 2026-10-09 — **Etapa 1 feita**: plano aprovado pelo humano; migration
  `20261009180000_fase9_observabilidade` aplicada (bot_events + llm_calls +
  isAdmin + observabilidadeEventosAtivo + índice parcial `users_single_admin_unique`
  - 4 índices de query); prisma client gerado; contracts
    `api/observability.ts` (+14 testes TDD-verdes: metadata `.strict` barra
    fala/título disfarçado, rollout só mexe na flag, filtros técnicos); env
    `SENTRY_*`/`EVENTS_HASH_SECRET`/`LLM_PRICE_*` (+`.env.example` e `.env` dev);
    gates verdes (build, test 100% dos suítes, lint 0 problemas, lint:arch ok).
    Nota operacional: `dotenv-cli` não está mais no `.bin` — prisma rodou via
    `node node_modules/.pnpm/dotenv-cli@8.0.0/.../cli.js`. Nota de higiene:
    `appointments.service.ts`, `scheduling-flow.service.ts` + 2 specs estavam
    100% CRLF (poluíam o lint com 2839 warnings); normalizados com
    `eslint --fix` (conteúdo intocado, testes 64/64).
- 2026-10-09 — **Etapa 2 feita**: `modules/observabilidade` (`BotEventsService`:
  HMAC truncado do telegramId, metadata `.strict` dos contracts recusada sem
  estourar, best-effort pós-commit — 7 testes jest) + os 9 pontos B2 ligados no
  orquestrador com helper `evento()` fire-and-forget (flow_started nos dois
  abridores, intent_classified/llm_extraction na classificação off-flow e
  on-flow, extração/lembrete/edição, conflict_dialog/resolved, needs_review,
  cancelled, query_answered com `count?` novo em AgendaQueryResult, TTL→
  flow_aborted{ttl}) — 8 testes do orquestrador + sync-test contracts↔INTENTS.
  Ajuste de vocabulário no caminho: `BotEventOutcome` ganhou `parse_fail`/
  `low_confidence` (migration reescrita + reset do dev, banco vazio). Gates
  verdes: build 0, test 0 (api jest 175/175), lint 0, lint:arch 0.
- 2026-10-09 — **commit `e73c924`** (pushado): pacote das Etapas 1–2.
- 2026-10-09 — **Etapa 3 feita**: `LlmCallContextService` (ALS, `run()` léxico) +
  hook no `AnthropicClientProvider` (`usage`/`model` adiante; linha `llm_calls`
  best-effort por tentativa com custo micro-USD inteiro; sem contexto = userId
  null + warn; erro = outcome error) — 7 testes jest; os 5 services de IA
  ganharam `observability?: {userId}` opcional e `run()` no `client.create`
  (bots passam `user.id`); **D-P8a**: `LLM_PRICE_*` agora é MICRO-USD/Mtok
  inteiro (zod int não aceita fração) — `.env`/`.env.example` atualizados;
  `ai.module` importa `PrismaModule`. Gates: build/test/lint/lint:arch 0.
- 2026-10-09 — **commit `e1933cf`** (pushado): Etapa 3.
- 2026-10-09 — **Etapa 4 feita**: `AdminGuard` (isAdmin da fonte, 403 genérico),
  `ObservabilidadeController` (GET /bot-events, GET /llm-usage admin-only,
  PATCH rollout) + `ObservabilidadeReadService` (admin tudo / rollout só-próprios
  com userId do TOKEN e flag checada na fonte; sem flag 404 sem vazar; llmUsage
  groupBy purpose|user com soma inteira e callsWithoutUsage; rollout .strict)
  — 11 testes; signup D-P7 em `$transaction` + P2002 do índice parcial re-tenta
  como nao-admin — 3 testes (10/10 no spec). Desvio registrado: `botEventsQuery`
  /`llmUsageQuery` .strict (400 honesto — state de form não entra em rota de
  auditoria). Gates: build/test/lint/lint:arch 0.
- 2026-10-09 — **commit `d15e63a`** (pushado): Etapa 4.
- 2026-10-09 — **Etapa 5 feita**: `scrubEvent` como política ÚNICA no
  `schedule-core` (D-P9a; 6 testes vitest — e-mail/telegramId/conversação/
  segredos arrancados, `user.id` único sobrevivente, evento vazio → null) +
  `error-tracker.ts` shared da API (init `@sentry/nestjs` só com DSN,
  `tracesSampleRate` do env, `tags.process`, `beforeSend`=scrub) ligado nos 3
  entrypoints (main/bot-main/worker; `loadRootEnv()` dev-only); web:
  `@sentry/vue` init sem DSN = no-op, `setTrackerUser(uuid)` no login/logout
  via authStore; sessão ganha `isAdmin` (login/refresh/PATCH /me + contracts +
  fixtures de teste). `@sentry/vite-plugin` removido (sem upload de sourcemap
  na fase). `sendDefaultPii` não existe no SDK v11 — ausência = política.
  Gates: build/test/lint/lint:arch 0.
- 2026-10-09 — **Etapa 6 feita**: gates verdes (196 jest + vitest 4/4 pacotes;
  lint 0; lint:arch 147 módulos). Smoke de rotas (tools/smoke-fase9.mjs) com
  API real: 18/18 checks (rollout 404 sem flag / 200 com flag só-próprio sem
  userId na linha / 403 admin-only / 400 em .strict / isAdmin na sessão).
  Smoke do tracker (mock do DSN em tools/): exceção real de rota com e-mail/
  telegramId/senha no corpo → envelope recebido SEM nenhum valor proibido
  (grepe automatizado); crash semeado no worker → envelope com
  `tags.process=worker` e corpo sanitizado. Bug real caçado no caminho:
  `import type` do `BotEventsService` no scheduling-flow quebrava o DI no boot
  (metadata emitida apagada) — trocado por import de valor. Bug 2: segredo em
  texto livre (`senha=hunter3` na message) passava — regex `chave=valor`
  adicionada ao scrub (7º teste). Handlers de exit dos standalone agora fazem
  flush do SDK antes de morrer (worker/bot). Desvio: smoke de custo sem
  chamada LLM real (coberto por 7 testes unitários da Etapa 3).

- 2026-10-09 — **Etapa 7 (review multi-agente) — pacote de correções aplicado**:
  **P0-1a** anexos do envelope contornavam o beforeSend: `hint.attachments`
  zerado dentro do `scrubEvent` + produtores desligados na fonte (web jamais
  registra plugin pinia; defaults do node/nestjs v11 sem extraErrorData/zod-
  attachments — verificado no SDK 11.6) + emenda no ADR-0016. **P0-1b**
  `scrubNode` agora poda casca oca (`{auth:{token:1}}` some inteiro) — 2 testes.
  **P1-4** regex do scrub: uuid canônico case-insensitive + borda de dígitos por
  lookaround (PII colada em vírgula/pipe/tab cai) — 2 testes. **P1-5**
  `registrar()` do provider embrulha o disparo em try/catch (rejeição síncrona
  do Prisma virava unhandled rejection → processo inteiro por um log; gotcha
  #22) — teste. **P1-6** teste de isolamento de bucket na agregação + ordem
  contratada custo-desc (P2-5, dashboard estável). **P1-7** spec B5 corrigida
  para 404 (a implementação sempre esteve certa; o 403 do texto antigo é que
  não batia — DOC-1 do review era falso, conferido no Log da Etapa 4). **P2**:
  `llm_calls` ganha `cache_read/creation_input_tokens` (NULL=honesto; custo
  segue preço cheio — emenda ADR-0017, precificar cache pede decisão humana);
  `/llm-usage` default 90 dias sem `from`; retry P2034 no PATCH rollout;
  LRU(300) no hash do telegramId; `normalizeDepth:3`+`maxValueLength:250` no
  init web; `metadata.conflict_dialog.conflictingIds` é aceito pelo zod mas o
  fluxo só envia `appointmentId` — decisão de produto registrada, sem código;
  AdminGuard ganhou spec próprio (4 testes). Docs: gotcha #22, ADRs 0016/0017
  emendados, spec B5/cenário/D12/C4 atualizados.
- 2026-10-09 — **Etapa 7 FEITA / fase encerrada**: pacote aplicado (Log acima),
  migration `20261009230000_llm_calls_cache_tokens` aplicada em dev, `pnpm
sync:ia` rodado, gates completos verdes pós-correções (build 0; test: contracts
  67 + schedule-core 202 + api vitest 118 + web 99 + jest 204; lint 0; lint:arch
  148 modulos). Commit da etapa = o proximo deste repo.
