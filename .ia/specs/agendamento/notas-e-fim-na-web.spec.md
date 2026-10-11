# Spec — Notas que começam com "não" + fim (período multi-dia) visível na web

- Domínio: agendamento (bot) + web | Data: 2026-10-11 | Status: implementada (2026-10-11, plano `ia-docs/plans/notas-e-fim-na-web.plan.md`)
- Specs mães (não reescritas aqui, só refinadas): **`.ia/specs/agendamento/criar-compromisso-bot.spec.md`** (regra 5 — notas), **`.ia/specs/web/calendario-visoes.spec.md`** (grade/rótulos, `layoutDayTimeline`, regra B9), **`.ia/specs/agendamento/fluxo-criacao-robusto.spec.md`** (intervalo completo multi-dia — esta spec leva o fim multi-dia **para a web**, que aquela deixou fora de escopo) e **`.ia/specs/agenda/reagendamento-assistido.spec.md`** (rótulos com dia completo).
- ADRs relacionados: **ADR-002** (UTC no banco, tz na borda), **ADR-004** (regras determinísticas decidem — o parser de notas é regra pura, zero LLM), **ADR-015** (sobreposição é invariante — `findConflict` consome intervalo puro, alheio a dias). Nenhum ADR novo previsto: ambas as mudanças são aplicação de decisões já registradas.
- Pedida por: usuário (bug real de produção no smoke do bot em 10/10/2026) | Fase do roadmap: hardening pós-Fase 8

## Objetivo / dor do usuário

Dois pontos de atrito verificados em 10/10/2026: (1) ao responder a pergunta de notas com
**"Não esquecer nada na volta"**, o bot gravou o compromisso **sem nota** — a primeira palavra
"não" foi lida como negativa e a frase real foi descartada; o usuário perdeu informação que
ele mesmo ditou. (2) Um compromisso com **fim explícito em outro dia** (viagem sáb 23:00 → seg
17:00, criado pelo bot) é injetável na web **só como "duração" de 3960 minutos**: o usuário não
consegue ler nem definir "termina segunda 17:00" em nenhum lugar da web. O usuário precisa
poder dizer notas livremente (começando ou não por "não") e ler/definir o **fim** do período,
não um número de minutos absurdo.

## Diagnóstico técnico (estado atual verificado por inspeção 2026-10-11)

- **Bot**: `parseNotesAnswer` (`apps/api/src/modules/bot/messages.ts:73-78`) delega a
  `parseYesNo` (:46-55), que casa negação pela **primeira palavra** (`NO_WORDS.includes(head)`,
  :53). "não esquecer nada na volta" ⇒ `head = "nao"` ⇒ `false` ⇒ nota `null`. O passo `notas`
  da máquina (`scheduling-flow.machine.ts`, `case "notas"` :1859-1890) consome isso via
  `parseNotesAnswer` (:1880). O ramo `alter|corrige|muda` do passo `confirmacao` (:1963) usa a
  **primeira palavra** só para escolher "alterar X" do resumo — não descarta conteúdo e **não
  é o bug**; fica fora de escopo (conferido).
- **Web**: o formulário vive em `useAppointmentForm.composable.ts` com campos
  `date` + `time` (início) + `durationMinutes` (número); o `AppointmentModal.vue` renderiza só
  esses três. `toPayload` deriva `endsAt = startsAt + durationMinutes`. Um `endsAt` multi-dia
  vindo do bot entra como 3960 min e não é editável como fim. A grade Dia/Semana **já** calcula
  a altura do bloco pelo `endsAt` via `layoutDayTimeline` (`schedule-core`), e `formatRangeInTz`
  (`apps/web/src/app/utils/tz.ts:61-70`) já rótula fim que vaza o dia ("18:00–sex 09/10 00:30").

## Comportamento esperado

### A. Bot — nota que começa com "não" é nota, não negativa (regra determinística, zero LLM)

A1. **Negação isolada ⇒ sem nota**: resposta cuja forma normalizada seja **exatamente** uma
palavra de negação (`nao`, `no`, `nada`, `nenhuma`, `sem`, e os demais `NO_WORDS` de
`messages.ts`) ou sinônimo curto de "não tenho" ⇒ `notes = null` (comportamento de hoje,
regra 5 da spec mãe). Texto vazio ⇒ re-pergunta (como hoje).

A2. **Frase real começando com "não" ⇒ nota literal**: resposta normalizada que casa negação
pela primeira palavra **mas tem ≥ 4 palavras** ⇒ é frase do usuário ⇒ `notes` = **texto
integral** (ex.: "Não esquecer nada na volta" ⇒ nota literal, sem stripping além do #A4).
É a correção do bug: a decisão nunca olha só a cabeça da frase.

A3. **Limite ≥ 4 palavras é constante testável** da borda do bot (`messages.ts`, junto de
`NO_WORDS`), não regra de `schedule-core`: parsing de fala do chat não é regra de
conflito/notificação/data. A régua da decisão mora na **máquina de estados** (passo `notas`),
que passa a usar um `parseNotesAnswer` corrigido — documentado como decisão da máquina.

A4. **Não regridir**: "não"/"n" puro ⇒ `null`; "nada" ⇒ `null`; "sim" ⇒ segue o fluxo de hoje;
"anotar: levar o orçamento" ⇒ stripping de `NOTES_PREFIX_RE` ⇒ "levar o orçamento"; ruído curto
(≤ 3 chars, ambíguo) ⇒ re-pergunta (como hoje); máx. 2000 chars (`appointmentInputSchema`).

### B. Web — o formulário expõe Data + Início + **Fim**

B1. **Modal de criar/editar/corrigir** passa a exibir: **data** única, **início** (hora) e
**fim (data + hora)**. O campo `durationMinutes` deixa de ser entrada primária: a duração em
minutos continua **derivada em tempo real** (fim − início) e usada apenas como valor interno do
payload.

B2. **Edição bidirecional em tempo real**: o usuário pode editar **qualquer** par (início ou
fim); o outro se ajusta preservando o parceiro e a duração vigente —

- mudou só a **hora de início** ⇒ fim = nova hora + duração atual;
- mudou só a **data de início** (com fim já configurado) ⇒ **o form PERGUNTA** (decisão 2):
  escolha inline "manter o intervalo" (fim desliza preservando a duração — default) vs.
  "definir novo fim" (campo de fim em foco, usuário define à mão). Sem fim configurado
  (criação nova) ⇒ nada perguntar; fim derivado normalmente.
- mudou **dia e/ou hora de fim** ⇒ início intacto.
  Tudo via helpers puros de borda (`tz.ts` / composable), sem cálculo de data no `.vue` (`vue.md`).

B3. **Validação**: fim ≤ início ⇒ **erro inline** `O fim precisa ser depois do início` (message
em pt-BR no zod do form; o refine atual de `durationMinutes ≥ 5` migra para o par início/fim).
**Fim em outro dia é lícito** (multi-dia) — nenhum cap de duração no form (espelha a regra A2 da
spec `fluxo-criacao-robusto`: intervalo dito pelo usuário não tem teto de 1440 min).

B4. **Payload invariante**: o submit continua materializando `{ startsAt, endsAt }` (UTC)
validado por `appointmentInputSchema`. **Zero endpoint novo, zero migration, zero campo novo em
`contracts`.** Presets de criação (drop de drag, célula do calendário) entram convertendo para
início+duração como hoje e o fim é derivado na exibição.

### C. Web — a agenda mostra o fim multi-dia

C1. **Visões Dia/Semana**: bloco com altura correta pelo `endsAt` (já é `layoutDayTimeline` —
nada muda) e **rótulo do período** usando `formatRangeInTz` em **todos** os pontos que exibem
tempo de compromisso (grade, chip, `aria-label`, painel de detalhe). Quando o fim cai em outro
dia, o rótulo traz o dia do fim: "sáb 23:00 – seg 17:00" (estilo atual de `formatRangeInTz`; o
formato exato do traço/espaço é cosmético e não muda a regra).

C2. **Reagendamento assistido e check-conflict** continuam funcionando com fim em outro dia:
os payloads já levam `startsAt`/`endsAt` e `findConflict` é alheio a dias (ADR-015) — a feature
só **grava isso com testes** (nada de código novo de regra).

### D. Invariantes (não regredir)

D1. Nenhuma regra nova de data/conflito fora de `schedule-core`/borda `tz.ts`; aritmética de
início↔fim é formatação/conversão de borda (ADR-002). Web continua **view → composable →
service**; zod na borda (`appointmentInputSchema` + schema do form). Bot: handler fino, máquina
pura, `messages.ts` como lar das regras de fala do chat. `docs/gotchas.md` ganha a entrada do
bug A no mesmo commit do fix (regra `documentation.md` 4: "negação de cabeça engole frase").
`pnpm build && pnpm test && pnpm lint && pnpm lint:arch` verdes.

## Fora de escopo

- Fluxo base do bot (mãe), extração livre do "quando"/fim (já na `fluxo-criacao-robusto`),
  lembretes, outbox, resumo diário — **inalterados**.
- O head-regex `alter|corrige|muda` do passo `confirmacao` (inspecionado: não causa perda de
  dados; mexer nele é outra feature).
- Editor WYSIWYG/estruturado de notas (nota continua `string` simples).
- Visões Mês/Ano: chips já tratam cross-day (regra B9 da `calendario-visoes`) — sem mudança.
- Cap/validação de duração máxima, recorrência, Templates.
- Qualquer mudança na API/Prisma/`contracts`.

## Fronteiras e dados

- **Entidades/contratos tocados**: **nenhum schema novo**. `appointmentInputSchema`
  (`contracts`) continua a borda de escrita; o zod do formulário (`useAppointmentForm`) ganha
  `endDate`/`endTime` no lugar de `durationMinutes` como campos de UI (state interno do form —
  não vai ao contrato).
- **Onde mora a regra**:
  - Decisão nota-vs-negação (A1–A4): `apps/api/src/modules/bot/messages.ts`
    (`parseNotesAnswer` corrigido + constante do limite), consumida pela **máquina de estados**
    (`case "notas"`) — parsing de fala do chat, não `schedule-core` (não é regra de
    conflito/notificação/data).
  - Duração/intervalo para a grade: `schedule-core` (`layoutDayTimeline` — intocado).
  - Aritmética início↔fim e formatação multi-dia: borda web (`tz.ts` + composable), com offset
    injetável em testes (ADR-002).
  - Conflito/relocation com fim multi-dia: `schedule-core` (intocado — só testes).
- **Fronteiras de módulo**: nenhuma aresta nova (`modules/bot` e `web` já consomem
  `schedule-core`/`contracts`).

## Critérios de aceite (Gherkin)

### A — notas (vitest na máquina de estados + `messages.ts`, sem LLM)

- **Dado** o passo `notas` com um candidato **Quando** o usuário responde "Não esquecer nada na
  volta" **Então** `c.notes = "Não esquecer nada na volta"` (texto integral) **E** o fluxo segue
  para o lembrete.
- **Dado** o passo `notas` **Quando** a resposta é "não" (ou "n", "no", "nada", "nenhuma",
  "sem", sozinhas) **Então** `c.notes = null` (não regride).
- **Dado** o passo `notas` **Quando** a resposta é "sim" **Então** o comportamento é o de hoje
  (não vira nota nova nem negativa).
- **Dado** a resposta "anotar: levar o orçamento" **Então** `c.notes = "levar o orçamento"`
  (stripping `NOTES_PREFIX_RE` preservado).
- **Dado** a fronteira exata da constante: resposta casa-negação pela cabeça com **3 palavras
  normalizadas** ("não tenho nada") ⇒ `null`; com **4 palavras** ("não esquecer nada aqui") ⇒
  nota literal. Teste parametrizado na fronteira 3/4.
- **Então** nenhuma chamada de LLM ocorre na decisão de notas (regression guard da máquina).

### B — formulário (vitest do composable, `timezone`/offset injetável)

- **Dado** o modal de **edição** de um compromisso sáb 23:00 → seg 17:00 (tz do usuário)
  **Então** os campos exibem data sáb, início 23:00, fim **seg 17:00** (e não "3960 minutos").
- **Dado** o modal de **criação** com início qua 10:00 e duração default **Quando** o usuário
  edita o fim para qui 12:30 **Então** a duração derivada passa a 16h30 **E** o payload submit
  tem `endsAt = qua 10:00 + 26h30` (UTC do instante correspondente).
- **Dado** um fim igual ou anterior ao início **Então** erro inline "O fim precisa ser depois do
  início" **E** submit bloqueado **E** nenhum check-conflict é chamado.
- **Dado** o início alterado de sáb 23:00 → qua 23:00 num compromisso sáb→seg 17:00 **Então** o
  fim vira sex 17:00 (mesma duração, dias acompanhando) **E** a hora de fim preservada.
- **Dado** o payload final **Então** ele é validado por `appointmentInputSchema` com apenas
  `{ startsAt, endsAt, ... }` — nenhum campo novo (asert de contrato nos testes existentes).

### C — agenda e conflito multi-dia

- **Dado** um bloco sáb 23:00 → seg 17:00 **Quando** a visão **Dia** de segunda o renderiza
  **Então** a altura vem de `layoutDayTimeline` (comportamento vigente) **E** o rótulo/aria-label
  inclui o fim com dia ("seg … 17:00" via `formatRangeInTz`).
- **Dado** o mesmo bloco na visão **Semana** **Então** cada coluna dia o mostra como segmento do
  dia (regra B9 da `calendario-visoes`) com rótulo coerente de `formatRangeInTz`.
- **Dado** um check-conflict/relocation com `endsAt` em outro dia **Então** a resposta de choque
  e as opções de jogada continuam válidas (rótulo do existing com dia completo) — testes de
  payload; zero mudança de regra.

### Arquitetura/regressão

- **Então** `pnpm lint:arch` verde **E** nenhum `.vue` faz aritmética de data **E** os testes da
  spec mãe (notas "não"→null, "anotar:"→strip) continuam passando **E** `docs/gotchas.md` tem a
  entrada do bug A.

## Decisões (aprovadas pela spec-writer — escolhas óbvias, refutam nada)

| #   | Decisão                         | Escolhida                                                                                                                                                                                                         |
| --- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Onde corrigir o parser de notas | Em `parseNotesAnswer`/`messages.ts` (borda do bot), **não** em `parseYesNo` — este continua sendo o sim/não puro usado pelos demais passos (confirmar/alterar, conflito), que **devem** manter a cabeça de frase. |
| 2   | Fronteira "frase real"          | ≥ **4 palavras** normalizadas (constante testável em `messages.ts`), conforme pedido; casos-limite documentados nos testes.                                                                                       |
| 3   | Nota de frase multi-palavra     | Texto **integral**, sem stripping além de `NOTES_PREFIX_RE`; sem LLM de "limpeza" (ADR-004).                                                                                                                      |
| 4   | Modelo de campos do form        | **data única + início + fim(data+hora)** (pedido do humano), em vez de dois pares independentes; duração some como entrada, sobrevive derivada.                                                                   |
| 5   | Sem API/migration               | `{ startsAt, endsAt }` invariante; form state novo é interno.                                                                                                                                                     |
| 6   | Rótulo multi-dia                | Reaproveitar `formatRangeInTz` (já trata fim vazando o dia); cosmética do separador livre, regra é "dia do fim visível".                                                                                          |
| 7   | Head-regex `confirmacao`        | Fora de escopo (inspecionado: não perde dado; só escolhe item do "alterar").                                                                                                                                      |
| 8   | Sem ADR novo                    | Ambas as mudanças aplicam ADR-002/004/015; nada de não-óbvio a registrar além do gotcha.                                                                                                                          |

## Aberto (decisões de produto)

| #   | Pergunta                                                                                                                              | Opções                                                                                                                         | Decisão humana (2026-10-11)                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Um "não" de 2–3 palavras que claramente começa frase ("não tenho nada", "não anota nada") — ainda é negativa ou vira nota literal?    | (a) ≤ 3 palavras casa-negação ⇒ sempre `null`; (b) lista fechada de exceções ("não tenho", "não anota") ⇒ `null`, resto ⇒ nota | **(a)** ≥4 palavras ⇒ nota literal; ≤3 palavras começando com negação ⇒ sem nota                                                                                                                                                                                              |
| 2   | Ao editar **só a data de início** de um compromisso multi-dia, o fim **segue os dias** (preserva duração) ou **trava** a data de fim? | (a) segue (duração preservada); (b) trava fim                                                                                  | **(c) perguntar**: movido o início com fim já configurado, o form exibe uma escolha — "manter o intervalo (recalcula o fim a partir do novo início)" vs. "definir novo fim". Default = manter intervalo. Sem fim configurado ⇒ nada perguntar. B2 abaixo reflete esta decisão |
