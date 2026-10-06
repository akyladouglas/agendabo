# Plano — Fase 1: criar compromisso pelo bot (1.1 conflito + 1.3 notas)

- Data: 2026-10-06 | Status: implementada (aguardando review humano + smoke manual)
- Spec: `.ia/specs/agendamento/criar-compromisso-bot.spec.md` (aprovada) | Fase do roadmap: 1
- Orquestrador: feature-orchestrator | v2

## 1. Objetivo

Permitir marcar compromisso conversando com o bot no Telegram: coleta guiada do horário,
conflito determinístico que **cita** o compromisso existente (1.1), captura de notas (1.3),
criação `confirmed`/`origin: bot` — tudo **sem comando de barra**, com o LLM classificando a
**intenção** do usuário (ADR-008).

## 2. Análise de profundidade

Existe hoje (Fase 0): `schedule-core.findConflict` + `dates.ts` (testados), `contracts`
(`appointmentInputSchema`, `interpretarConsultaSchema`), `modules/bot` (só `BotAccessService`),
`shared/telegram.TelegramClientService.sendMessage`, `modules/ai` (provider do SDK +
interface `AnthropicMessagesClient`), Prisma com `Appointment`. Não existe: o bootstrap do
Telegraf (long-polling), a máquina de estados, o serviço de criação via bot, a tool de
classificação de intenção e seus prompts. Gate de conflito, tz e outbox já têm dono claro.

## 3. Decisões

| #   | Decisão                                                                                                            | Alternativa descartada                          | Por quê                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- | -------------------------------------------------------------------------- |
| D1  | LLM só classifica **intenção** na Fase 1 (create/cancel/continue/reschedule/replace/out_of_scope)                  | exigir `/cancelar`; ou adiar todo LLM p/ Fase 3 | UX conversacional sem barra; decisão continua determinística (ADR-008/004) |
| D2  | máquina de estados em memória por chat + TTL (30min), em service de `modules/bot`                                  | estado no banco por mensagem                    | regra llm.md nº 5; handler fino                                            |
| D3  | coleta do horário guiada (teclado em passos) + atalho hoje/amanhã                                                  | texto livre do "quando"                         | extração livre é Fase 3; hoje/amanhã é trivial com `dates.ts` (spec #2/#7) |
| D4  | `classifyIntentSchema` novo em `contracts/llm` + tool escrita à mão (sem additionalProperties:false com opcionais) | reusar interpretarConsulta                      | intenção ≠ consulta; contrato enxuto e testável (gotcha 4)                 |
| D5  | confiança baixa na intenção ⇒ **pergunta antes de transição destrutiva**                                           | agir no chute / assumir mais segura             | ADR-008; nunca descartar estado do usuário no chute (spec #8)              |
| D6  | bot roda num processo único via `dev:bot`; `deleteWebhook` no boot                                                 | dois consumidores long-polling                  | gotcha 5 (409 Conflict)                                                    |
| D7  | criação consome `AppointmentsService` (mesmo serviço da web)                                                       | duplicar create no bot                          | uma checagem de conflito/tz (spec arquitetura, D da Fase 0)                |

## 4. Etapas

| #   | Etapa                                                                                                                             | Worker                              | Status              | Saída (condição de pronta)                                                    | Relatório                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `contracts`: `classifyIntentSchema` + tool + tipos                                                                                | feature-builder                     | feita               | `pnpm --filter @agendabo/contracts build` ok                                  | `packages/contracts/src/llm/classifyIntent.ts` (enum 6 intenções, confidence obrigatório, strip) + tool à mão + export no index. Testes de parse adicionados (testing.md nº2): `classifyIntent.spec.ts` (6 testes).                                                                                                                                                                                                                                                                                                                                                                                               |
| 2   | `modules/ai`: serviço `classify-intent` (haiku→sonnet, safeParse, confidence)                                                     | feature-builder                     | feita               | teste com stub `AnthropicMessagesClient` (válido/faltante/extra/baixa)        | `apps/api/src/modules/ai/intent-classifier.service.ts` + spec jest (8 testes: clara/contexto/baixa sem escalar/no_tool_use escala/parse→escala/strip/timeout/falha total). Prompt PT-BR curto com system estável `cache_control`; registrado no `AiModule`. Baixa confiança NÃO escala (vai p/ pergunta).                                                                                                                                                                                                                                                                                                         |
| 3   | `modules/bot`: máquina de estados (`scheduling-flow.service`, memória+TTL) + transições; conflito via `findConflict`; tz na borda | feature-builder                     | feita               | testes de transição (mock relógio + telegram + ai) cobrindo spec 4-13         | `scheduling-flow.machine.ts` (domínio puro, vitest 19 testes: feliz/1.1 cita existente/encostado/remarcar/abortar/limite 3/notas null/0min re-pergunta/cancelar alta+baixa/substituir/hoje-amanhã-depois de amanhã/alterar/TTL) + `scheduling-flow.service.ts` (bordas: Map+TTL via `BOT_SESSION_TTL_MINUTES`, jest 6 testes: gate/fallback/duvida/fluxo completo UTC+origin bot/conflito real via prisma mock/TTL). Conflito 100% `findConflict`; payload validado por `appointmentInputSchema`; criação via `AppointmentsService.create(..., {origin:'bot'})` (assinatura estendida, default `web` preservado). |
| 4   | `modules/bot`: bootstrap Telegraf (long-polling, deleteWebhook, gate `BotAccessService`) + handler fino (texto→fluxo)             | bot-flow-builder                    | feita               | `pnpm --filter @agendabo/api build`; rota de texto roteada por intent         | `bot-gateway.service.ts` (deleteWebhook no boot + `bot.start()` num processo; handlers `text`/`callback_query` finos → SchedulingFlowService; sem token = gateway desliga e API segue). `bot-main.ts` + script `dev:bot` (`nest build && node dist/bot-main.js`). Grafo: aresta `modules/bot → modules/ai` declarada em `CROSS_MODULE_EDGES`; `lint:arch` verde. Boot smoke sem token: processo sobe e loga o desligamento gracioso.                                                                                                                                                                              |
| 5   | textos das mensagens PT-BR (cumprimento, passos, conflito, resumo, notas, confirmação, cadastro, substituir)                      | bot-flow-builder                    | feita com ressalvas | strings centralizadas; usuário revisa no PR                                   | `apps/api/src/modules/bot/messages.ts` (todas as mensagens + `parseYesNo`/`givesUp`/`parseNotesAnswer`/`escapeHtml`). Ressalva: revisão de tom/strings é do humano no PR (decisão de produto #1).                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 6   | testes mínimos (testing.md) + smoke manual com bot real (docker up)                                                               | test-writer                         | feita com ressalvas | `pnpm test` verde; transições da spec cobertas                                | `pnpm test` verde (contracts 6, schedule-core 29, api vitest 25, api jest 14, web 3). Criado `vitest.config.ts` da api (antes os `*.service.spec.ts` do jest quebravam no vitest). **Ressalva: smoke manual com bot real NÃO executado** — `.env` local sem `TELEGRAM_BOT_TOKEN`/`ANTHROPIC_API_KEY`; precisa de token real + conta confirmada (passo a passo na seção 6 do log).                                                                                                                                                                                                                                 |
| 7   | gate + review + docs                                                                                                              | code-reviewer / review-orchestrator | pendente            | build+test+lint+lint:arch verdes; ADR-008 já aceito; gotcha/plano atualizados | Gates da implementação verdes (`build`/`test`/`lint`/`lint:arch`). Gotcha 6 adicionado (escape HTML). Review humano pendente.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Status: pendente | em execução | feita | bloqueada | feita com ressalvas

## 5. Próxima ação

- **Humano**: review do diff + revisão dos textos PT-BR (messages.ts) no PR.
- **Smoke manual (etapa 6)**: preencher `TELEGRAM_BOT_TOKEN` e `ANTHROPIC_API_KEY` no `.env`,
  criar usuário com email confirmado (web/auth), mandar "oi" ao bot e percorrer o fluxo
  (título → Hoje → 14:00 → 1h → notas → confirmar), depois um conflito de propósito.
- Depois: `review-orchestrator` (etapa 7).

## 6. Log

- 2026-10-06 11:40 — spec aprovada (10 decisões + mudança #8 p/ intenção via LLM → ADR-008)
- 2026-10-06 11:45 — plano v1 escrito; aguardando aprovação (não implementar antes)
- 2026-10-06 — plano aprovado; implementação das etapas 1–6 (esta sessão). Notas de execução:
  - Modelo: primário `claude-haiku-4-5-20251001` → escalada `claude-sonnet-5-5` (env + `env.validation.ts`), system prompt com `cache_control`; escalada só em parse/timeout/no_tool_use; baixa confiança vai direto p/ pergunta.
  - `env` novo: `BOT_SESSION_TTL_MINUTES` (default 30) + `.env.example`.
  - Arestas novas no grafo: `modules/bot → modules/ai` (classificador); bot→appointments já coberta pela regra `modules`. `AppointmentsService.create` ganhou `options.origin` (default `web` — comportamento da web inalterado).
  - Fora do fluxo: `criar`/`substituir_atual` abre o fluxo e a fala vira o título (abrir é ação não destrutiva); duvida/parse-falho pergunta; nada roda no chute.
  - "amanhã"/"depois de amanhã"/teclado resolvidos determinísticos via `dates.ts` no tz do usuário; offset medido na borda com `Intl` (schedule-core continua puro/offset-fixo).
  - Bot não-cadastrado: só orientação de cadastro, logado (spec 1). Handler sem Prisma/regra (lint:arch + `bot-handler-thin`).
  - gotcha 6 registrado (escape HTML no texto ecoado do usuário).
  - Portas: build ✅ test ✅ lint ✅ lint:arch ✅. Contagem por suite: contracts +6 (classifyIntent.spec), api vitest 25 (inclui máquina 19), api jest 14 (intent 8 + fluxo 6).
