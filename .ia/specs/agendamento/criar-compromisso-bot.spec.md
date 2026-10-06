# Spec — Criar compromisso pelo bot (fluxo conversacional, sem comando de barra)

- Domínio: agendamento (com gate de conta e UX do bot) | Data: 2026-10-06 | Status: aprovada
- ADRs relacionados: ADR-002 (datas UTC + tz por usuário), ADR-004 (LLM interpreta, regras decidem), ADR-008 (LLM classifica a intenção da conversa), ADR-001 (monolito modular)
- Pedida por: usuário | Fase do roadmap: Fase 1 (itens 1.1 e 1.3 do PROMPT.md)
- Decisões de produto: seção `## Decisões (aprovadas)` no fim. Extração de data/hora em
  linguagem natural (o "quando" livre) é Fase 3; aqui o LLM só classifica **intenção**.

## Objetivo / dor do usuário

O usuário marca um compromisso conversando com o bot no Telegram e precisa confiar que o
bot não vai criar choques de horário silenciosos: se o horário colide com um
**compromisso** já confirmado, o bot deve dizer **qual** compromisso existe (título +
horário) e dar a escolha de remarcar ou abortar. Antes de criar, o bot captura **notas**
(1.3). A interação é **conversacional, sem comando de barra**: o LLM classifica a
**intenção** do que o usuário diz (criar / cancelar / desistir / remarcar / substituir o
fluxo aberto / continuar) e **pergunta quando não tem certeza**. A coleta do **horário**
ainda é guiada/determinística (a extração "quando" livre é Fase 3), e a decisão de
**conflito é 100% determinística** (ADR-004/ADR-008).

## Comportamento esperado

### Acesso (gate de conta)

1. O bot só atende o fluxo de agendamento para telegramId **cadastrado com email
   confirmado** (`BotAccessService.requireConfirmedUser`). Qualquer outro chat recebe
   apenas a mensagem de orientação de cadastro, o evento é **logado**, e **nada é criado**.
2. Fora do fluxo, o LLM classifica a intenção. `criar` inicia o fluxo de agendamento;
   `fora_do_escopo`/intenção duvidosa (confiança abaixo do limiar) recebe uma resposta
   padrão que **não** cria nem altera nada (e, se duvidosa, o bot pode perguntar o que o
   usuário quis). Nenhum texto de usuário é interpretado como comando de barra.

### Fluxo de criação (coleta do horário guiada; intenção via LLM)

3. O fluxo tem etapas em ordem: (a) título → (b) data/hora de início → (c) duração ou
   horário de fim → (d) **checagem de conflito** → (e) **pergunta por notas** (1.3) →
   (f) **resumo + confirmação final** → (g) criação. A coleta do horário é guiada pelo bot
   (teclado em passos: dia → hora → fim/duração), mas o que o usuário fala em cada passo é
   roteado por **intenção** (ex.: "cancela" a qualquer momento sai do fluxo). Uma única
   confirmação final com resumo, depois das notas.
4. **Sem conflito**: o candidato é comparado com os compromissos `confirmed` futuros do
   usuário via `findConflict` de `@agendabo/schedule-core`. Sem conflito, o bot prossegue
   para a pergunta de notas.
5. **Notas**: o bot pergunta se há informação importante a anotar. Resposta vazia, "não",
   "no" ou equivalente → `notes: null`. Qualquer outro texto → `notes` com o texto (máx.
   2000, `appointmentInputSchema`).
6. **Criação**: após a confirmação do usuário, cria `Appointment` com `status: confirmed`,
   `origin: bot`, `userId` do usuário confirmado, datas em **UTC**. Responde com
   confirmação citando título e horário **formatados no timezone do usuário**
   (`User.timezone`, ADR-002).

### Conflito (1.1)

7. Se `findConflict` retornar conflito (mesma hora, sobreposição parcial, contenção), o
   bot **não cria** e responde citando o **título e o horário de início–fim do
   compromisso existente** que conflita, formatados no timezone do usuário, e pergunta:
   **remarcar** (oferecer outro horário) ou **abortar**.
8. **Encostado não conflita**: candidato com `endsAt` igual ao `startsAt` do existente (ou
   vice-versa) **não** é conflito (intervalo half-open `[startsAt, endsAt)`) — o fluxo
   segue para notas.
9. Compromissos totalmente no passado (`endsAt <= now`) e compromissos `needs_review`
   **não** entram na checagem de conflito (comportamento de `findConflict`: ignora
   passados; a lista enviada ao `findConflict` contém apenas `confirmed` — ver Fronteiras).
10. **Remarcar**: o usuário oferece um novo horário → o bot re-executa a checagem de
    conflito com o novo intervalo (volta à etapa d). Sucesso → segue para notas.
11. **Abortar**: em qualquer ponto do ramo de conflito, "abortar" descarta o candidato e
    **nada é salvo** no banco.

### Validações e cancelamento

12. **Horário inválido**: se o intervalo informado tiver `endsAt <= startsAt` (refine de
    `appointmentInputSchema` / `appointmentIntervalSchema`), o bot **re-pergunta** o
    horário com mensagem de erro; nada é criado nem descartado.
13. **Cancelamento/desistência por fala natural**: em **qualquer etapa**, uma mensagem que
    a classificação interprete como `cancelar`/desistência ("cancela", "deixa pra lá",
    "melhor não", "para") encerra o fluxo, descarta o estado coletado e **nada é salvo**.
    Se a confiança da classificação for baixa, o bot **confirma** ("quero cancelar, certo?")
    antes de descartar — nunca descarta no chute.
14. **Datas**: toda interpretação fala→UTC e exibição UTC→fala acontece **na borda do
    bot**, usando o timezone do usuário (ADR-002). O banco e o `schedule-core` só veem UTC.
    (Formato de entrada na Fase 1 guiada: aberto #2.)

### Arquitetura (decisão técnica, não de produto)

15. O **handler do bot é fino**: extrai a intenção da mensagem e delega ao serviço de
    fluxo (`modules/bot`). A **máquina de estados** do agendamento vive em service do
    módulo `bot`, em memória por chat com TTL (regra `llm.md` nº 5) — nada de estado de
    conversa no banco por mensagem.
16. A **decisão de conflito** é chamada via `findConflict` de `@agendabo/schedule-core`
    (já implementado e testado). Nenhuma lógica de conflito ou de horário fora de
    `schedule-core` (regra `default-architecture.md`, anti-padrões).
17. Na Fase 1 há **uma** categoria de uso de LLM: **classificação de intenção** do turno
    (`classifyIntentSchema` em `contracts/llm`, via tool calling + `safeParse` + `confidence`).
    O LLM **não** extrai data/hora/título (isso é Fase 3). Pipeline ADR-004/ADR-008: a
    intenção dirige **qual transição da máquina de estados** roda, mas nunca fabrica
    candidato nem decide conflito. Como os dados de agenda vêm da coleta guiada e são
    confirmados pelo usuário, o `Appointment` nasce `confirmed` (não `needs_review`).
18. A criação reutiliza a mesma checagem/serviço de aplicação que a web usará
    (zod `appointmentInputSchema` na borda; `schedule-core` na regra). Estado de conversa
    não substitui validação: o payload final é validado por zod antes do `prisma.create`.

## Fora de escopo

- **Extração em linguagem natural do candidato** (data/hora/título livres) pelo LLM
  (Fase 3) e fila de revisão `needs_review` (3.3). _Classificação de intenção via LLM está
  NA Fase 1 (ADR-008); extrair o "quando" livre não está._
- Pergunta/configuração de **lembretes** por compromisso (1.2) — a Fase 1 cria o
  compromisso **sem** `NotificationRule` (sem lembrete); ver aberto #6.
- Workers BullMQ, outbox, disparos de lembrete e resumo diário (Fase 4).
- Edição/exclusão de compromisso pelo bot, e qualquer tela web.
- Anexos de texto de qualquer tipo além de `notes` (string simples).
- Múltiplos candidatos na mesma mensagem ("marca X e Y").

## Fronteiras e dados

- **Entidades/contratos tocados**:
  - `User` (leitura: `id`, `telegramId`, `timezone`, `emailConfirmedAt`) via
    `BotAccessService` — imutável.
  - `Appointment` (escrita): criação com `title`, `startsAt`, `endsAt` (UTC), `notes?`,
    `status: confirmed`, `origin: bot`, `userId`. Nenhum campo novo de schema previsto.
  - `@agendabo/contracts`: `appointmentInputSchema` valida o payload final antes do
    `create`. (Se a coleta guiada precisar de DTOs próprios de passo-de-fluxo, vivem em
    `contracts/bot` — técnica.)
  - `@agendabo/schedule-core`: `findConflict` (conflito) e helpers de `dates.ts`
    (conversão/exibição com offset injetável). A lista `existing` passada a
    `findConflict` = compromissos do usuário com `status = confirmed` e `endsAt` dentro de
    uma janela futura razoável (técnica; `now` injetável em testes).
- **Onde mora a regra**:
  - Conflito / intervalo half-open / ignorar passado → `schedule-core` (já mora lá).
  - Máquina de estados, montagem do candidato, re-perguntas, formatação de mensagens →
    service em `modules/bot` (application), com handler fino.
  - Conversão tz↔UTC → borda do bot (`modules/bot` usando `schedule-core/dates`).
- **Fronteiras de módulo**: `modules/bot` → `shared/telegram` (envio de mensagem) e
  PrismaService; `modules/bot` consome `schedule-core`/`contracts` (pacotes). Compatível
  com `CROSS_MODULE_EDGES`; aresta nova → linha no grafo.

## Critérios de aceite (Gherkin)

**Regra 1 — gate de acesso**

- Dado um telegramId sem cadastro (ou sem `emailConfirmedAt`)
- Quando ele envia qualquer mensagem ao bot
- Então o bot responde apenas com a orientação de cadastro
- E nada é escrito em `appointments`
- E a tentativa é logada (sem criar conta nem compromisso).

**Regra 4+6 — fluxo feliz**

- Dado um usuário com email confirmado, sem compromissos futuros
- Quando ele conclui o fluxo guiado (título, horário, sem conflito), responde "não" às
  notas e confirma
- Então um `Appointment` é criado com `status: confirmed`, `origin: bot`, `notes: null`,
  `startsAt`/`endsAt` iguais aos UTC correspondentes ao que foi informado no tz do usuário
- E o bot responde com a confirmação citando título e horário no tz do usuário.

**Regra 5 — notas**

- Dado um candidato sem conflito na etapa de notas
- Quando o usuário responde "anotar: levar o orçamento"
- Então o `Appointment` criado tem `notes = "levar o orçamento"`
- E quando outro usuário responde "não" (ou mensagem vazia), o `Appointment` criado tem
  `notes = null`.

**Regra 7 — conflito cita o existente (1.1)**

- Dado um `Appointment` `confirmed` futuro "Consulta dentista" 14:00–15:00 (tz do usuário)
- Quando o usuário propõe "Reunião" 14:30–15:30
- Então **nenhum** `Appointment` é criado
- E o bot responde citando o título "Consulta dentista" e o horário 14:00–15:00 formatado
  no tz do usuário
- E pergunta se o usuário quer remarcar ou abortar.

**Regra 8 — encostado não conflita**

- Dado o mesmo "Consulta dentista" 14:00–15:00
- Quando o usuário propõe "Almoço" 15:00–16:00
- Então `findConflict` retorna `conflict: false` e o bot segue para a etapa de notas.

**Regra 9 — passado e needs_review ignorados**

- Dado um compromisso `confirmed` 100% no passado e um `needs_review` que sobreporia o
  candidato
- Quando a checagem de conflito roda
- Então nenhum deles é retornado como conflito (fonte da lista: só `confirmed` com
  `endsAt > now`).

**Regra 10 — remarcar**

- Dado o conflito "Reunião" × "Consulta dentista"
- Quando o usuário escolhe remarcar para 16:00–17:00 (livre)
- Então a checagem roda de novo sobre o novo intervalo, não há conflito, e o fluxo segue
  para notas.

**Regra 11 — abortar**

- Dado o conflito acima
- Quando o usuário escolhe abortar
- Então nenhum `Appointment` é criado e o fluxo termina.

**Regra 12 — horário inválido**

- Dado um usuário na etapa de horário
- Quando ele informa um fim igual ou anterior ao início
- Então o bot re-pergunta o horário com mensagem de erro
- E nada é criado nem o fluxo é abortado.

**Regra 13 — cancelamento**

- Dado um usuário em qualquer etapa do fluxo (título, horário, conflito ou notas)
- Quando ele envia o cancelamento
- Então o fluxo termina, o estado em memória daquele chat é descartado, e nada é salvo.

**Regra 14 — UTC no banco, tz na borda**

- Dado um usuário com `timezone = "America/Sao_Paulo"` que informa 14:00 no fluxo guiado
- Então o `Appointment` é gravado com `startsAt = 17:00Z` (mesmo instante)
- E as mensagens do bot exibem 14:00 (hora local do usuário).

**Regra 13 — desistência por fala natural**

- Dado um usuário na etapa de notas com um candidato em memória
- Quando ele escreve "deixa pra lá"
- E a classificação retorna `cancelar` com confiança acima do limiar
- Então o fluxo termina, o estado do chat é descartado e nada é salvo
- Mas dado confiança **baixa** na classificação, o bot pergunta antes de descartar.

**Regra 15/17 — pureza e papel do LLM (aceite de arquitetura)**

- Dado o diff da feature
- Então o handler do bot não contém Prisma nem regra de negócio (verificável por
  `pnpm lint:arch` + review)
- E o LLM (`modules/ai`) é usado **somente** para classificar intenção; nenhuma chamada
  extrai data/hora/título nem decide conflito
- E a resposta do LLM passa por `safeParse` de `classifyIntentSchema`; parse falho/confiança
  baixa faz o bot perguntar, nunca executar transição destrutiva no chute
- E os testes de fluxo mockam relógio (`now` injetável), `TelegramClientService` e
  `AnthropicMessagesClient`.

## Decisões (aprovadas pelo usuário em 2026-10-06)

| #   | Decisão                           | Escolhida                                                                                                                                                                                                    |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Textos das mensagens              | IA rascunha todas em PT-BR informal (tom do PROMPT.md); usuário revisa no PR                                                                                                                                 |
| 2   | Coleta do horário                 | guiada por teclado do Telegram em passos (dia → hora → fim/duração), mas o que o usuário **fala** é roteado por intenção (sem comando de barra). "Hoje/amanhã" aceitos como atalho determinístico (com o #7) |
| 3   | Confirmação                       | **resumo único** final com "confirmar / alterar", depois das notas                                                                                                                                           |
| 4   | Tentativas de remarcar            | máximo **3**, depois o bot sugere abortar (usuário ainda pode insistir)                                                                                                                                      |
| 5   | 2º conflito seguido               | mesmo tratamento do 1º (dentro do limite do #4)                                                                                                                                                              |
| 6   | Lembrete na Fase 1                | **sem** `NotificationRule` (lembretes 1.2 = Fase 4)                                                                                                                                                          |
| 7   | "hoje/amanhã"                     | aceita, resolvido no timezone do usuário (determinístico, `dates.ts`)                                                                                                                                        |
| 8   | Cancelamento/desistência          | **por fala natural via LLM** (classificação de intenção), sem comando de barra; confiança baixa ⇒ bot confirma antes de descartar (ADR-008)                                                                  |
| 9   | Novo agendamento com fluxo aberto | intenção `substituir_atual` ⇒ bot pergunta "descartar o atual e começar de novo?"                                                                                                                            |
| 10  | Duração                           | pergunta fim/duração explicitamente (sem inventar 1h)                                                                                                                                                        |

> ADR-008 autoriza o LLM **só para classificação de intenção** na Fase 1. Trocar #8 de
> "palavra-chave determinística" para "intenção via LLM" foi decisão de produto do usuário.

## Notas técnicas (decididas, sem pergunta)

- **Máquina de estados em memória por chat com TTL** (ex.: 30 min de inatividade
  expira e descarta): segue regra `llm.md` nº 5 ("nada de estado de conversa no banco
  por mensagem"). Valor do TTL é configuração via `ConfigService`.
- **Conflito 100% `schedule-core`**: `findConflict(candidate, confirmedFuturos, { now })`,
  sem LLM na Fase 1 (ADR-004). A regra já existe e é testada — a feature só a consome.
- **Consulta dos existentes**: `prisma.appointment.findMany({ where: { userId, status:
'confirmed', endsAt: { gt: now } } })` com janela futura limitada (ex.: 90 dias) para
  manter barato; índices existentes (`[userId, startsAt]`, `[status]`) cobrem.
- **Borda zod**: o payload montado no fim do fluxo passa por `appointmentInputSchema`
  antes do `create` (falha de zod em produção aqui = bug de máquina de estados, logado).
- **`needs_review` não bloqueia**: como na Fase 1 não há LLM, o status criado é sempre
  `confirmed`; `rawText`/`reviewReason` ficam null.
