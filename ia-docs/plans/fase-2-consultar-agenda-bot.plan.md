# Plano — Fase 2: consultar agenda sob demanda no bot (2.2)

- Data: 2026-10-06 | Status: implementado (etapas 1–10 concluídas; aguarda revisão humana)
- Spec: `.ia/specs/agendamento/consultar-agenda-bot.spec.md` (aprovada) | Fase do roadmap: 2
- Orquestrador: feature-orchestrator | v1

## 1. Objetivo

O usuário pergunta em linguagem natural sobre a própria agenda — "o que tenho hoje?",
"amanhã?", "de 10 a 12?", "semana que vem?", "mês que vem?" — e o bot responde a lista
de compromissos do período, formatada no timezone do usuário. **Somente leitura**; nunca
cria/altera. A interpretação do "quando" é via LLM (`interpretarConsultaSchema` estendido
com `simbolo`); a aritmética de calendário é 100% `schedule-core/dates.ts`; a listagem é
por **intersecção half-open** no banco.

## 2. Análise de profundidade (o que já existe)

- `packages/contracts/src/llm/interpretarConsulta.ts`: `interpretarConsultaSchema`
  (discriminada `listar`/`fora_do_escopo` com `intervalo` + `confidence`) + tool.
  **Ajuste:** adicionar campo opcional `simbolo` (enum de 10 símbolos relativos) ao
  braço `listar` (feito — commit junto da spec).
- `packages/schedule-core/dates.ts`: `userDayRange`, `userWeekRange`, `userNextWeekRange`
  (nova, a criar), `userMonthRange`, `userNextMonthRange`, `userYearRange`, `shiftDayRange`
  (novas, a criar), `zonedTimeToUtc`, `utcToZonedParts`. Tudo puro.
- `apps/api/modules/ai`: `IntentClassifierService` — **cópia fiel** do que o novo
  `ConsultaInterpreterService` faz (tool calling + `safeParse` + limiar + cascata
  haiku→sonnet + `cache_control`).
- `apps/api/modules/bot`: `SchedulingFlowService.turn()` (hoje roteia `criar`),
  `BotGatewayService`, `BotAccessService.requireConfirmedUser`, `messages.ts`
  (`BOT_MESSAGES`), `tzOffsetMinutes`.
- `apps/api/modules/appointments`: `AppointmentsService.list` (contenção — para a web)
  — **não muda**. Método novo `listOverlapping(userId, from, to, statuses)` (intersecção).
- Prisma `Appointment`: `@@index([userId, startsAt])` já cobre a query.

## 3. Decisões (aprovadas pelo usuário em 2026-10-06)

| #   | Decisão               | Escolhida                                                                               |
| --- | --------------------- | --------------------------------------------------------------------------------------- |
| 1   | Roteamento            | **intent nova `consultar`** em `classifyIntentSchema` (1 chamada/turno)                 |
| 2   | Contrato do período   | LLM devolve `simbolo` (enum) ou `intervalo` (datas explícitas); `schedule-core` resolve |
| 3   | `needs_review`        | **mostra com marcador** "⚠️ conferindo"                                                 |
| 4   | Muitos resultados     | **truncar em 10** + "e mais N, quer ver o resto / um período menor?"                    |
| 5   | Fluxo de criar aberto | **responde a consulta e volta** ao mesmo passo (TTL preserva estado)                    |
| 6   | "Hoje"                | **dia civil inteiro** (mesmo o que já passou)                                           |
| 7   | Textos                | IA rascunha PT-BR; humano revisa no PR                                                  |
| 8   | Período > ~30 itens   | **resposta agregada** (contagem no período) + oferta de detalhar por mês                |

## 4. Etapas

| #   | Etapa                                                                                                                                                                                                                                                                                                                                                                                                   | Worker                              | Status                          | Saída (condição de pronta)                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | `contracts`: `classifyIntentSchema` ganha intent `consultar` (enum + tool espelhada); `interpretarConsultaSchema` — já feito; tipos exportados                                                                                                                                                                                                                                                          | feature-builder                     | **feita (no diff)**             | `pnpm --filter @agendabo/contracts build` ok                                                                             |
| 2   | `schedule-core/dates.ts`: `userNextWeekRange`, `userMonthRange`, `userNextMonthRange`, `userYearRange`, `shiftDayRange` (funções puras, offset como parâmetro) + testes unitários (offset −180, DST, transbordos de mês/ano)                                                                                                                                                                            | feature-builder                     | feita                           | testes verdes em vitest; funções idempotentes                                                                            |
| 3   | `modules/ai`: `ConsultaInterpreterService` — cópia fiel do `IntentClassifierService` mas com `interpretarConsultaTool` e `interpretarConsultaSchema`. Retorna discriminado (`{ ok:true, tipo, simbolo?, intervalo?, confidence }` \| `{ ok:false, reason }`). Prompt PT-BR curto e determinístico. Registra no `AiModule`.                                                                              | feature-builder                     | feita                           | testes com stub `AnthropicMessagesClient` (simbolo claro, intervalo claro, low confidence, parse falho, fora_do_escopo)  |
| 4   | `modules/bot`: `AgendaQueryService` — recebe `{ user, texto, classified, offsetMinutes, now }`, usa `ConsultaInterpreterService` para o período, chama `AppointmentsService.listOverlapping`, **responde** com a lista formatada no tz (dia da semana + dd/mm + HH:mm, agrupada por dia, escape HTML, `needs_review` com marcador, truncamento 10, agregado > 30). Abandono por fala natural (máx. 2×). | feature-builder                     | feita                           | testes com stubs (LLM + prisma): 8 símbolos + 1 intervalo explícito + vazio + muitos + truncamento + agregado + abandono |
| 5   | `AppointmentsService.listOverlapping(userId, from, to, statuses)` — intersecção half-open `startsAt < to && endsAt >= from`, ordenado por `startsAt`. **Não muda** `list`. Teste unitário com prisma stubado (2 casos: contenção ≠ intersecção, meio-aberto).                                                                                                                                           | feature-builder                     | feita                           | teste verde                                                                                                              |
| 6   | Integração no `SchedulingFlowService`/`BotGatewayService`: no turno fora do fluxo, se `intent === 'consultar'` → `AgendaQueryService`; se `criar`/`substituir_atual` → fluxo existente; se dentro de um passo do criar (regra #5) → responde a consulta e volta ao passo.                                                                                                                               | bot-flow-builder                    | feita                           | teste de fluxo (máquina + consulta + retorno ao passo)                                                                   |
| 7   | Textos PT-BR em `messages.ts`: `consultaCabecalho`, `consultaVazia`, `consultaTruncado`, `consultaAgregado`, `consultaPerguntaPeriodo`, `consultaEncerrado`.                                                                                                                                                                                                                                            | bot-flow-builder                    | feita                           | strings centralizadas                                                                                                    |
| 8   | `.dependency-cruiser.cjs`: arestas novas (`modules/bot → appointments` se ainda não existir; `modules/ai` novo serviço não cria aresta).                                                                                                                                                                                                                                                                | feature-builder                     | feita                           | `pnpm lint:arch` verde                                                                                                   |
| 9   | Testes mínimos (testing.md) + smoke manual com bot real.                                                                                                                                                                                                                                                                                                                                                | test-writer                         | feita                           | `pnpm test` verde; 8 símbolos + vazio + truncamento + abandono cobertos                                                  |
| 10  | Gate + review + docs.                                                                                                                                                                                                                                                                                                                                                                                   | code-reviewer / review-orchestrator | pendente (humano roda o review) | build+test+lint+lint:arch verdes; ADRs/plan/spec atualizados                                                             |

Status: pendente | em execução | feita | bloqueada | feita com ressalvas

## 5. Próxima ação

Aguardar **aprovação humana deste plano**. Ao aprovar: etapa 1 (já feita, só validar
build) → 2 (schedule-core) com TDD → 3 (modules/ai) → 5 (AppointmentsService) → 4
(AgendaQueryService) → 6 (integração) → 7 (textos) → 8 (depcruise) → 9 (testes) → 10
(gate).

## 6. Riscos e ressalvas

- **DST**: as funções novas de `dates.ts` precisam cobrir transição de fuso (teste
  com offset −180 e −150; o Brasil saiu do DST em 2019, mas a regra precisa ser
  correta para outros fusos que entram no produto).
- **LLM calcula data errado**: o contrato pede `simbolo` preferencialmente; o prompt
  deve instruir "use símbolo para fala relativa, datas explícitas só para dia/mês/ano
  dito pelo usuário". Se o LLM calcular data "amanhã" errado, o teste de unidade de
  `dates.ts` não cobre (é LLM), mas o Gherkin da spec (regra 12) cobre que a resposta
  NUNCA lista compromisso fora do período pedido.
- **Mensagens longas**: Telegram tem limite de 4096 chars. O truncamento em 10 + o
  agregado > 30 já cuidam; se ainda estourar, o `AgendaQueryService` fatia em
  mensagens (evolução).

## 7. Log

- 2026-10-06 13:00 — spec aprovada (8 decisões). `interpretarConsultaSchema` estendido
  com `simbolo` (done na etapa 1, junto da spec).
- 2026-10-06 13:10 — plano v1 escrito; aguardando aprovação (não implementar antes).
- 2026-10-06 14:30 — humano aprovou ("pode seguir"); feature-orchestrator executou as
  etapas 1–9.
- 2026-10-07 — retomada pós-restart do servidor: o código já estava escrito; orquestrador
  -chefe validou as gates. Correções aplicadas na validação:
  - teste do enum de `classifyIntent` agora espelha `INTENTS` (não lista hardcoded);
  - asserção de texto alinhada à mensagem revisada pelo humano ("compromisso, certo?");
  - `SchedulingFlowService` ganhou `now()` privado (relógio injetável p/ testes —
    padrão testing.md); testes de TTL/UTC congelados em `TODAY_LOCAL=2026-10-06`;
  - lint: 2 erros de unused-vars removidos + `eslint --fix`.
- Gates: `pnpm build` ✅ · `pnpm test` ✅ (97 testes: contracts 6, schedule-core 45,
  api 43, web 3) · `pnpm lint` ✅ · `pnpm lint:arch` ✅.
- Falta: revisão humana (rodar `review-orchestrator` manualmente, como combinado) e
  smoke manual com bot real (roteiro: perguntar "o que tenho hoje/amanhã/semana que
  vem" e conferir a lista e o cabeçalho de período).
