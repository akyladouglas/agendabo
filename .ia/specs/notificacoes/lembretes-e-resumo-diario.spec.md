# Spec — Lembretes por compromisso + resumo diário (notificações)

- Domínio: notificacao (com passo de fluxo no bot e workers de disparo) | Data: 2026-10-07 | Status: aprovada
- ADRs relacionados: ADR-002 (UTC + tz por usuário), ADR-004 (LLM interpreta, regras decidem), ADR-008 (LLM classifica intenção; trilho reutilizado para extração), ADR-001 (monolito modular)
- Pedida por: usuário | Fase do roadmap: Fase 3 (itens 1.2 e 2.1 do PROMPT.md)
- Decide o aberto #6 da spec de criar-compromisso (Fase 1): a partir daqui o fluxo **pergunta lembrete**.

## Objetivo / dor do usuário

O usuário marca um compromisso e quer ser **lembrado** dele no Telegram sem pedir: o bot
passa a perguntar, a cada agendamento, o esquema de **lembrete** (1.2), com todos os
cenários do PROMPT.md — 24h antes, 1/2/3 dias antes, contagem 3-2-1, combinação livre
("3 dias antes + 1h antes") e sem lembrete. Além disso, toda manhã ele recebe o **resumo
diário** (2.1) na hora que escolher no seu fuso, com os compromissos do dia e os que têm
lembrete vencendo hoje. O **quando disparar** é 100% determinístico (`computeTriggers`,
já testado em `schedule-core`); o LLM só interpreta a fala do esquema de lembrete.

## Comportamento esperado

### A. Passo de lembrete no fluxo de criar (1.2)

1. **Nova etapa na máquina de estados**: entre as etapas existentes `notas` e
   `confirmacao` entra `lembrete` (`FlowStep` ganha o valor). Ordem final: título → dia →
   hora → fim → conflito → notas → **lembrete** → resumo final → criar. O resumo final
   passa a incluir o esquema de lembrete entendido (ex.: `⏰ lembretes: 3 dias antes · 1h
antes` ou `⏰ sem lembrete`); "alterar" pode voltar só a essa etapa (padrão `rewindStep`).
2. **Pergunta**: após as notas o bot pergunta o esquema, listando os 5 modelos do
   PROMPT.md como atalhos (botões/teclado: `24h antes` · `3 dias antes` · `3-2-1` · `sem
lembrete` · `personalizado`) e aceita **fala natural** por cima ("um dia antes e uma
   hora antes", "3-2-1", "me lembra 2h antes", "sem lembrete", "não").
3. **Interpretação por LLM (só interpreta, ADR-004)**: nova extração
   `extrairLembreteSchema`/tool em `contracts/llm` (sem `.strict()` — gotcha 4): saída
   `{ regras: NotificationRuleInput[], confidence }` com os tipos já existentes
   (`none | before_hours | before_days | countdown_3_2_1`). Pipeline idêntico a
   `ConsultaInterpreterService`: tool calling + `safeParse` + `confidence` + cascata
   haiku→sonnet. **Multi-regra (decisão do humano #1)**: a fala pode produzir N regras
   independentes (combinação livre); `none` só é válido sozinha (regra do zod já existente).
4. **Nunca chute silencioso**: parse falho, `no_tool_use` ou `confidence <
MIN_CONFIDENCE_TO_ACCEPT` → o bot **re-pergunta** o esquema (não grava, não decide por
   ele). Respostas curtas inequívocas ("não", "sem lembrete", "pode deixar sem") são
   resolvidas **deterministicamente** como `none` sem gastar LLM — mesmo critério usado
   para notas na Fase 1.
5. **Confirmação no resumo final**: o que foi entendido aparece no resumo único
   (decisão do humano #2). O usuário confirmar ⇒ essas regras valem; "alterar → lembrete"
   volta à etapa `lembrete`.
6. **Persistência na criação**: no `create` confirmado, o payload final (já validado por
   `appointmentInputSchema`, que aceita `notificationRules`) grava N linhas de
   `NotificationRule` **e** materializa o **Outbox** na mesma transação Prisma: para cada
   trigger de `computeTriggers(startsAt, regras, { now })` (com o horário do gatilho já
   convertido para instante BullMQ pela borda), uma `NotificationOutbox` `pending` + um job
   BullMQ `{ outboxId }` delayado em `NOTIFICATIONS_QUEUE` (`notifications-dispatch`).
   Regra = `schedule-core` decide quando; service materializa; nada de cálculo no handler.

### B. Determinismo e ciclo de vida do gatilho

7. **Gatilho no passado não dispara retroativo**: `computeTriggers` já descarta `firesAt
<= now` sem atrasar os demais. Consequência visível (recomendação desta spec, ver
   `## Aberto` #1): ao **entender** as regras, o bot **avisa** os gatilhos que não vão
   disparar ("esse lembrete de 1 dia antes não vai dar tempo, o compromisso é daqui a
   10min"), mas **cria o compromisso do mesmo jeito** com as regras gravadas. O
   `AppointmentsService.create` (web/API) mantém o comportamento silencioso de descartar
   (a web mostra as regras; sem canal de aviso ali nesta fase).
8. **Dedupe de equivalência**: "24h antes" + contagem 3-2-1 colapsam num único disparo de
   1 dia (comportamento de `computeTriggers`); a spec só consome — o outro `NotificationRule`
   continua gravado como intenção, mas gera zero linhas de outbox para o instante duplicado.
9. **Compromisso editado pela API/web** (edição pelo chat é Fase 4 — fora de escopo):
   `AppointmentsService.update` passa a **invalidar e recriar** o outbox na mesma
   transação quando `startsAt`/`endsAt`/`notificationRules` mudam: linhas `pending` do
   compromisso recebem `status: cancelled`; novas linhas `pending` são criadas de
   `computeTriggers` com os dados novos + jobs novos. Jobs antigos ainda na fila viram
   no-op (regra 12).
10. **Compromisso deletado/cancelado**: `remove` já cascateia o outbox (Prisma
    `onDelete: Cascade`) e jobs pendentes viram no-op pela regra 12. Status futuro
    `cancelled` (quando existir) segue o mesmo caminho de invalidação da regra 9.
11. **`needs_review` nunca dispara** (recomendação desta spec, ver `## Aberto` #4): a
    criação via API já nasce `confirmed`, então na prática a regra é — o **worker revalida
    na hora do disparo**: se o `Appointment` não estiver `confirmed`, marca a linha
    `cancelled` e não envia nada. Assim um compromisso corrigido/abortado na fila de
    revisão (3.3) não vaza lembrete.

### C. Worker de disparo (outbox → Telegram)

12. **Consumidor BullMQ** (`Worker` em `apps/api/src/workers/`, processo próprio —
    gotcha 5: o long-polling do Telegram continua num único processo `dev:bot`; o worker
    **não** roda dentro do processo do bot). Para cada job `{ outboxId }`:
    - carrega a linha do outbox + compromisso + usuário;
    - **idempotência por estado da linha**: só envia se `status === 'pending'` (update
      condicional `pending → sent` via `updateMany`); linha `sent`/`cancelled` ⇒ no-op.
      Worker reiniciado nunca manda o mesmo lembrete duas vezes — a linha do outbox é a
      fonte de verdade, o job só carrega o id (padrão do glossário);
    - **usuário sem `telegramId` ou sem `emailConfirmedAt` ⇒ nunca recebe push**: linha
      vai a `cancelled` (com motivo no log), nada é enviado (invariante do bot);
    - sucesso: `status: sent`, `sentAt = agora`; falha de envio: `attempts + 1` e o job
      volta para retry do BullMQ com backoff exponencial **limitado a 3 tentativas**;
      esgotou ⇒ `status: failed` + `lastError` (não fica em loop, não fica `pending`
      eterno).
13. **Texto do lembrete** (rascunho, confirmação em `## Aberto` #3): PT-BR em
    `modules/bot/messages.ts`, reaproveitando o formato da consulta da Fase 2 — título e
    horário do compromisso **no tz do usuário**, com antecedência descrita em linguagem
    ("daqui a 1 hora", "amanhã", "em 3 dias"). Todo texto de usuário (título/notas) passa
    por `escapeHtml` (gotcha 6).
14. **Atraso do worker** (Redis/API caiu e o instante passou): ao consumir um job cujo
    `firesAt` está no passado há mais de um limiar configurável (default **30min**,
    `ConfigService`), a linha vai a `failed` (`lastError: 'atraso_excedido'`) em vez de
    enviar lembrete obsoleto. Limiar é configuração, não regra de negócio.

### D. Resumo diário (2.1)

15. **Agendador**: um `@nestjs/schedule` cron no processo da **API** roda a cada minuto e
    seleciona usuários com `resumoDiarioHora` igual à hora local atual (no `User.timezone`
    de cada um — tz aplicado na borda com offset de `dates.ts`, ADR-002). O trabalho real é
    enfileirado na fila `notifications-dispatch` como job de digest (um por usuário/dia).
    O cron **não** monta mensagem nem consulta agenda.
16. **Idempotência por usuário/dia**: linha do outbox com `kind: daily_digest` e
    `appointmentId: null` carimbada com o dia civil do usuário (`firesAt` = instante UTC
    do horário local escolhido). Insert único (constraint parcial única em
    `[userId, kind, firesAt]`) — API reiniciada no meio da varredura nunca duplica o
    resumo. O worker trata o digest igual a um lembrete (regras 12: idempotência, gate de
    conta, retry).
17. **Conteúdo da mensagem**: compromissos do **dia civil do usuário** (via
    `appointmentsOnUserDay` de `schedule-core`, somente `confirmed`) no formato da Fase 2:
    `dia da semana + dd/mm — HH:mm–HH:mm — título` (escape HTML — gotcha 6). Quando o dia
    for vazio, mensagem curta "dia livre" (rascunho em `## Aberto` #5).
18. **"Lembrete que vence hoje"**: além dos compromissos do dia, o resumo lista os
    compromissos **de qualquer data futura** cujo primeiro disparo de lembrete cai no dia
    civil de hoje (query no outbox: `pending`, `kind: reminder`, `firesAt` dentro do dia
    civil do usuário). Como a maioria dos lembretes dos compromissos de hoje já dispara
    antes do resumo (07:00), é isso que preenche a cláusula do PROMPT.md — ver
    justificativa e alternativa em `## Aberto` #6.
19. **Parametrização do horário**: `User.resumoDiarioHora` ("HH:mm", default `"07:00"`) já
    existe no schema. **Como o usuário escolhe** (pelo bot? só pela web?) é decisão de
    produto — `## Aberto` #2. Qualquer que seja a resposta, a escrita do campo passa por
    zod na borda (`HH:mm` validado).

### E. Arquitetura (decisão técnica, não de produto)

20. **Onde mora cada regra**:
    - quando-dispara / dedupe / descartar passado / dia civil → `schedule-core`
      (`computeTriggers` e `appointmentsOnUserDay` **já existem e são testados** — a
      feature consome, não reimplementa; qualquer extensão nova dessas funções nasce com
      teste no mesmo commit — regra `schedule-core.md` nº 6);
    - máquina de estados com a nova etapa `lembrete`, montagem das regras, textos →
      service/máquina em `modules/bot` (handler fino);
    - materialização do outbox + jobs, validação do envio, retry → `modules/notifications`
      (service) + `Worker` em `apps/api/src/workers/` (processo próprio — gotcha 5);
    - envio → `shared/telegram` (`TelegramClientService.sendMessage`).
21. **Extensões de schema Prisma (migração na Fase 3)**:
    - `NotificationRule`: nenhum campo novo — `type` + `value` (Int?) já representam
      offset; o **array de regras por compromisso** (N:1 Appointment→Rule) já existe e é o
      que viabiliza combinação livre/3-2-1. A mudança é de **uso** (o fluxo do bot passa a
      preenchê-lo), não de tabela;
    - `NotificationOutbox`: novo enum `NotificationKind { reminder, daily_digest }` com
      campo `kind`; `appointmentId` fica **nullable** (digest não tem compromisso); novo
      status `cancelled` em `NotificationOutboxStatus`; constraint única parcial
      `(userId, kind, firesAt) WHERE appointmentId IS NULL` (idempotência do digest) — exige
      relação direta `NotificationOutbox → User` (`userId`); índice `[status, firesAt]`
      já existe. Migração com `prisma:migrate`.
22. **Contratos (`@agendabo/contracts`)**: `notificationRuleInputSchema` (já existe)
    continua sendo a borda zod das regras persistidas; novo `extrairLembreteSchema` +
    `extrairLembreteTool` em `contracts/llm` (tool escrita à mão, espelhando o zod, sem
    `strict` — gotcha 4; teste de parse com os 4 payloads obrigatórios da regra de
    testing). Enums de outbox/kind exportados de `contracts/entities`.
23. **Testes mínimos desta fase** (além dos já existentes de `computeTriggers`):
    - máquina de estados: fala natural → regras (mock do LLM), "não" → `none` sem LLM,
      confiança baixa → re-pergunta, resumo final mostra as regras, criação grava N
      regras + N' linhas de outbox `pending` (com `now` injetável e gatilho no passado);
    - worker (jest, mocks planos): envia e marca `sent`; linha `sent` de novo ⇒ não reenvia
      (teste de restart); sem `telegramId` confirmado ⇒ `cancelled` sem envio; 3 falhas ⇒
      `failed` + `lastError`; `needs_review` na hora do disparo ⇒ `cancelled`;
    - digest: `now`+tz fixos, dois usuários com fusos/horários diferentes, idempotência de
      `firesAt` igual, dia vazio → "dia livre", inclusão de lembrete de compromisso futuro
      vencendo hoje;
    - update de compromisso: regras/horário mudados ⇒ `pending` antigos `cancelled` + novos
      recriados (e job antigo consumido depois ⇒ no-op).
24. **Documentação no mesmo commit** (regra `documentation.md` nº 8): cenários A1/A5 e uma
    seção nova de lembretes/resumo em `docs/cenarios-do-bot.md`; `architecture-overview`
    ganha o processo worker; se a resposta ao aberto #2/#6 for não-óbvia, registrar ADR.

## Fora de escopo

- **Editar/cancelar compromisso pelo chat** (Fase 4). Enquanto isso, a única edição é pela
  API/web e o que acontece com o outbox está na regra 9 (invalidar + recriar) — lembrete
  de compromisso deletado não chega (cascade + no-op).
- **Mudar o horário do resumo pelo bot** (depende do aberto #2; se aprovado, vira feature
  de bot pequena, mas **não** entra aqui sem resposta).
- Tela de revisão (3.3), calendários web (3.4), qualquer UI web de lembrete (a web só
  continua lendo `notificationRules` na listagem).
- Fuso por compromisso (só `User.timezone`), lembrete recorrente/adiar ("snooze"),
  lembrete após o fim do compromisso, outros canais (email), resumo semanal.
- LLM gerar texto da notificação (textos são templates fixos PT-BR).

## Fronteiras e dados

- **Entidades/contratos tocados**:
  - `User` (leitura: `telegramId`, `emailConfirmedAt`, `timezone`, `resumoDiarioHora`;
    escrita futura só via aberto #2) — imutável nesta spec.
  - `Appointment` — sem campo novo.
  - `NotificationRule` (escrita: N linhas por compromisso criado com lembrete) — sem campo
    novo (regra 21).
  - `NotificationOutbox` (escrita/leitura) — **migração**: `kind`, `userId`,
    `appointmentId` nullable, status `cancelled`, única parcial p/ digest (regra 21).
  - `contracts`: `extrairLembreteSchema`/`Tool` (novo), `notificationRuleInputSchema`
    (consumido), enums de outbox estendidos.
  - `schedule-core`: `computeTriggers`, `appointmentsOnUserDay`, helpers de `dates.ts` —
    consumo, sem nova dependência externa (domínio puro, regra `schedule-core.md`).
- **Fronteiras de módulo**: `modules/bot` → `modules/ai` (extração de lembrete — aresta já
  existe) e `modules/notifications` (materializar outbox — aresta nova, **linha em
  `CROSS_MODULE_EDGES`**); `modules/notifications` → `shared/telegram` (via worker) e
  PrismaService; `apps/api/src/workers/*` é processo próprio (não importa o gateway HTTP
  nem o long-polling — gotcha 5).
- **Configuração nova via `env.validation.ts`/`ConfigService`**: `NOTIFY_MAX_ATTEMPTS`
  (default 3), `NOTIFY_STALE_MINUTES` (default 30). Segredos não tocam aqui.
- **Comandos**: `pnpm --filter @agendabo/api prisma:migrate`, novo script `dev:worker`
  (processo do BullMQ Worker em dev, separado de `dev:api`/`dev:bot`).

## Critérios de aceite (Gherkin)

**Regra 1/5 — passo de lembrete e resumo final**

- Dado um usuário confirmado no fluxo de criar que respondeu as notas
- Quando o bot perguntar o esquema de lembrete e ele aceitar um atalho "3 dias antes"
- Então o resumo final exibe o esquema entendido (`⏰ 3 dias antes`)
- E "alterar → lembrete" volta exatamente para a etapa `lembrete` mantendo o resto do candidato.

**Regra 3 — fala natural combinada (multi-regra)**

- Dado um usuário na etapa `lembrete`
- Quando ele escrever "três dias antes e uma hora antes" e o LLM devolver
  `[{before_days,3},{before_hours,1}]` com confiança acima do limiar
- Então o resumo final exibe os dois gatilhos
- E, após confirmar, são gravadas **2** `NotificationRule` e (com `startsAt` futuro o
  bastante) **2** linhas `NotificationOutbox` `pending` com `firesAt` =
  `startsAt − 3d` e `startsAt − 1h`.

**Regra 3/6 — 3-2-1**

- Dado o mesmo fluxo com a fala "3-2-1"
- Então é gravada **1** regra `countdown_3_2_1` e **3** linhas `pending` em
  `startsAt − 3d/−2d/−1d`, ordenadas.

**Regra 4 — sem lembrete e sem chute**

- Dado um usuário na etapa `lembrete` que responde "não" (ou "sem lembrete")
- Então nenhuma `NotificationRule` além de `none` é gravada e nenhuma linha de outbox existe.
- Dado o LLM devolver confiança abaixo do limiar para "me lembra umas coisinhas antes"
- Então o bot **re-pergunta** o esquema e nada é gravado.

**Regra 7 — gatilho retroativo não dispara**

- Dado um compromisso criado para daqui a 10 minutos com regra "1 dia antes"
- Então o `computeTriggers` da criação retorna zero gatilhos
- E nenhuma linha de outbox é criada
- E (pelo bot) o usuário recebe aviso de que o lembrete não vai disparar, e o compromisso
  é criado normalmente.

**Regra 8 — dedupe de equivalência**

- Dado um compromisso com regras `[before_hours 24, countdown_3_2_1]` e `startsAt` futuro
- Então as linhas de outbox têm `firesAt` distintos: `−3d`, `−2d`, `−1d` (uma única linha
  para o instante que "24h antes" e "1 dia antes" compartilham).

**Regra 9/10 — edição e deleção pela API/web**

- Dado um compromisso com lembretes `pending`
- Quando a web mudar o `startsAt`
- Então todas as linhas `pending` antigas ficam `cancelled`
- E novas linhas `pending` são criadas a partir do `startsAt` novo
- E quando o job antigo (já na fila) for consumido, nada é enviado.
- Dado o compromisso ser deletado pela web
- Então as linhas de outbox somem (cascade) e jobs remanescentes são no-op.

**Regra 11 — needs_review nunca dispara**

- Dado um `NotificationOutbox` `pending` de um compromisso que na hora do disparo está com
  `status: needs_review`
- Quando o worker consumir o job
- Então a linha vira `cancelled` e **nenhuma** mensagem é enviada.

**Regra 12 — worker idempotente e com retry limitado**

- Dado um job `pending` válido de usuário com telegramId confirmado
- Quando o worker processa com sucesso o `sendMessage`
- Então a linha fica `sent` com `sentAt` preenchido.
- Dado o worker reiniciar e o mesmo `outboxId` ser consumido de novo
- Então nada é reenviado (linha já `sent`).
- Dado `sendMessage` falhar 3 vezes
- Então a linha fica `failed` com `lastError` e `attempts = 3`, e o job sai da fila.
- Dado um usuário sem `telegramId` ou sem `emailConfirmedAt` (caso impossível pela borda,
  defesa no worker)
- Então nenhuma mensagem é enviada e a linha vira `cancelled`.

**Regra 14 — atraso excessivo**

- Dado um job consumido com `firesAt` 45 minutos no passado e `NOTIFY_STALE_MINUTES = 30`
- Então a linha fica `failed` (`atraso_excedido`) e nada é enviado.

**Regra 15/16 — resumo diário no fuso do usuário**

- Dado um usuário com `timezone = "America/Sao_Paulo"` e `resumoDiarioHora = "07:00"`
- Quando forem 07:00 de Brasília (≠ 07:00Z)
- Então exatamente **1** linha `NotificationOutbox` `kind: daily_digest` existe para
  aquele usuário/dia, e a mensagem chega pelo Telegram.
- Dado a API reiniciar no meio da varredura e o cron rodar de novo no mesmo minuto
- Então nenhuma segunda linha/segunda mensagem é criada (constraint única + status).

**Regra 17/18 — conteúdo do resumo**

- Dado um usuário com 2 compromissos `confirmed` hoje e 1 amanhã cujo primeiro lembrete
  dispara hoje às 09:00 locais, e nenhum outro pendente
- Quando o resumo das 07:00 for montado
- Então a mensagem lista os 2 de hoje em `dia dd/mm — HH:mm–HH:mm — título` ordenados por
  início (tz local)
- E lista o compromisso de amanhã sob a seção de lembretes que vencem hoje
- E compromissos `needs_review` não aparecem.
- Dado um usuário sem nenhum compromisso hoje e nenhum lembrete vencendo hoje
- Então ele recebe a mensagem curta de "dia livre" (texto final: aberto #5).

**Regra 13/23 — determinismo e papel do LLM (aceite de arquitetura)**

- Dado o diff da fase
- Então nenhum disparo/formatação de horário existe fora de `schedule-core` + borda
  (`pnpm lint:arch` verde; handler e worker sem regra de negócio)
- E o LLM é usado **somente** para extrair as regras de `extrairLembreteSchema`
  (`safeParse`, sem `.strict()`); nenhum texto de notificação é gerado por LLM
- E os testes injetam `now`, mockam `TelegramClientService`/`AnthropicMessagesClient`/BullMQ
  (regra de testing: nunca infra real).

## Decisões (aprovadas pelo usuário em 2026-10-07)

| #   | Decisão                             | Escolhida                                                                                                                  |
| --- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | Gatilho de lembrete já no passado   | **bot avisa** quais lembretes não vão disparar e cria o compromisso mesmo assim; web/API cria calado                       |
| 2   | Escolher/alterar `resumoDiarioHora` | **pela web nesta fase** (campo + zod na API já existem); pelo bot ficaria pra uma fase de conta/config                     |
| 3   | Texto do lembrete                   | aprovado o rascunho `⏰ Lembrete: "X" — qui 08/10 às 14:30 (daqui a 1 hora)` + notas quando existirem; revisão final no PR |
| 4   | `needs_review` dispara lembrete?    | **não** — o worker revalida `confirmed` na hora do disparo; linha vira `cancelled`                                         |
| 5   | Resumo em dia sem nada              | mensagem curta `☀️ Hoje você está livre!` (heartbeat diário)                                                               |
| 6   | "Lembrete que vence hoje" (2.1)     | = lembretes `pending` com `firesAt` **no dia civil de hoje**, de compromissos de qualquer data                             |

> Multi-regra por compromisso (N regras por `Appointment`) e lembrete como passo do fluxo
> de criar foram decididas antes da spec (perguntas de escopo da fase).
