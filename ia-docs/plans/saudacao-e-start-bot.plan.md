# Plano — Saudação `/start` e abertura acolhedora do criar

- Data: 2026-10-11 | Status: concluído ( gates verdes; nada commitado — revisão humana pendente)
- Spec: .ia/specs/agendamento/saudacao-e-start-bot.spec.md | Fase do roadmap: hardening do bot (pós-Fase 9)
- Orquestrador: subagent saudação-e-start | v1 do plano

## 1. Objetivo

Corrigir o bug de produção 2026-10-11 (`/start` sem resposta — caía no LLM como texto) com
roteamento determinístico zero-LLM na borda, e adicionar a frase de abertura acolhedora
("Olá, {nome}! Entendi, vamos registrar esse compromisso 🙂") no turno em que o criar ABRE
por fala. Nada de máquina/régua/portões.

## 2. Análise de profundidade

- **Gateway** (`apps/api/src/modules/bot/bot-gateway.service.ts`): `handleUpdate` (webhook)
  e `bot.on('text')` (polling) mandam TODO `message.text` a `flow.handleText`. `/start` vira
  fala → `offFlowTurn` → classificador → `fora_do_escopo`/`pediuEsclarecimento` ou ruído.
  Os dois modos compartilham o texto de entrada; o roteamento do comando mora num
  reconhecidor puro exportado do próprio gateway (testável, uma fonte para os dois modos).
- **Flow service** (`scheduling-flow.service.ts`): gate de conta repetido por método público
  (`requireConfirmedUser` + catch `ForbiddenException` → `cadastroNecessario`). Abertura do
  criar por fala: `offFlowTurn` casos `criar`/`substituir_atual` → `openFlow` (guiado) ou
  sessão `criar_aberto` + `machine.handleTurn` (atalho). `send()` envia as replies da máquina.
- **Máquina** (`scheduling-flow.machine.ts`): `startReplies` é SÓ usada no `openFlow` do
  service (verificado) — a frase de abertura pode ser anteposta na borda sem tocar a máquina.
- **Mensagens**: `messages.ts` tem `comNome` (decisão 7). Nada de string solta.
- **Testes**: jest = `*.service.spec.ts` (gateway/service com mock plano); vitest = máquina
  pura. Vitest exclui `*.service.spec.ts` — nenhum risco de colisão.

## 3. Decisões

| #   | Decisão                                                                                                               | Alternativa descartada                                    | Por quê                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Reconhecedor de comando exportado `parseBotCommand` (puro, no arquivo do gateway) compartilhado por webhook e polling | `bot.command('start')` do Telegraf só no polling          | Webhook não usa middleware do Telegraf; uma fonte determinística cobre os dois modos e é testável sem mock de Telegraf               |
| D2  | `handleStart(telegramId)` público no flow service (gate + menu, zero LLM, sem tocar sessão)                           | tratar no gateway com acesso direto ao `BotAccessService` | Handler continua fino; gate de conta fica no service como em todo o resto (regra 1 da mãe)                                           |
| D3  | Frase de abertura = **mensagem separada enviada antes** das replies (dois envios)                                     | prefixar a primeira reply da máquina                      | Máquina intocada; eco "Entendi: …" permanece íntegro (C1); ordem garantida pelo `send` sequencial                                    |
| D4  | Frase anteposta na borda (service), não na máquina; cobertos guiado (curto/longo) + atalho                            | mudar `startReplies`/`applyShortcut` na máquina           | "Acabou de abrir naquele turno" é fato da borda (que decide a abertura); máquina é domínio puro e não mudou (testes phase4 intactos) |
| D5  | Needs_review (`fraco`/`suspeito`) NÃO recebe "Olá … vamos registrar"                                                  | frase em todo abrir                                       | Nada foi registrado/aceito ali; o aviso E16 é autocontido — frase acolhedora mentiria ("vamos registrar" o quê?)                     |
| D6  | `/start` não zera nem consulta sessão                                                                                 | reset de estado no /start                                 | Spec A5: resposta pura de borda; fluxo em andamento continua                                                                         |

## 4. Etapas

| #   | Etapa                                                                                                                                                                                          | Worker       | Status | Saída (condição de pronta)                                    | Relatório                                                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------ | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Spec + plano (este arquivo) + `pnpm sync:ia`                                                                                                                                                   | orquestrador | feita  | spec Gherkin curta + plano no formato                         | —                                                                                                                                             |
| 2   | Testes vermelhos: gateway (`/start` roteia p/ `handleStart`, alias ok, texto normal intacto) + service (`handleStart` gate/menu/zero-LLM; frase de abertura guiado/atalho/sem-repetição) — TDD | orquestrador | feita  | testes novos falham pelo motivo certo (método/frase ausentes) | 1º run: `handleStart` inexistente (TS2339) + asserções de frase vermelhas                                                                     |
| 3   | Implementação verde: `parseBotCommand` + roteamento nos 2 modos; `handleStart`; `BOT_MESSAGES.saudacaoStart`/`aberturaCriar`; frase no `openFlow` + abertura do atalho                         | orquestrador | feita  | testes da etapa 2 verdes, máquina intocada                    | jest bot: 78/78; máquina (vitest) sem diff                                                                                                    |
| 4   | Gates raiz: `pnpm build && pnpm test && pnpm lint && pnpm lint:arch`                                                                                                                           | orquestrador | feita  | tudo verde (warnings CRLF pré-existentes ok)                  | build ok; api jest 255/255 + api vitest 165/165 + web 141/141; lint 0 erros (só warnings CRLF/prettier pré-existentes); lint:arch 0 violações |

## 5. Próxima ação

Feature concluída (nada commitado — decisão do humano). Próximo passo humano: revisão do
diff + aprovação de copy (espec A4/B1) e commit convencional sugerido:
`fix(bot): /start com menu zero-LLM na borda + abertura acolhedora ao registrar (saudacao-e-start-bot)`.

## 6. Log

- 2026-10-11 — spec escrita (decisões humanas já aprovadas: menu do /start, frase de
  abertura, sem LLM no comando); plano v1 criado; D1–D6 registradas.
- 2026-10-11 — etapa 2 vermelha confirmada (`handleStart` inexistente); etapa 3 verde com
  D1–D6 como planejado. Ajuste de copy (D2/D3): sem nome, o fallback do `comNome` usa
  `saudacaoStartSemNome`/`aberturaCriarSemNome` (o helper nunca inventa tratamento — sem
  "Oi, você!"). Cobertura da frase B1: abertura guiada (curta e longa B1) + atalho
  utilizável no `offFlowTurn`; needs_review excluído (D5). Gates: build/test/lint/lint:arch
  verdes. `pnpm sync:ia` rodado. Nada commitado.
