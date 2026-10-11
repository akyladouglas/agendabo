# Spec — Fluxo de criação robusto: intervalo completo, título curto, reaproveitamento incremental, lembrete sem loop

- Domínio: agendamento (com consumo de bot/llm) | Data: 2026-10-10 | Status: implementada (working tree 2026-10-10)
- Spec mãe (não reescrita aqui): **`.ia/specs/agendamento/criar-compromisso-bot.spec.md`** (fluxo base,
  conflito, notas, confirmação) e **`.ia/specs/agendamento/llm-avancado-extracao-edicao-revisao.spec.md`**
  (atalho da extração livre + régua da regra 6). Esta spec **refina** o atalho da extração e o passo de
  lembrete da spec de notificações (`.ia/specs/notificacoes/lembretes-e-resumo-diario.spec.md`), não os
  contradiz. **Exceção explícita**: a decisão 5 (perguntar `fim` quando o atalho não extraiu fim)
  **substitui** a decisão #4 da spec avançada (que pulava `fim` com default 60 min).
- ADRs relacionados: **ADR-002** (UTC no banco, tz na borda), **ADR-004/003** (LLM interpreta, regras
  decidem; confiança baixa → needs_review), **ADR-008** (intenção roteadora), **ADR-010** (régua
  needs_review vs. re-pergunta), **ADR-015** (sobreposição é invariante — `findConflict` consome
  intervalo puro). **ADR registrado**: **ADR-0018** (`ia-docs/decisions/pt-br/0018-extracao-fim-explícito-dia-semana-titulo-ecoado.md`)
  — `endsAt` explícito no contrato do extrator + regra de dia-da-semana ("segunda" = próxima
  ocorrência ≥ hoje) e título extraído como sugestão ecoada: três faces da decisão "aproveitar o
  que o usuário disse sem chute silencioso".
- Pedida por: usuário (bug real degradado em produção em 2026-10-10) | Fase do roadmap: hardening do
  fluxo do bot (pós-Fase 8)

## Objetivo / dor do usuário

O usuário testou o bot em produção com a fala real _"Tenho um novo compromisso, uma viagem para lucena
de 19h hoje e vai até 17h na segunda"_ e o fluxo degradou em três frentes: (1) a **frase inteira virou
o título** sem pergunta nem confirmação; (2) o **intervalo multi-dia foi ignorado** — o bot pediu dia e
hora de novo e criou 10/10 19:00–20:00 (1h chute), perdendo o fim "17h na segunda"; (3) no passo do
**lembrete**, o clique no botão "personalizado" entrou como texto no interpretador, gerou "não tenho
certeza se entendi" e **re-pergunta em loop**. O usuário precisa confiar que o bot **aproveita o que ele
já disse** e pergunta **só o que falta**, sem chutar título, sem perder fim de intervalo e sem loop.

## Diagnóstico técnico (estado atual verificado por inspeção 2026-10-10)

Nomes de código citados ao longo da spec referem-se a:

- **Título-fala**: quando a extração falha, a borda produz `titleHint = texto.slice(0, 200)`
  (`scheduling-flow.service.ts:523-525`) e a máquina o aceita cegamente (`scheduling-flow.machine.ts`
  caso `falhou` de `applyShortcut`, :641-656) — a fala inteira vira título e a data da fala se perde. O
  mesmo risco existe no `quando_parcial` quando o modelo preenche `title` com a frase toda.
- **Sem fim no contrato**: `extrairAgendamentoSchema` (`packages/contracts/src/llm/extrairAgendamento.ts`)
  só tem `startsAt` + `durationMinutes?` (máx. 1440) + `confidence` + `dateEvidence?`; **nenhum** schema
  de criação tem `endsAt`; o prompt do extrator (`modules/ai/scheduling-interpreter.service.ts:31-45`)
  não menciona intervalos "de X até Y". Fim ausente ⇒ default **60 min** na régua
  (`extraction-ruler.ts:78`) — o "chute de 1h" do incidente.
- **Callback vira fala**: `handleCallback` (`scheduling-flow.service.ts:1338-1358`) decodifica dia/hora
  ("10/10", "19:00", "hoje") mas todo o resto cai em `handleText(telegramId, label)` (:1357). O botão
  **"personalizado"** do teclado de lembrete (`messages.ts:249`) **não é atalho** em
  `resolveReminderShortcut` (`modules/ai/reminder-interpreter.service.ts:184-208`) ⇒ a palavra solta vai
  ao LLM, falha, e a máquina re-pergunta **sem contador** (`machine.ts:1385-1396`) — loop até desistência.
- **Multi-dia no conflito**: já OK — `findConflict` opera em `[startsAt, endsAt)` puro, sem noção de dia
  (`schedule-core/conflicts.ts`); um bloco único sáb 19h → seg 17h conflita naturalmente. Nada muda aqui.

## Comportamento esperado

Regras numeradas; `SC` = `schedule-core`. Toda fala exibida mora em `messages.ts` (PT-BR informal).

### A. Extração de intervalo completo (início **e** fim)

A1. **Contrato novo**: `extrairAgendamentoSchema` ganha `endsAt` **opcional** (ISO-8601 com offset,
mesma validação de formato de `startsAt`). Tool JSON espelhada (sem `.strict()` — gotcha 4). O
prompt passa a instruir: quando o usuário der **início e fim** ("de 19h hoje até 17h na segunda",
"das 8h às 17h do dia 12"), devolver os dois instantes; **nunca** calcular duração — o modelo copia
os instantes que o usuário disse, a borda faz aritmética (ADR-004).
A2. **Regra de validação da borda/régua** (`extraction-ruler`): com `endsAt` presente, a régua exige
`endsAt > startsAt` (mesmo instante/inválido ⇒ tratado como extração inválida do "quando" ⇒
re-pergunta o fim no ponto faltante, nunca needs_review por isso). `endsAt` com offset ≠ tz da conta
⇒ veredito `fraco` (mesma regra do `startsAt`, `parse_falho`). Multi-dia é natural: nenhum limite de
duração para `endsAt` explícito (o cap de 1440 do `durationMinutes` **não** se aplica a intervalo
extraído — "viagem de sábado 19h a segunda 17h" dura 1320 min e é lícito).
A3. **Precedência**: `endsAt` presente ⇒ fim explícito manda; `durationMinutes` presente junto e
**inconsistente** com `endsAt` ⇒ a régua ignora a duração e usa `endsAt` (o fim dito pelo usuário é
a verdade). `endsAt` ausente ⇒ comportamento de hoje (`durationMinutes` ou default 60 **somente no
atalho aceito**; o passo `fim` do guiado continua perguntando, sem inventar 1h — decisão #10 da mãe).
A4. **Dia da semana** ("segunda", "sexta"): regra determinística de produto, decidida pelo humano em
2026-10-10 — **`<dia-da-semana>` = próxima ocorrência do dia com data ≥ hoje** (hoje no tz do
usuário; se hoje for segunda, "segunda" **é hoje**; dita num sábado, "segunda" = amanhã/2 dias, e
"próxima segunda"/"segunda que vem" continua sendo a de +7 dias via prompt). A resolução do
dia-da-semana é ancorada no "hoje" injetado no prompt (padrão da Fase 2) e **a régua ADR-010
protege o chute**: confiança baixa com candidato plausível ⇒ needs_review, nunca `confirmed` no
chute. O bot **sempre ecoa a data resolvida** ("sáb 10/10 19:00 → seg 12/10 17:00") no resumo/pergunta
seguinte — interpretar ≠ assumir em silêncio.
A5. **Conflito com multi-dia**: nenhum código novo — `findConflict` recebe `[startsAt, endsAt)` e já
trata sobreposição/contenção de bloco multi-dia (confirmado por inspeção). Critério de aceite só
grava isso com teste.

### B. Título curto — nunca a frase inteira

B1. **Proibido usar a fala inteira como título**: o `titleHint = texto.slice(0, 200)` do veredito
`falhou` **deixa de existir** como título. Com parse/timeout do extrator, a máquina **volta ao
fluxo guiado no ponto faltante e PERGUNTA o título** (passo `titulo`), exatamente como a regra 5 da
spec mãe prevê para "fala sem quando". (Coerência com ADR-010: parse falho na criação é re-pergunta,
nunca hipótese persistida — hoje persiste hipótese de título às escondidas.)
B2. **Título do modelo deve ser curto**: prompt instrui o modelo a devolver **só o nome do compromisso**
("viagem para Lucena", não a frase). Refine de validação na borda: `title` que contenha o texto da
fala quase integralmente (heurística determinística: `title.length ≥ 0.8 × fala.length` após
normalização) ou que comece com verbo de intenção ("tenho um novo compromisso…", "quero marcar…" —
lista em `messages.ts`/config) ⇒ tratado como **título ausente** (pergunta B3), nunca usado.
B3. **Sem título claro ⇒ perguntar**: extração sem título utilizável ⇒ o candidato segue **sem** título
e a máquina pergunta o título (passo `titulo`) quando chegar a hora — reaproveitando o resto.
B4. **Sugestão ecoada, nunca silenciosa** (decisão do humano 2026-10-10): título curto extraído preenche
o candidato **sem turno extra de pergunta**, mas é **sempre ecoado** — na fala que pula passos
("Entendi: **Viagem para Lucena**, sáb 10/10 19:00 → seg 12/10 17:00 — posso anotar algo?") e no
resumo final — com `alterar título` disponível (mecânica `rewindTo` vigente). Se a **régua** cair em
needs_review, o título é hipótese como qualquer campo (vai em `rawText`/revisão, ADR-003/010).

### C. Reaproveitamento incremental (perguntar só o que falta)

C1. **Eco + lacuna**: qualquer veredito parcial da régua (`quando_parcial`, título-sugestão válido sem
hora, dia sem hora, início sem fim) produz uma única fala que **ecoa o que entendeu** e pergunta
**só o que falta**, no próximo passo da máquina: `Entendi: "Viagem para Lucena" hoje — a que horas
    começa?`. Proibido (a) recomeçar o fluxo do zero, (b) re-perguntar dado já preenchido com
confiança, (c) descartar campo extraído porque outro falta (já decidido na spec avançada, regra 5).
Limite honesto do incremental: com `startsAt` aceito e **nenhum** fim no payload, a régua é cega à
fala — vale o default 60 do atalho aceito (decisão #4 da spec avançada mantida; ver **Aberto** #1);
o eco B4 e o prompt A1 mitigam.
C2. **Incremental nunca engole erro de tz**: eco de datas sempre no tz do usuário (ADR-002), formato
`ddd DD/MM HH:mm`.
C3. **Máquina continua única**: nada de fluxo paralelo — os vereditos entram pelo mesmo
`applyShortcut`/portão, apenas com as transições corrigidas de B/C.

### D. Lembrete: clique ≠ fala; sem loop

D1. **Callback próprio por atalho**: os botões do teclado de lembrete (`lembreteAtalhos` em
`messages.ts`: `24h antes`, `3 dias antes`, `3-2-1`, `sem lembrete`, `personalizado`) passam a
carregar `callback_data` **estruturado** (ex.: `flow:lembrete:24h`, `flow:lembrete:none`,
`flow:lembrete:countdown`, `flow:lembrete:custom`) decodificado **no `handleCallback`** (ou roteador
dedicado do passo) direto para a transição determinística da máquina — **sem** materializar texto e
**sem** gastar LLM. Clique em atalho conhecido ⇒ `reminderRules` resolvidas na hora (as mesmas
saídas de `resolveReminderShortcut` hoje para esses labels).
D2. **"Personalizado" abre texto livre**: o clique em `personalizado` **não** vai ao interpretador com a
palavra solta; responde o convite (`messages.ts` novo, ex.: "Me diz como você quer ser avisado —
ex.: '3 dias antes e 1h antes', ou 'hoje às 18h'") e mantém o passo `lembrete` aguardando **texto
livre do usuário** (que segue D3). Nenhum texto é enviado ao LLM por causa do clique.
D3. **Texto livre do lembrete**: fluxo de hoje (atalho determinístico primeiro, LLM depois), mas com
**contador por sessão de turno**: 1ª falha (parse/`low_confidence`) ⇒ re-pergunta com exemplo
concreto; **2ª falha consecutiva** ⇒ o bot para de gastar LLM nesse passo e mostra o **teclado de
atalhos fixo** junto do convite ("prefere escolher? ou me escreve no estilo 'X antes'"). Texto
livre continua aceito depois (o contador zera a cada sucesso; é anti-loop, não porta de saída).
Decisão do humano 2026-10-10: **2 tentativas**.
D4. **Regra geral callback ≠ fala**: o fallback genérico de `handleCallback` (reaproveitar `handleText`
com o label) fica restrito a labels **já hoje roteáveis por fala e de custo zero** (sim/não,
remarcar/abortar, confirmar/alterar) — qualquer label de teclado com significado estruturado
(lembrete, dia, hora) tem handler próprio; um clique **nunca** re-dispara o portão da extração livre
(o `openCreate` do portão só aceita fala real, não resultado de callback — o portão vê flag
`deterministic`/origem do evento). Botões dos demais passos podem migrar para `callback_data`
estruturado na mesma PR se trivial, mas só o lembrete é obrigatório aqui.
D5. **Invariantes do lembrete intactas** (spec de notificações): zod na saída do interpretador, confiança
baixa ⇒ re-pergunta, zero LLM nos atalhos, `NotificationRule` persistida como hoje; nada muda em
outbox/disparos.

### E. Invariantes mantidas (não regredir)

E1. Handler do bot fino; máquina pura (`machine.ts`) recebe eventos/classificados por parâmetro; zod em
toda borda (`contracts`); LLM **só extrai candidatos** — régua/máquina decidem (ADR-004); datas UTC
no banco, tz na borda (ADR-002); needs_review em confiança baixa (ADR-010); `docs/cenarios-do-bot.md`
atualizado no mesmo commit (regra `documentation.md` 8 — falas novas do eco/convite são visíveis no
chat); `pnpm build && pnpm test && pnpm lint && pnpm lint:arch` verdes.

## Fora de escopo

- Fluxo base de criação (mãe), conflito, notas, confirmação final, edição/cancelar pelo chat — **inalterados**.
- Múltiplos candidatos na mesma fala; recorrência; Templates; lembrete "no dia às Xh" por texto livre
  além do que `extrairLembreteSchema` já cobre hoje.
- Repaginar todos os teclados do bot com `callback_data` estruturado (só o do lembrete é obrigatório; D4
  trata o princípio).
- Máquina de estados no banco / persistência de sessão (TTL em memória continua).
- Mudanças em web, outbox, worker, resumo diário.
- Heurística de "título ruim" aprendida/estatística — B2 é regra simples e determinística.

## Fronteiras e dados

- **Entidades/contratos tocados**:
  - `packages/contracts/src/llm/extrairAgendamento.ts` — campo `endsAt?: string` (ISO com offset) +
    tool JSON espelhada; zod na resposta (safeParse) como hoje;
  - `apps/api/src/modules/ai/scheduling-interpreter.service.ts` — prompt: intervalo "de X até Y",
    título curto (B2), dia-da-semana A4; `cache_control` no system estável preservado;
  - `apps/api/src/modules/bot/extraction-ruler.ts` — validar `endsAt` (A2/A3), materializar `endUtc`
    preferindo `endsAt` explícito sobre `durationMinutes`/default; vereditos mantidos;
  - `apps/api/src/modules/bot/scheduling-flow.service.ts` — remover `titleHint`-fala-inteira (B1);
    portão não dispara para callback (D4); convite "personalizado" (D2);
  - `apps/api/src/modules/bot/scheduling-flow.machine.ts` — transições: `falhou` sem título ⇒ passo
    `titulo` pergunta; eco incremental (C1); contador de tentativas do lembrete (D3);
  - `apps/api/src/modules/bot/messages.ts` — falas novas (eco parcial, convite personalizado, teclado
    fixo de recuperação) + `callback_data` estruturado do teclado `lembreteAtalhos`;
  - Prisma: **zero migration** (o intervalo multi-dia já coube no schema `[startsAt, endsAt)`);
  - `schedule-core`: **intocado** (`findConflict` já consome intervalo puro; se o eco precisar formatar
    datas, usa os helpers de `dates.ts` pela borda).
- **Onde mora a regra**: validação/precedência de fim e materialização UTC ⇒ **bota→régua**
  (`extraction-ruler` na borda do bot, puro o suficiente para testar com `now`/offset injetáveis); dia
  ≥ hoje é do modelo ancorado no prompt **com a régua como rede de segurança** (mesmo desenho da
  spec avançada regra 3 — não há função nova de calendário; se a implementação preferir resolver
  dia-da-semana deterministicamente na borda, é `schedule-core/dates`, com testes); conflito ⇒
  `schedule-core` (nada novo). Máquina só transiciona.

## Critérios de aceite (Gherkin)

### A — intervalo completo (régua da extração, vitest com mocks de LLM e `now` injetável)

- **Dado** hoje sáb 10/10 (America/Sao_Paulo), conta confirmada **Quando** o usuário escreve "Tenho um
  novo compromisso, uma viagem para lucena de 19h hoje e vai até 17h na segunda" **E** o extrator devolve
  `{ title: "viagem para lucena", startsAt: 2026-10-10T19:00-03:00, endsAt: 2026-10-12T17:00-03:00,
confidence ≥ limiar }` **Então** o candidato sai com `startUtc = 22:00Z 10/10` e `endUtc = 20:00Z
12/10` (multi-dia, ~46h) **E** os passos dia/hora/fim são pulados **E** o eco cita o intervalo
  completo no tz do usuário.
- **Dado** extração aceita **E** `endsAt = startsAt` (ou anterior) **Então** o "quando" é tratado como
  inválido ⇒ re-pergunta o ponto faltante **E nenhum** needs_review é criado por isso.
- **Dado** extração aceita com `endsAt` **E** `durationMinutes` inconsistente **Então** `endUtc` deriva
  de `endsAt` (a duração é ignorada silenciosamente? não — logado em debug).
- **Dado** fala "das 8h às 17h do dia 12" sem duração **Então** o compromisso criado dura 9h (nada de
  default 60 min).
- **Dado** `endsAt` com offset ≠ tz da conta **Então** veredito `fraco` ⇒ needs_review com
  `reviewReason = parse_falho` (comportamento vigente do `startsAt`, agora também para o fim).
- **Dado** bloco multi-dia 10/10 19:00 → 12/10 17:00 proposto sobre "Reunião" confirmed 11/10 09:00–10:00
  **Então** `findConflict` reporta conflito (contenção) e o bot dá remarcar/abortar antes das notas.
- **Dado** hoje sáb 10/10 e fala com "na segunda" **Então** a data resolvida e ecoada é **seg 12/10**
  (próxima ocorrência ≥ hoje); dita na própria segunda, "segunda" ⇒ hoje.

### B — título

- **Dado** o extrator falha (timeout/parse nas duas tentativas) numa fala de 15 palavras **Então**
  **nenhum** título é preenchido pela fala **E** o bot segue o guiado **perguntando o título** (passo
  `titulo`) — a frase não vira título.
- **Dado** o modelo devolve `title` igual à fala quase inteira (≥ 80% do comprimento normalizado)
  **Então** ele é descartado como título e o bot pergunta.
- **Dado** título curto válido extraído **Então** nenhuma pergunta de título é feita **E** a fala de eco
  e o resumo final mostram `Viagem para Lucena` **E** "alterar" lista título como item alterável.
- **Dado** régua ⇒ needs_review **Então** o título extraído vive só em `rawText`/revisão (não "confirma"
  nada no chat).

### C — incremental

- **Dado** extração com título válido e dia mas sem hora **Quando** o veredito for `quando_parcial`
  **Então** o bot responde no estilo `Entendi: "Viagem para Lucena" hoje — a que horas começa?` **E**
  teclado de horas **E** o candidato mantém título+dia (nada é re-perguntado).
- **Dado** o usuário responde o horário **Então** o fluxo segue para notas sem re-perguntar título/dia.

### D — lembrete

- **Dado** o passo `lembrete` exibido **Quando** o usuário **clica** em "3-2-1" **Então**
  `reminderRules = [countdown_3_2_1]` sem **nenhuma** chamada de LLM **E** o fluxo segue para
  confirmação.
- **Dado** o passo `lembrete` **Quando** o usuário clica em "personalizado" **Então** o bot responde o
  convite de texto livre com exemplo **E nenhuma** chamada de LLM ocorre nesse clique **E** o passo
  permanece `lembrete`.
- **Dado** o usuário digita texto incompreensível no lembrete **Então** 1ª falha: re-pergunta com
  exemplo; 2ª falha consecutiva: o bot exibe o **teclado de atalhos fixo** e para de chamar o LLM até
  novo texto livre após o teclado; texto livre subsequente volta a ser interpretado normalmente.
- **Dado** um clique em **qualquer** botão de teclado **Então** o portão da extração livre
  (`openCreate`) **não** roda (zero LLM por clique).
- **Então** "sem lembrete" por clique ⇒ `[{type:'none'}]` como hoje; texto livre "2h antes" continua
  passando por `resolveReminderShortcut` sem LLM.

### Arquitetura/regressão

- **Então** `handleCallback` não delega label de lembrete a `handleText` **E** o contrato da tool
  extrator passa por `safeParse` (sem `.strict()` — gotcha 4) **E** testes cobrem os 4 payloads do
  schema alterado (testing.md #2) **E** `pnpm lint:arch` verde **E** os fluxos da spec mãe (conflito,
  notas, confirmação, cancelamento) continuam passando sem mudança.

## Decisões (aprovadas pelo humano em 2026-10-10)

| #   | Decisão                        | Escolhida                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Dia da semana ambíguo          | "segunda" = **próxima ocorrência ≥ hoje** no tz do usuário (hoje segunda ⇒ hoje; "que vem" ⇒ +7 dias via prompt); eco da data resolvida é obrigatório                                                                                                                                          |
| 2   | Modelagem do fim               | **`endsAt` opcional** no `extrairAgendamentoSchema` (o modelo copia instantes, nunca calcula); `durationMinutes` vira fallback                                                                                                                                                                 |
| 3   | Título sugerido                | **ecoado no resumo/fala de pulo, sem turno extra**; sem título claro ⇒ pergunta; frase inteira jamais                                                                                                                                                                                          |
| 4   | Tentativas do lembrete         | **2** falhas consecutivas de texto livre ⇒ teclado de atalhos fixo (anti-loop; texto livre continua aceito)                                                                                                                                                                                    |
| 5   | Atalho aceito sem fim extraído | **Sempre perguntar o passo `fim`** quando a régua não viu fim explícito na fala (decisão humana 2026-10-10; substitui a decisão #4 da spec avançada que pulava `fim` com default 60 min). Default 60 min só sobrevive como fallback do teclado de horas, nunca como chute silencioso do atalho |

## Notas técnicas (decididas, sem pergunta)

- **TDD primeiro** nos pontos de regra (testing.md): régua com `endsAt` (presente/inválido/inconsistente
  com duração/multi-dia/offset), máquina com `falhou` sem título, contador do lembrete, portão não
  dispara via callback. Casos-limite obrigatórios: fim == início; fim cruzando meia-noite; "segunda"
  dita no domingo vs na segunda; 2ª falha seguida por texto válido (zera contador).
- `endsAt` **não** vai para o `appointmentInputSchema` como campo novo — a borda materializa
  `startUtc`/`endUtc` e o payload final é o schema de sempre.
- Heurística B2 (título ≈ fala) roda na **borda** com normalização simples (minúsculas/acentos); lista
  de prefixos de intenção ("tenho", "quero", "marca", "bora") em constante testável.
- Contador de lembrete vive na sessão em memória (`FlowCandidate`/sessão da máquina), não no banco.
- `docs/gotchas.md`: entrada nova no commit do fix — "callback de botão reaproveitado como fala"
  (problema → fix → nunca roteiar label de teclado por `handleText`).
- ADR novo (número da implementação, ~0018): "Fim explícito `endsAt` na extração + dia-da-semana ≥ hoje
  - título como sugestão ecoada" — três faces da mesma decisão "aproveitar o que o usuário disse sem
    chute silencioso".
