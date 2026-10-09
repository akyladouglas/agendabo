# Spec — Reagendamento Assistido: regra de conflito sem override (Etapa 0, Fase 8)

- Domínio: agendamento (regra em `schedule-core` + API), com consumo pela web e pelo bot | Data: 2026-10-08 | Status: rascunho
- ADRs relacionados: **ADR-003/004** (LLM interpreta, regras determinísticas decidem — o plano humano reafirma: LLM nunca decide conflito), **ADR-002** (UTC no banco), **ADR-011** (aviso de gatilho retroativo — reaproveitado no reagendamento), **ADR-005** (web consome `schedule-core` via alias de fonte). **Nenhum ADR vigente é contrariado** — o `force` nunca teve ADR (era bug de spec, não decisão registrada); a nova invariante "**sobreposição nunca é possível**" (decisão humana 2026-10-08, plano `ia-docs/plans/grades-dia-semana-mes.plan.md` §0) **merece ADR novo: ADR-0015 — "Fim do `force`: sobreposição é invariante do produto"** (registrar antes de codar, previsto no próprio plano).
- Pedida por: usuário (Fase 8, Etapa 0 do PROMPT.md 7b; decisão humana 2026-10-08 no plano) | Fase do roadmap: **8 (Etapa 0)**
- Fecha o **bug C.11** do form web (hoje o `AppointmentModal` mostra a mensagem de 409 e não oferece ação nenhuma) e corrige o **bug do update** (`PATCH /appointments/:id` permitir sobrepor sem checagem efetiva).

## Objetivo / dor do usuário

Hoje o usuário que marca um compromisso no horário de outro tem dois caminhos ruins: o bot re-pergunta (bom), mas a web **mostra o conflito e não deixa fazer nada** (C.11) — e por baixo dos panos o `force` do update **cria sobreposição**, algo que o produto nunca deveria permitir. A decisão humana de 2026-10-08 fecha a questão: **dois compromissos nunca ficam sobrepostos**. Esta Etapa 0 entrega a peça que faltava para isso: ao detectar conflito, uma regra pura e determinística (`planRelocation`) oferece **uma jogada simples** — mover o existente OU o movido para o primeiro slot livre — e, quando não há jogada, explica e **não salva**. É a base que o drag da Etapa 2 vai reaproveitar, e o form da web passa a ter ação real de imediato.

## Comportamento esperado

### A. Invariante nova (fronteira de escrita)

A1. **Sobreposição é invariante do produto**: nenhuma fronteira de escrita (`POST /appointments`, `PATCH /appointments/:id`, `POST /appointments/reschedule`, confirmação de revisão, bot) aceita gravar dois compromissos `confirmed`/`needs_review` **futuros** sobrepostos (half-open `[startsAt, endsAt)`, encostado não conta — mesma semântica de `findConflict`). Conflito ⇒ **409 e NADA escrito**.
A2. **`force` deixa de existir**: verificado por inspeção (2026-10-08), o campo `force` **não está presente hoje** nos schemas reais (`appointmentInputSchema`/`appointmentPatchSchema` em `contracts/entities/appointment.ts`) — o que existe é o **vazio de checagem** descrito em A3. A invariante deixa isso explícito e blindado: `force` **não entra** em nenhum input de escrita (nem create, nem patch, nem reschedule), os schemas **não o aceitam** e a API **rejeita sempre** em conflito; se um client antigo enviar a chave, o zod a **ignora** (decisão técnica D2) e o conflito continua 409. (O prompt da etapa fala em "remover `force` dos schemas": na prática é **garantir que ele não exista nem entre**, que é o que a invariante pede.)
A3. **Como a sobreposição entrava hoje (o bug real)**: `assertNoConflict` usa `existingFor`, que filtra **só `confirmed`** — um compromisso `needs_review` sobreposto era invisível para a checagem, e o `PATCH` aceitava o horário por cima dele. Além disso, em `update` a checagem roda **antes** da tx (janela corrida). `POST /appointments/:id`-equivalentes do form ("confirmar mesmo assim") não têm mais sentido: `PATCH /appointments/:id` passa a **revalidar conflito** sempre que o horário resulta diferente do atual, com a carga de `confirmed + needs_review` (E1/D6). Editar título/notas/regras **sem tocar o horário** não é bloqueado: a checagem ignora o **próprio** compromisso (`ignoreId = id`) — a invariante vale para **novas** sobreposições (estado legado: ver Aberto #1).

### B. Regra pura `planRelocation` (schedule-core, TDD obrigatório)

B1. **Nova função em `schedule-core`** (arquivo `relocation.ts`, exportada no `index.ts`; pureza total — zero I/O, `now` injetável, não lança para fluxo normal, retorna resultado discriminado — `schedule-core.md` 1/2):

```
planRelocation(candidate, existing[], options) →
  { kind: 'ok' }
| { kind: 'blocked', reason: 'self-conflict' }
| { kind: 'options', options: RelocationOption[] }

RelocationOption =
  | { kind: 'move-other', other: T, newStart: Date, newEnd: Date }
  | { kind: 'move-self',  newStart: Date, newEnd: Date }

options = { now?: Date, movedId?: string }   // now default Date.now, como findConflict
```

B2. **Entrada**: `candidate` = o **intervalo novo** do compromisso que o usuário quer mover/criar no destino; `existing[]` = compromissos futuros do usuário (a mesma carga de `existingFor` da API, já sem `cancelled`); `movedId` = id do compromisso que está sendo movido (ausente = **criação** — nada a ignorar). A função **ignora** de `existing` (i) o item com `id === movedId` e (ii) itens totalmente passados (`endsAt <= now`) — mesma semântica de `findConflict`.

B3. **Saída `ok`**: `candidate` não sobrepõe nenhum futuro de `existing` (ignorados B2) ⇒ `{ kind: 'ok' }`. Encostado **não** é conflito.

B4. **Saída `blocked: self-conflict`**: `candidate` sobrepõe **mais de um** existente ⇒ não existe jogada de um lance que remova o conflito de `candidate` (mover só um dos dois deixaria o outro sobreposto). Retorna `{ kind: 'blocked', reason: 'self-conflict' }` — a UI não salva, explica. (Um único conflito tem resolução; dois ou mais, não — cascata é fora de escopo.)

B5. **Opções (exatamente um conflito `C`)**. A função tenta **duas jogadas independentes** e devolve as que **fecham** (cada uma verificada de forma autônoma; podem vir as duas, uma ou nenhuma, nesta ordem: `move-other` primeiro):

- **`move-other`** (empurra o existente): o conflito `C` é realocado para o **primeiro vão livre a partir do início DELE** (`C.startsAt`, âncora da meia-lua que gira no lugar), preservando a **duração de `C`** (`newEnd − newStart = C.endsAt − C.startsAt`). "Livre" = não sobrepõe o `candidate` **parado** (ele ainda ocupa o destino — o slot começa exatamente no fim dele se couber; encostado vale) **nem nenhum terceiro** de `existing` (excluídos `movedId` e o próprio `C`; passados ignorados). O vão avança encostando no fim do próximo bloqueio até caber — varredura determinística, finita (B8). Se o pouso coincidir com o lugar atual de `C`, não é jogada.
- **`move-self`** (empurra o movido): o `candidate` é realocado para o **primeiro vão livre a partir do destino (`candidate.startsAt`)**, preservando a **duração do candidate**. Mesmo critério de "livre": não sobrepõe **nenhum** de `existing` (excluídos `movedId`; `C` fica no lugar e é o obstáculo inicial) — o buraco que o candidate deixa ao sair é a primeira casa elegível. Se o pouso coincidir com o destino atual, não é jogada.
- Cada jogada **só é oferecida se o resultado não conflitar com nenhum terceiro** — uma jogada por vez; depois de executar, a UI recomeça o `plan` (decisão humana do plano §0.1: determinístico, sem cascata).

B6. **Sem jogada**: em carga finita a varredura sempre termina no fim do último obstáculo e o vão seguinte está livre (B8) ⇒ com exatamente **um** conflito as duas jogadas sempre fecham; `{ kind: 'options', options: [] }` fica reservado como forma defensiva (a superfície **não salva** e explica: "Não há como encaixar sem sobreposição."). O "não cabe" real é `blocked: self-conflict` (2+ obstáculos no destino). Cada jogada **deve mover a peça** — pousar no mesmo lugar não é jogada. (Não há `kind: 'impossible'` separado — D3.)

B7. **Meia-noite/dias**: a varredura de slot livre opera em instante UTC puro — **atravessar meia-noite UTC é irrelevante** (não existe noção de "dia" na regra; o slot pode cair em qualquer dia). Datas em UTC, `now` injetável (ADR-002, `schedule-core.md` 4).

B8. **Terminação**: os existentes futuros são finitos e ordenáveis por `startsAt`; a varredura de cada jogada tem no máximo `existing.length + 1` candidatos a slot (cada salto encosta no fim de um obstáculo) ⇒ sempre termina. Duração maior que qualquer buraco ⇒ jogada falha naturalmente.

B9. **Ordem determinística**: `move-other` antes de `move-self` na lista; empates resolvidos por varredura temporal (primeiro slot livre). Mesma entrada ⇒ mesma saída, sempre.

### C. API

C1. **Novo zod em `contracts/api/appointments.ts`**:

- `rescheduleAppointmentInputSchema` = **união discriminada** (D-W5): variante `{ movedId: uuid, otherId?: uuid, newStart: isoDate, newEnd: isoDate }` (move existente) **XOR** variante `{ create: appointmentInputSchema, otherId?: uuid }` (cria novo; o `otherId` presente desloca o existente no mesmo request). Refines: `newEnd > newStart` na primeira variante; `otherId` distinto de `movedId` quando ambos presentes;
  - **pós-entrega (2026-10-09, D4 na prática)**: a variante `move` ganhou `otherStart?/otherEnd?` opcionais = o slot que a UI MOSTROU para o `otherId`; o server recomputa a jogada e, se o horário dela **mudou**, recusa com `RelocationNotAvailableError` (409) — client obsoleto não escreve. Os inputs de escrita da fase são `.strict()`: chave desconhecida (ex.: um `force` retrabalhado) é **rejeitada**, não descartada em silêncio (R10 da revisão).
- `relocationOptionsInputSchema` = `{ startsAt, endsAt, movedId? }` (mesma semântica de candidato do `check-conflict`: `startsAt/endsAt` = destino; `movedId` = em edição, o que está sendo movido);
- schemas de resposta correspondentes (opções serializadas com `other` como `appointmentSchema` + `newStart/newEnd` ISO; `blocked` carrega `reason`).

C2. **`POST /appointments/relocation-options`** (rota **antes** de `:id`; exige auth; só **lê**) — decisão D1: roda `planRelocation` **server-side** com a mesma carga de `existingFor(userId, movedId)`:

- `blocked` → **409** `{ message, conflictWith }` com o **primeiro** conflito (por `startsAt`) — **mesmo corpo e status do 409 do `POST`/`check-conflict` atuais**, para o form tratar conflito por um caminho só (`conflictMessage` existente funciona sem mudança); a UI diferencia "ofereça jogadas" de "não cabe" pela rota que respondeu, não pelo código HTTP;
- opções (inclusive vazias) → **200** `{ kind: 'options', options: [...] }`;
- sem conflito → 200 `{ kind: 'ok' }`.

C3. **`POST /appointments/reschedule`** (rota antes de `:id`) com C1.input. Comportamento:

1. **Carrega** `movedId` (e `otherId`, se presente) com `userId` **e** `status in (confirmed, needs_review)`; achou outro's dono errado/inexistente/cancelado ⇒ **404** e nada escrito.
2. **Monta o plano da escrita** (chamada pura a `findConflict`/`planRelocation` com carga re-lida `status in (confirmed, needs_review)`, futuros — ver caso-limite E2):
   - `otherId` **ausente**: o movido vai para `newStart/newEnd`; revalida esse intervalo contra **todos os outros** do dono (excluído o próprio movido) — é um renomeio de horário (equivale ao update sem `force`);
   - `otherId` **presente**: `other` vai ao slot da jogada `move-other` **recomputado pelo server** com a carga real (D4: o server **não** confia no horário sugerido do client; recomputa via `planRelocation` e exige que a jogada pedida exista — a resposta 409 "jogada não disponível" cobre client obsoleto).
   - Qualquer conflito restante ⇒ **409 `{ message, conflictWith }` e NADA escrito** (revalidação também dentro da tx — E5).
3. **Transação Prisma única**: revalida conflito; escreve o movido (e o `other`); para **cada lado cujo `startsAt` mudou**, `invalidateForAppointment` + `materializeInTx` dos lembretes na **MESMA tx** (regras 6/9/12 da spec de notificações: linhas `pending` viram `cancelled` e novas nascem do `startsAt` novo; gatilho no passado = zero linhas, descartado pelo schedule-core). Lado que não mudou de instante: outbox intacto.
4. **Pós-commit**: `enqueueJobs` dos novos gatilhos (Redis **nunca** dentro da tx — padrão existente).
5. **Response**: `{ moved, other | null, droppedRules: NotificationRuleType[] }` — `droppedRules` para o web avisar gatilho retroativo (ADR-011, mesma mecânica do create/update). _(Entregue sem o campo `relocated` que esta linha prometia: o `other` já é nulo quando nada mais se moveu — R9 da revisão; o contrato real é `rescheduleResultSchema`.)_

C4. `POST` e `PATCH` continuam 409 em conflito **sempre** (A2/A3) — sem override de nenhuma espécie, salvar com horário conflitante passa a ser **impossível** (era o bug do update).

C5. **Testes de API**: jest do service (plano da escrita, 409 sem escrita, 404 de dono, transação dupla, outbox invalidado/re-materializado só no lado que mudou de instante) + e2e do 409 e da transação dupla (como prevê o plano §0.2).

### D. Web (fecha C.11)

D-W1. **`AppointmentModal` (criar E editar)**: ao salvar com conflito (via `check-conflict` prévio ou 409 da resposta), em vez de só exibir a mensagem, o form chama `POST /appointments/relocation-options` e renderiza o **Reagendamento Assistido** dentro do próprio modal (mesmo padrão visual que o drag da Etapa 2 usará):

- **`move-other`** → botão "**Mover ‹título do existente› para ‹novo horário no tz do usuário›**";
- **`move-self`** → botão "**Criar ‹novo horário› movendo este para ‹novo horário self›**" (modo criar) / "**Salvar ‹novo horário› movendo este para ‹novo horário self›**" (modo editar);
- **Cancelar** (fecha sem salvar).

D-W2. Ao confirmar uma opção, o form chama `POST /appointments/reschedule`:

- **edição** `move-other` ⇒ variante `{ movedId: id-editado, otherId: id-existente, newStart/newEnd }` — move os **dois** na mesma transação;
- **edição** `move-self` ⇒ variante `{ movedId, newStart/newEnd }` sem `otherId` — renomeio do movido;
- **criação** `move-other` ⇒ variante `{ create, otherId }` — cria e desloca no mesmo request (D-W5);
- **criação** `move-self` ⇒ variante `{ create }` com o horário da jogada (sem `otherId`);
- toast de sucesso "**Reagendado para ‹data hora no tz›**" (do movido/criado), invalida `qk.agenda()`/`qk.appointments(from,to)` e fecha o form.

D-W3. **Opções vazias ou `blocked`**: mensagem "**Não há como encaixar sem sobreposição**" e botão de salvar **desabilitado** enquanto o horário conflituoso permanecer; mexer o horário re-avalia (fluxo de `check-conflict` existente, com debounce).

D-W4. **Novo `useRescheduleMutation`** (`composables/useReschedule.query.ts`) — padrão vue.md: mutation + invalidação de agenda/review + tratamento de 409 (`conflictMessage` existente) e 404; **sem optimistic update** (a cache é a verdade).

D-W5. **Criar com conflito (sem `movedId`)**: o compromisso ainda não tem id, mas o fluxo do produto é "criar aqui **empurrando o existente**" — e isso **precisa ser atômico** (dois requests do client, criar + mover, deixariam uma janela de sobreposição proibida por A1). Decisão (D5): `rescheduleAppointmentInputSchema` é um **união discriminada** — variante `movedId` (move existente) **XOR** variante `create` (payload de criação completo, o `AppointmentInput` de sempre). `otherId` é opcional em **ambas** as variantes (presente = o existente indicado é deslocado para o slot da jogada `move-other` no MESMO request). Um único endpoint, uma única transação, zero janela de sobreposição. A variante `create` não é usada por nenhum outro consumidor; a Etapa 2 (drag) só move existentes. A opção `move-self` na criação também usa esta rota (variante `create` com o horário já deslocado, sem `otherId`) — ou, equivalentemente, um `POST /appointments` simples quando o usuário aceitar o slot sugerido; o form usa `reschedule` nos dois casos para manter um caminho de código só.

### E. Casos-limite

E1. **`needs_review` conta como obstáculo e como lado movível.** Em `reschedule` e `relocation-options` a carga considera `status in (confirmed, needs_review)` — um compromisso em **revisão** já está no calendário do usuário e a UI já o mostra com ⚠️; tratá-lo como fantasma permitiria criar sobreposição "invisível" que a invariante A1 proíbe no instante em que a revisão for confirmada. Os dados carregados para `planRelocation` excluem apenas `cancelled` e totalmente passados. (Nota: a checagem de escrita **atual** — `existingFor` — usa só `confirmed`; esta spec a **alarga** para `confirmed + needs_review`, decisão de consistência da invariante. O `findConflict` em si não muda; o filtro é da borda da API, como hoje.)
E2. **Passados**: ignorados como obstáculos (mesma semântica `findConflict`, `endsAt <= now`). Reagendar **para o passado** não é bloqueado por conflito (compromissos passados são inertes), e os lembretes viram zero linhas (regra existente).
E3. **Slot livre cruzando meia-noite UTC/local**: irrelevante para a regra (B7); o horário é mostrado ao usuário formatado no tz dele (borda).
E4. **Duração > buraco disponível**: a jogada falha (B8); se as duas falharem, `options: []` → UI não salva.
E5. **`movedId`/`otherId` de outro usuário ou inexistente/cancelado** ⇒ **404** (nada escrito). **Transação atômica**: se o segundo update falhar (qualquer erro), o primeiro **não** fica aplicado (rollback da tx única); a revalidação de conflito **dentro** da tx fecha a janela corrida (dois requests concorrentes que individualmente cabem mas se sobrepõem → um dos dois 409 no commit — ver F.2 para o mecanismo).
E6. **`otherId === movedId`** ⇒ 400 zod (`otherId` deve ser distinto de `movedId`).
E7. **Horário destino já livre** (`planRelocation → ok`): o form salva direto (create/update normal), sem diálogo.
E8. **Compromisso que cruza a meia-noite** como obstáculo: funciona — o modelo é `[startsAt, endsAt)` puro, sem noção de dia (glossário).

### F. Bot e transversal

F-B1. **Bot inalterado no comportamento visível**: em conflito o bot **re-pergunta o "quando"** (fluxo vigente da máquina de estados). Como o `force` não existia no caminho do bot (ele já tratava `AppointmentConflictError`), nenhuma fala muda. `docs/cenarios-do-bot.md`: sem mudança visível → sem novo cenário (regra `documentation.md` 8; revisar a tabela de conflitos para garantir que não menciona force).

- **Pós-entrega (R1 da revisão multi-agente, 2026-10-09)**: F-B1 assumia o bot alinhado, mas o pré-check do chat (`existingConfirmedFuture`) ainda filtrava **só `confirmed`** enquanto a escrita passou a contar `confirmed + needs_review` (D6). Consequência: o bot aceitava no chat e a gravação devolvia 409 TARDE — mensagem de conflito sem os botões remarcar/abortar e sessão já encerrada. **Corrigido em 2026-10-09**: o pré-check do bot usa `confirmed + needs_review`, idêntico à carga de escrita; comportamento visível continua "re-pergunta o quando".
  F-B2. Edição pelo bot (`update` via fluxo de edição) passa a ser **rechaçada em 409** quando o novo horário choca — a máquina já trata `ConflictError` e re-pergunta; o patch enviado pelo LLM nunca carregou `force` efetivo.
  F-B3. **Confirmação da fila de revisão com sobreposição legada (decisão humana 2026-10-08)**: `POST /review/:id/confirm` de item sobreposto continua **409** (já é hoje) e a web passa a **oferecer as jogadas** para esse caso: `relocation-options` com `movedId = id` da fila → o usuário resolve movendo um dos dois (`reschedule` na variante `movedId`, que também aceita mover itens `needs_review` — C3.1) → re-tenta confirmar; **cancelar aborta** e o item permanece na fila exatamente como estava (nada escrito). O badge de conflito da Fase 7 fica informativo; nenhuma sobreposição é "licenciada".
  F.1. **Onde mora a regra**: `planRelocation` e o cálculo de slot livre ⇒ **`schedule-core`** (conflito/data = regra zero; `schedule-core.md`). Orquestração de transação/outbox/dono ⇒ **API service**. Web: só composição, formatação de horário no tz e chamadas de composable (vue.md; zero cálculo de data/conflito em `.vue`).
  F.2. **Corrida de escrita**: a revalidação roda **antes** da tx e de novo **dentro** dela (a carga é relida na transação). O Postgres no default (`READ COMMITTED`) **não** impede que duas transações concorrentes vejam cada uma um snapshot sem o write da outra — fechar isso de verdade exigiria `SERIALIZABLE` ou constraint de exclusão (GiST/btree_gist), complexidade desproporcional ao risco (mesma conta escrevendo ao mesmo tempo; o cenário prático é clique duplo, que a UI já serializa desabilitando o botão durante a mutation). Decisão (D8): dupla revalidação sem constraint; a janela residual é declarada aqui e vira entrada em `docs/gotchas.md` se morder na prática.

## Fronteiras e dados

- **Entidades/contratos tocados**:
  - `contracts/entities/appointment.ts` — `force` **não entra** em `appointmentFields`/`appointmentPatchSchema` (verificado por inspeção: o campo não existe hoje — a spec o mantém proibido, A2/D7); nenhum outro campo muda;
  - `contracts/api/appointments.ts` — novos `rescheduleAppointmentInputSchema` (com variante `movedId` XOR `create`), `relocationOptionsInputSchema` + respostas; `checkConflictInputSchema` permanece como está;
  - `schedule-core` — `relocation.ts` novo (função + tipos + testes), exportado no `index.ts`; `conflicts.ts` intocado;
  - Prisma: **zero migration** (nenhuma coluna nova);
  - `appointments.controller/service` — rotas `relocation-options` + `reschedule`, revalidação no `PATCH` (A3), `existingFor` ampliado p/ `confirmed + needs_review` (usado por todas as checagens de escrita — decide E1/D6);
  - Web: `useAppointmentForm.composable.ts`, `AppointmentModal.vue`, `useReschedule.query.ts` novo;
  - Bot: sem mudança de código (o caminho do bot já tratava `AppointmentConflictError`; nenhuma remoção de tipo é necessária — D7).
- **Onde mora a regra** (repetindo por clareza, é a regra mais dura): plan de jogada = `schedule-core`; escrita transacional = service Nest com `schedule-core` revalidando; UI = apresentação.

## Critérios de aceite (Gherkin)

### Regra pura (`planRelocation`, vitest no schedule-core, `now` injetável — TDD primeiro)

- **Dado** `now = 2026-10-08T12:00Z`, um futuro `A 14:00–15:00` e `candidate 16:00–17:00` **Quando** `planRelocation` **Então** `{ kind: 'ok' }`.
- **Dado** `candidate 14:30–15:30`, futuros `A 14:00–15:00` (único conflito) e `B 15:30–16:00` (**encostado** no candidate — não é conflito) **Então** `options` traz `move-other`: `A → 16:00–17:00` (15:30 estaria sobre `B`, o slot pula encostando no fim dele) **E** `move-self`: candidate `→ 16:00–17:00` (primeiro slot ≥ 14:30 que não toca `A` nem `B`). Encostado vale; obstáculo desloca o slot. _(a lista exata de instantes nasce dos testes; a regra é B5)._
- **Dado** `candidate` que sobrepõe `A` **e** `B` (dois existentes) **Então** `{ kind: 'blocked', reason: 'self-conflict' }` **E** nenhuma opção é oferecida.
- **Dado** conflito único com `A`, e mover `A` para o slot livre ≥ fim do candidate cair sobre `C` **Então** `move-other` **não** aparece; se `move-self` fechar, só ele aparece; se nenhuma fechar, `options: []`.
- **Dado** `movedId` apontando para um dos existentes **Então** ele é ignorado como obstáculo (mover para cima de si mesmo não é conflito).
- **Dado** um existente totalmente passado (`endsAt ≤ now`) sobreposto ao candidate **Então** `kind: 'ok'` (passado ignorado).
- **Dado** duração do `A` maior que qualquer buraco livre ≥ fim do candidate **Então** `move-other` ausente; sem `move-self` ⇒ `options: []`.
- **Então** a varredura de slot livre é finita e determina slots que podem cruzar a meia-noite UTC (mesma saída com `now` equivalente em dias diferentes quando a carga se repete).
- **Então** chamada sem `now` usa `Date.now` (default) e `movedId` ausente não quebra (criação).

### API (jest de service + e2e)

- **Dado** `POST /appointments/relocation-options` com destino sobreposto a exatamente um futuro **Então** 200 com `options` contendo `move-other` com `newStart == fim do candidate` quando livre **E** `move-self` com o primeiro slot ≥ destino.
- **Dado** destino sobreposto a dois futuros **Então** **409** `{ message, conflictWith }` (primeiro conflito) — não é caso de "escolha uma jogada", é "não cabe".
- **Dado** `POST /appointments/reschedule` `{ movedId, newStart, newEnd }` sem conflito **Então** 200, o movido gravado no novo horário, **outbox do movido** invalidado e re-materializado na mesma tx, e jobs só enfileirados após commit.
- **Dado** `reschedule` com `otherId` cuja jogada foi desfeita por um terceiro compromisso criado entre o `relocation-options` e o `reschedule` **Então** 409 e **nem o movido nem o outro** mudaram de horário (nada escrito).
- **Dado** `reschedule` com `otherId` válido **Então** os **dois** compromissos são gravados na mesma transação e **ambos** os lados que mudaram de `startsAt` têm lembretes re-materializados; o lado que não mudou mantém seu outbox.
- **Dado** `movedId` de outro usuário **Então** 404 e nada escrito; idem `otherId` de outro usuário, inexistente ou `cancelled`.
- **Dado** `create` (variante de criação) com `otherId` cuja jogada vale **Então** um request cria o novo **e** desloca o existente atomicamente.
- **Dado** payload com a chave `force` em create/update **Então** o campo é ignorado e o comportamento é o da invariante (409 se conflitar).
- **Dado** `PATCH /appointments/:id` mudando só o título de um compromisso (qualquer status, inclusive `needs_review`) **Então** 200 **E** a checagem de conflito ignorou o **próprio** compromisso (`ignoreId = id`). **Caso cego conhecido de `findConflict`** (já apontado pela regra de testing): compromisso **parcialmente no futuro** (`endsAt > now > startsAt`) não é ignorado por "passado" e, sem `ignoreId`, chocaria consigo mesmo — a checagem de escrita **sempre** passa `ignoreId` no update.
- **Dado** gatilhos do novo horário que já passaram **Então** zero linhas de outbox para eles **E** `droppedRules` no response (ADR-011).

### Web (vitest do composable + smoke manual)

- **Dado** o form de **criação** com destino sobrepondo exatamente um existente **Quando** salvar **Então** aparece o diálogo com "Mover ‹título› para ‹hh:mm›" e "Criar ‹hh:mm› movendo este para ‹hh:mm›" e Cancelar; **nenhum** botão "criar mesmo assim" existe.
- **Dado** clicar em "Mover ‹existente›" **Então** `reschedule` é chamado, o toast "Reagendado para ‹data hora›" aparece, a agenda e a revisão são invalidadas, e **os dois blocos** mudam de horário no calendário sem recarregar.
- **Dado** opções vazias **Então** a mensagem "Não há como encaixar sem sobreposição" e o botão salvar **desabilitado**; ajustar o horário para um slot livre re-habilita.
- **Dado** 409 na resposta do save (corrida) **Então** o form trata como conflito (mesmo caminho do check prévio), nada é gravado pela metade.
- **Então** nenhum cálculo de conflito/jogada/data dentro de `.vue` (lint:arch; opções vêm prontas do server) e nenhuma fetch fora de `app/composables`.

### Gates

- **Então** `pnpm build && pnpm test && pnpm lint && pnpm lint:arch` verdes; smoke: criar com conflito → diálogo → confirmar move os dois; opção impossível → mensagem e nada salvo; bot re-pergunta quando em conflito (comportamento vigente intacto).

## Decisões tomadas nesta spec (com alternativas)

| #   | Decisão                                                      | Alternativas                                                                                                                     | Escolhida + justificativa                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Onde roda `planRelocation` para a UI                         | (a) client via alias ADR-005 sobre a carga do `check-conflict`; (b) **endpoint server `POST /appointments/relocation-options`**  | **(b)**: a UI hoje só conhece a página carregada — o slot livre precisa dos futuros **inteiros** do dono, e "primeiro slot livre" sem a carga completa mentiria. A regra única fica no server, a mesma carga de `existingFor`, e o input é idêntico ao do `check-conflict` (`startsAt/endsAt/movedId?`). O alias ADR-005 continua válido para formatação/datas; a Etapa 2 (drag) usa o mesmo endpoint. |
| D2  | `force` em payload antigo                                    | (a) erro 400 por campo desconhecido; (b) **ignorado silenciosamente**                                                            | **(b)**: `force` era campo lícito até ontem; quebrar client cacheado com 400 por um campo que a API simplesmente não usa mais é dor sem ganho — o conflito continua 409 de qualquer forma.                                                                                                                                                                                                             |
| D3  | Representar "impossível"                                     | (a) `kind: 'impossible'`; (b) **`kind: 'options', options: []`**                                                                 | **(b)**: um caso discriminado a menos; "lista vazia = não salva" é a decisão. (`blocked/self-conflict` permanece próprio caso: é outro motivo, outra fala.)                                                                                                                                                                                                                                            |
| D4  | Server recompute a jogada no `reschedule`                    | (a) aceita o `otherNewStart/End` do client; (b) **recomputa e recusa se a jogada sumiu**                                         | **(b)**: client obsoleto (terceiro compromisso criado no meio) não consegue escrever sobreposição — a invariante A1 vale para a escrita, não só para a sugestão.                                                                                                                                                                                                                                       |
| D5  | Criar com conflito na web                                    | (a) two-step client (cria + move) com janela de sobreposição; (b) **`reschedule` com variante `create` XOR `movedId`, tx única** | **(b)**: atomicidade da invariante acima de elegância de API; a variante não é usada por nenhum outro consumidor (drag move existentes).                                                                                                                                                                                                                                                               |
| D6  | `needs_review` como obstáculo/lado                           | (a) só `confirmed` (como `existingFor` hoje); (b) **`confirmed + needs_review`**                                                 | **(b)**: revisão já aparece no calendário (⚠️) e pode ser confirmada a qualquer momento; ignorá-la criaria sobreposição-latente proibida por A1. Amplia o filtro da borda (service), não `findConflict`. Consequência: `PATCH`/`POST` passam a considerar revisões — mudança de checagem **mais estrita**, alinhada à invariante.                                                                      |
| D7  | Fidelidade ao enunciado da etapa ("`force` sai dos schemas") | (a) escrever a spec como se o campo existisse; (b) **verificar o código real e descrever o estado verdadeiro**                   | **(b)**: inspeção 2026-10-08 mostra que `force` **não está** em `appointmentInputSchema`/`appointmentPatchSchema`; o vetor real da sobreposição é A3 (`existingFor` só `confirmed`). A spec blinda os dois: campo não entra, checagem considera revisões.                                                                                                                                              |
| D8  | Constraint de exclusão no banco (anti-corrida)               | (a) btree_gist/exclusion constraint; (b) **dupla revalidação (pré-tx + in-tx), sem constraint**                                  | **(b)**: custo/benefício; escala mono-usuário; janela residual documentada (F.2), gotcha se morder. Reversível depois sem mudar regra.                                                                                                                                                                                                                                                                 |

## Fora de escopo

- Grades Dia/Semana e **drag-and-drop** (Etapas 1–2 da mesma fase — consomem `relocation-options`/`reschedule` sem mudá-los).
- **Mover mais de 1 compromisso por vez**, cascatas de múltiplos lances, "empurrar tudo para frente".
- UI do **bot** para reagendamento assistido (o bot continua re-perguntando o "quando"; botões de jogada no chat ficam devidos a uma fase futura de bot).
- Constraint de exclusão no Postgres (D8), recorrência, lixeira, redimensionar bloco, exportação, Fases 6 residual/9.
- Tela de **revisão**: o fluxo de confirmar `needs_review` ganha o **fluxo de jogadas** descrito em F-B3 (sobreposição legada se resolve ali, cancelar aborta); a **carga** da checagem muda (D6: `confirmed + needs_review`, mais estrita).

## Aberto (decisões de produto — uma só)

| #   | Pergunta                                                                                                                                                                                         | Opções                                                                                                                | Recomendação                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Confirmar um `needs_review` **já sobreposto** (sobreposição legada que entrou pela checagem cega descrita em A3 antes desta etapa): deve bloquear até o usuário arrumar, ou aceitar e sinalizar? | (a) bloqueia até resolver; (b) aceita a confirmação e mostra o alerta de choque na agenda (badge existente da Fase 7) | **(a)** — RESPOSTO pelo humano (2026-10-08): **nenhum compromisso pode ficar sobreposto a outro, em nenhum momento**. Confirmar da fila segue o MESMO fluxo de conflito da Etapa 0: detectar → oferecer `relocation-options` (mover o outro OU o próprio) → resolver ajustando um ou outro → cancelar = aborta e o item volta exatamente como estava na fila (nada escrito). O badge de conflito da Fase 7 continua existindo mas passa a ser informativo do estado atual, não uma licença para sobreposição. Itens legados já sobrepostos no banco só podem ser confirmados depois de resolvidos (a UI abre as jogadas; cancelar mantém na fila). |

## Notas de implementação (técnicas, para o feature-builder)

- **TDD primeiro** (regra `testing.md` + `schedule-core.md` 6): `relocation.spec.ts` nasce antes de `relocation.ts`. Casos mínimos: ok / um conflito (as duas jogadas válidas) / encostado / dois conflitos (`blocked`) / jogada bloqueada por terceiro / `movedId` ignorado / passado ignorado / duração > buraco / slot além da meia-noite / ordenação `move-other` antes de `move-self`.
- Rota nova do controller **antes** de `@Patch(':id')`/`@Delete(':id')` (Nest casa literal primeiro — gotcha clássico).
- `reschedule` no service: reutilizar `existingFor` (com o filtro ampliado de D6), `findConflict`, `outbox.invalidateForAppointment`/`materializeInTx`/`enqueueJobs` exatamente como `update` faz hoje; **nenhum Redis dentro da tx**.
- A jogada `move-other` pedida no `reschedule` é **recomputada** com a carga real (D4): rodar `planRelocation` com `{ now, movedId }` e verificar que a opção esperada (`otherId` / `move-self`) está presente e extrair dela os instantes — nunca gravar horário sugerido pelo client sem revalidar (a revalidação `findConflict` in-tx cobre os dois lados).
- Web: estado novo no `useAppointmentForm` (`relocationOptions`, `relocationLoading`); o `AppointmentModal` renderiza as opções com horário **sempre com data completa** no rótulo (`formatRangeInTz` com dia — "Mover Almoço para qui 13/10, 00:30": a jogada empurra para depois da meia-noite com frequência, e omitir o "amanhã" assusta); **template-first** (vue.md); sem cálculo de data no `.vue`.
- `qk` inalterado; nenhum dado do usuário em query param (POSTs); rotas atrás de `requireAuth`/JWT guard como as demais.
- Docs no mesmo PR: **ADR-0015** (fim do `force`/invariante), `architecture-overview.md` se descrever conflito/rotas, `docs/gotchas.md` se a corrida F.2 morder, `ia-docs/plans/grades-dia-semana-mes.plan.md` marcado Etapa 0 com spec registrada.
