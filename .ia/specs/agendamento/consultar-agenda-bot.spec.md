# Spec — Consulta de agenda sob demanda no bot (2.2)

- Domínio: agendamento (leitura) / bot | Data: 2026-10-06 | Status: aprovada
- ADRs relacionados: ADR-002 (UTC + tz na borda), ADR-003 (LLM interpreta, nunca decide;
  confiança baixa → pergunta), ADR-004 (LLM extrai candidato, regras decidem), ADR-008
  (LLM classifica intenção da conversa, sem barra)
- Pedida por: usuário | Fase do roadmap: Fase 2 (item 2.2 do PROMPT.md)

## Objetivo / dor do usuário

Hoje o usuário só vê a própria agenda abrindo a web. No chat, depois de marcar compromissos,
ele quer saber "o que tenho hoje?", "amanhã?", "o que tenho de 10 a 12?" sem sair do Telegram.
O bot deve entender a pergunta em linguagem natural, consultar o banco e responder a lista —
**somente ler**, sem nunca criar/alterar nada.

## Comportamento esperado

### Acesso e roteamento

1. **Gate de conta (idêntico Fase 1)**: telegramId não cadastrado ou sem email confirmado
   recebe apenas a orientação de cadastro (`BotAccessService.requireConfirmedUser`);
   **nada é consultado** e a tentativa é logada.
2. **Roteamento por intenção**: fora do fluxo de criar, o turno passa pela classificação de
   intenção (ADR-008, `IntentClassifierService`). O bot distingue "consultar agenda" de
   "criar compromisso":
   - pergunta de **consulta** (intenção `consultar` — ver regra 3) → **não abre** a máquina de
     estados de criar; segue o fluxo de consulta;
   - `criar`/`substituir_atual` → fluxo existente (não muda);
   - classificação com parse falho ou `confidence < MIN_CONFIDENCE_TO_ACCEPT` → bot pergunta
     de volta (msg `pediuEsclarecimento`), nunca age no chute.
3. **Nova intenção `consultar` em `classifyIntentSchema`** (decisão técnica, segue ADR-008 —
   a intent é roteador, não fonte de dados). Alternativa de reuso de `fora_do_escopo` é
   pior: consulta é um caminho próprio com resposta própria. **Extensão de enum em
   `contracts/llm/classifyIntent.ts` + tool JSON Schema espelhada** (sem `.strict()`,
   gotcha 4). Se a intent nova exigir decisão de produto (renomear/duplo LLM-call), ver
   `## Aberto` #1.

### Extração do período (LLM interpreta)

4. **Contrato**: reusa `interpretarConsultaSchema` / `interpretarConsultaTool`
   (`contracts/llm/interpretarConsulta.ts`) — saída `listar` com `intervalo { from, to }` +
   `confidence`, ou `fora_do_escopo`. Parse via `safeParse`; `confidence < MIN_CONFIDENCE_TO_ACCEPT`
   ou parse falho ou `no_tool_use` → resultado de falha (padrão idêntico a
   `IntentClassifierService`: tool calling + safeParse + cascata haiku→sonnet, llm.md #4/#7).
   Um serviço `ConsultaInterpreterService` em `modules/ai` segue exatamente esse padrão.
5. **Nada de data chutada** (ADR-003/004 aplicado à leitura): se o LLM não devolveu um
   intervalo confiável, o bot **pergunta qual período** ("Para qual período você quer ver?
   Ex.: hoje, amanhã, semana que vem, dia 10 a 12") — nunca responde com um período suposto.
6. **O que o LLM devolve vs. o que é resolvido deterministicamente**: o prompt injeta a
   **data de hoje no tz do usuário** (bloco volatile, sem cache — llm.md #4). O LLM devolve
   o intervalo como:
   - **datas explícitas** (calendário local do usuário, sem inventar horário): `"10"` →
     `from:"2026-10-10"`, `to:"2026-10-11"`; `"de 10 a 12/10"` → `from:"2026-10-10"`,
     `to:"2026-10-13"` (fim exclusivo); `"do dia X do mês Y de Z"` → intervalo do dia no mês/ano
     ditos. O LLM **ancora ano/mês faltantes** na data de hoje do prompt;
   - **símbolo relativo** (`"hoje"`, `"amanhã"`, `"depois de amanhã"`, `"esta semana"`,
     `"semana que vem"`, `"este mês"`, `"mês que vem"`, `"ano que vem"`, `"fim de semana"`):
     o contrato atual só aceita datas; **extensão mínima** do `interpretarConsultaSchema` com
     campo opcional `simbolo` (enum) mantendo `intervalo` para datas explícitas — ver
     `## Aberto` #2 sobre a forma exata (simbolo vs. deixar o LLM calcular a data).
7. **Resolução determinística do período (regra → `schedule-core`)**: a conversão
   símbolo→intervalo UTC e o clamp de datas explícitas ao dia civil do usuário moram em
   `packages/schedule-core/dates.ts` (funções puras, recebe offset como parâmetro — ADR-002),
   reaproveitando `userDayRange`, `userWeekRange`, `zonedTimeToUtc`, `utcToZonedParts`.
   Novas funções puras necessárias: `userNextWeekRange`, `userMonthRange`, `userNextMonthRange`,
   `userNextYearRange`, `userWeekendRange`, `shiftDayRange(date, offset, +1/+2)` (nomes da
   implementação, cobertas por testes unitários). O serviço do bot **só chama**; nenhuma
   aritmética de calendário no handler.
   - Semana = semana civil começando na segunda 00:00 (mesma base de `userWeekRange`);
   - "semana que vem" = `userWeekRange(now)` deslocada +7 dias;
   - "mês que vem" = [dia 1 00:00 local do próximo mês, dia 1 00:00 local do seguinte);
   - intervalos são sempre **half-open `[start, end)`** no UTC, meia-noite local nas bordas.

### Consulta e resposta

8. **Consulta ao banco**: compromissos do usuário que **tocam** o intervalo
   (`startsAt < end AND endsAt >= start` — intersecção half-open), ordenados por `startsAt`.
   Decisão técnica: `AppointmentsService.list` atual usa `startsAt gte from AND endsAt lte to`
   (contenção, para a web) e **não** serve; a spec pede um método novo
   `AppointmentsService.listOverlapping(userId, from, to, statuses)` na mesma camada (service,
   Prisma), sem tocar no comportamento de `list` da web. `cancelled` nunca aparece.
   `needs_review`: ver `## Aberto` #3.
9. **Resposta (lista)**: formatada **no timezone do usuário** (ADR-002, mesma `tzOffsetMinutes`
   /`Intl` da borda da Fase 1), uma linha por compromisso:
   `dia da semana + dd/mm — HH:mm–HH:mm — título` (título com escape HTML — gotcha 6),
   agrupada por dia quando o período cobre vários dias. Cabeçalho repete o período
   interpretado ("Isto é o que você tem entre 10/10 e 13/10:") para o usuário perceber
   qualquer desentendimento.
10. **Caso vazio**: "Você não tem nada nesse período" — e **só** isso (regra 12).
11. **Muitos resultados**: truncar com "e mais N compromissos — quer ver o resto / um
    período menor?" — limite e texto em `## Aberto` #4.
12. **Não-inventar**: a resposta nunca contém compromisso fora do intervalo consultado nem
    compromissos de outro usuário; o bot nunca "completa" um período não pedido. Query sempre
    filtrada por `userId` autenticado pelo telegramId.

### Interação com o fluxo de criar e abandono

13. **Consulta durante fluxo de criar aberto**: o bot responde à consulta e **retorna ao
    passo atual do fluxo** com a mesma pergunta (estado não é perdido nem reaberto).
    Ver `## Aberto` #5 (alternativa: recusar/perguntar antes).
14. **Abandono da consulta por fala natural** (ADR-008, sem barra): "deixa pra lá", "tanto
    faz", "nada não" durante o pedido de esclarecimento de período encerram a consulta com a
    msg `cancelado` existente; o período é perguntado no máximo 2× por consulta, depois o bot
    encerra educadamente (regra de loop análoga ao limite de tentativas de remarcar da Fase 1).

## Fora de escopo

- **Criar/alterar/cancelar compromisso** — Fase 1 (máquina de estados já entregue).
- **Extração livre para criar** ("marca consulta quinta 14h") — `extrairAgendamento` /
  fila de revisão `needs_review` é Fase 5 (5.0). Aqui o LLM só extrai **período de leitura**.
- **Lembretes, disparos, resumo diário** — Fase 3.
- **Consulta na web** — a web já lista por `GET /appointments` (com `listAppointmentsQuerySchema`).
- **Recomendação de horário livre, "o que devo fazer", resumo inteligente** — nada de LLM
  gerando texto de agenda: a resposta é montada determinística dos dados da consulta.
- Compromissos `cancelled` não são listados em nenhum cenário.

## Fronteiras e dados

- **Contratos (`packages/contracts/src/llm/`)**: `interpretarConsultaSchema`/`Tool` — reusado
  e **estendido** (campo `simbolo` opcional, ver regra 6 e `## Aberto` #2);
  `classifyIntentSchema`/`INTENTS` — adiciona `consultar` (regra 3). Zod na borda, sem
  `.strict()` (gotcha 4), tool JSON Schema escrita à mão espelhando o zod (llm.md #3).
- **Prisma `Appointment`**: leitura de `{ id, title, startsAt, endsAt, status }` filtrada por
  `userId` (+ `status in {confirmed}` — `needs_review` em aberto #3); índice
  `@@index([userId, startsAt])` já cobre a query.
- **Onde mora a regra**:
  - _resolução símbolo→intervalo, aritmética de calendário, meio-aberto_ → `schedule-core/dates.ts`
    (funções puras + testes; invariante do repo: data = schedule-core);
  - _interpetação LLM do período_ → `modules/ai` (novo `ConsultaInterpreterService`, cópia
    do padrão `IntentClassifierService`);
  - _orquestração do turno de consulta (rotear, perguntar, truncar, formatar)_ →
    `modules/bot` (novo `AgendaQueryService` ou ramo em `SchedulingFlowService` — decisão de
    implementação, handler continua fino, default-architecture #4);
  - _listagem por intersecção_ → `AppointmentsService` (regra 8).
- **Estado da consulta** (período perguntado aguardando resposta, contador de tentativas):
  memória por chat com TTL, mesmo trilho de llm.md #5 — nada no banco.
- **Mensagens**: novas strings PT-BR em `modules/bot/messages.ts` (`BOT_MESSAGES`).

## Critérios de aceite (Gherkin)

**Acesso**

- Dado um telegramId sem conta confirmada, quando envia "o que tenho hoje?", então recebe
  apenas `cadastroNecessario` e nenhuma query de compromissos é executada.

**Roteamento**

- Dado um usuário confirmado fora do fluxo, quando envia "o que tenho amanhã?", então o bot
  **não** abre a máquina de estados de criar (nenhuma sessão criada) e responde a agenda.
- Dado um usuário confirmado fora do fluxo, quando envia "quero marcar uma consulta", então
  o fluxo de criar abre normalmente (não-reat: consulta não capturou o turno).

**Extração com falha**

- Dado o interpretador LLM devolve `confidence 0.4` (< limiar), quando o usuário pergunta
  "meus compromissos", então o bot pergunta qual período e **nenhuma** consulta ao banco é
  feita.
- Dado o interpretador devolve tool inválida (safeParse falha) já no modelo de escalada,
  então o bot pergunta qual período.

**Resolução determinística (schedule-core, tz do usuário — America/Sao_Paulo, agora = qua 07/10/2026 08:00 local)**

- Dado "hoje", então o intervalo é `[07/10 00:00, 08/10 00:00)` local (= `[06/10 21:00Z, 07/10 21:00Z)`).
- Dado "amanhã", então `[08/10 00:00, 09/10 00:00)` local.
- Dado "depois de amanhã", então `[09/10 00:00, 10/10 00:00)` local.
- Dado "esta semana", então `[05/10 seg 00:00, 12/10 seg 00:00)` local.
- Dado "semana que vem", então `[12/10, 19/10)` local.
- Dado "este mês", então `[01/10, 01/11)` local; "mês que vem" → `[01/11, 01/12)` local.
- Dado "ano que vem", então `[01/01/2027, 01/01/2028)` local.
- Dado o LLM extrai `from 2026-10-10`/`to 2026-10-13` ("de 10 a 12"), então o intervalo UTC é
  `[10/10 00:00 local, 13/10 00:00 local)` — meia-noite local, nunca 00:00Z.
- Cada um acima é teste unitário puro em `dates.ts` (com offset −180) e teste de integração
  do ramo do bot com interpretador stubado.

**Resposta**

- Dado 2 compromissos `confirmed` no período (um cruzando a meia-noite local que começa no
  período), quando consulta "esta semana", então ambos aparecem (intersecção, não contenção),
  ordenados por início, formatados em dia da semana + dd/mm + HH:mm no tz do usuário.
- Dado um compromisso `cancelled` no período, então ele não aparece.
- Dado zero compromissos no período, então a resposta é a mensagem de vazio e nada mais.
- Dado o LLM extraiu "de 10 a 12" mas o usuário só tem compromissos dia 20, então a resposta
  é "nada nesse período" (nunca listar os do dia 20).

**Muitos resultados**

- Dado N resultados acima do limite (Aberto #4), então o bot lista até o limite e oferece o
  restante/período menor — nunca corta mudo.

**Fluxo de criar aberto** (sujeito a Aberto #5; redigido para a recomendação)

- Dado um usuário no passo "notas" do criar, quando pergunta "o que tenho hoje?", então o bot
  responde a agenda e repete a pergunta de notas, sem perder o que já foi coletado.

**Abandono**

- Dado o bot pediu o período, quando o usuário responde "tanto faz", então a consulta encerra
  com `cancelado` e nenhuma consulta ao banco é feita.
- Dado o período foi perguntado 2× sem sucesso, então o bot encerra a consulta educadamente.

## Decisões (aprovadas pelo usuário em 2026-10-06)

| #   | Decisão                            | Escolhida                                                                                                       |
| --- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | Roteamento da consulta             | **intent nova `consultar`** no `classifyIntentSchema` (1 chamada LLM/turno), enum estendido + tool espelhada    |
| 2   | Contrato do período                | LLM devolve **`simbolo` relativo** (enum) ou datas explícitas; aritmética resolvida em `schedule-core/dates.ts` |
| 3   | `needs_review` na lista            | **mostra com marcador** "⚠️ conferindo"                                                                         |
| 4   | Muitos resultados                  | **truncar em 10** + "e mais N, quer ver o resto / um período menor?"                                            |
| 5   | Consulta com fluxo de criar aberto | **responde a consulta e volta** ao mesmo passo (estado preservado pelo TTL)                                     |
| 6   | "Hoje" inclui o que já passou      | **dia civil inteiro** (mesmo o que já passou)                                                                   |
| 7   | Textos das mensagens               | IA rascunha PT-BR informal; humano revisa no PR (como Fase 1)                                                   |
| 8   | Período muito amplo (>~30 itens)   | **resposta agregada** (contagem no período) + oferta de detalhar por mês                                        |

### Decisões técnicas já tomadas (não precisam do humano)

- Extração segue o padrão `IntentClassifierService`: tool calling + `safeParse` + limiar +
  cascata haiku→sonnet, máx. 1 tentativa extra (llm.md #3/#4/#7).
- Aritmética de calendário 100% `schedule-core/dates.ts`, meio-aberto UTC, tz na borda
  (ADR-002, invariante do repo).
- Nenhuma regra de negócio no handler/gateway (default-architecture #4); estado de conversa
  em memória com TTL (llm.md #5); escape HTML no texto dinâmico (gotcha 6).
- `AppointmentsService.list` da web **não muda**; listagem do bot é método próprio por
  intersecção (regra 8).
