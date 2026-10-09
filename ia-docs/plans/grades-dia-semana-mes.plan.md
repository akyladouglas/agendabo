# Plano — Fase 8: Reagendamento Assistido + Grades Dia/Semana/Mês + Drag-and-drop

> **Fase única** (aprovação humana em 2026-10-08): o drag não existe sem as
> grades, e soltar em conflito não existe sem o Reagendamento Assistido.
> Ordem: **Etapa 0 (regra de conflito sem override) → Etapa 1 (grades) →
> Etapa 2 (drag)**. Cada etapa com portão de gates.
> **Status: aguardando aprovação deste plano atualizado.**
> Regras: `schedule-core.md` (regras puras com TDD), `vue.md`, `testing.md`,
> invariantes do AGENTS.md. `@vue/test-utils` disponível.

## 0. Decisões de produto (humanas, já respondidas)

- **Sobreposição é invariante do produto**: o app **nunca** deixa dois
  compromissos sobrepostos — o antigo "confirmar = força" do form da web está
  **revogado** (decisão humana 2026-10-08). Em qualquer fronteira (form da
  web, drag, bot): detectar conflito → perguntar **qual dos dois muda**;
  resolver movendo os dois em cascata → **não permite salvar** e explica.
- **Drag com conflito**: soltar em horário que conflita → **Reagendamento
  Assistido**: o diálogo mostra os envolvidos e oferece mover **o existente**
  ou **o movido** (ou ambos em cascata — não permitido → não salva). Regra
  pura no `schedule-core` (TDD). `force` sai do `CreateAppointmentInput` e
  `UpdateAppointmentInput` (contracts + API; a API passa a **rejeitar sempre**
  em conflito).
- **Mês**: células não têm hora → o drag muda **só a data**, preservando a
  hora original; depois o usuário **pode (e deve) clicar no bloco** para
  ajustar a hora pelo modal de edição — fluxo garantido na spec.
- **Toque desde o início**: Pointer Events + `touch-action` controlado nas
  células (arrastar o bloco move o compromisso; arrastar o fundo da grade
  continua rolando a página).

## Etapa 0 — Reagendamento Assistido (regra de conflito sem override)

_(entra antes das grades: o drag depende dela; o form da web também passa a
usá-la — remove o `force`)_

### 0.1 `schedule-core` (TDD primeiro)

- **`planRelocation(candidate, existing[], movedId?)`** → dado o movimento
  desejado e os conflitos, retorna as **resoluções possíveis**:
  - `{ kind: 'move-other', other, newStart, newEnd }` — empurra o existente
    para depois (preservando duração; primeiro slot livre ≥ fim do movido);
  - `{ kind: 'move-self', newStart, newEnd }` — move o arrastado para o
    primeiro slot livre a partir do destino;
  - `{ kind: 'impossible' }` — quando mover um dos dois cria novo conflito com
    terceiros, ou ambos precisariam se mover (cascata) → **UI não salva**.
  - Múltiplas opções encadeadas (o existente também conflita mais adiante →
    apresenta mover o segundo, etc.) na versão inicial: **uma jogada por vez**,
    recomeçando o plan após cada movimento (simples e determinístico).
- Testes: sem conflito → `{kind:'ok'}`; conflito simples → move-outro e
  move-self válidos; ambos ocupados até o fim do dia → `impossible`;
  cascata (mover A esbarra em C) → opções só para A/C na jogada.

### 0.2 API

- `PATCH /appointments/reschedule` — `{ movedId, otherId?, newStart, newEnd }`
  (zod nos contracts): transação Prisma que atualiza os dois lados e
  revalida `findConflict` contra o resto **dentro da transação**; conflito
  restante → 409. Respostas/notificações/lembretes reagenda os jobs afetados
  (reuso do `NotificationSchedulerService`).
- `POST` e `PATCH` de compromisso passam a **rejeitar sempre** em conflito
  (409 como já é no create; no update o `force` some). `force` removido dos
  schemas de entrada.
- Testes: jest da regra do service + e2e do 409 e da transação dupla.

### 0.3 Web

- `AppointmentModal` deixa de oferecer "Criar mesmo assim": ao detectar
  conflito chama `planRelocation` e mostra as opções (**Mover existente para
  16:00** / **Criar em 16:00** / Cancelar) — mesmo padrão visual que o drag
  usará. Idem para edição. ✅ (2026-10-08: seção "Reagendamento Assistido"
  inline em `AppointmentModal`; rótulos com dia completo no tz do usuário;
  estado da seção em `useAppointmentForm` — zero cálculo no `.vue`)
- Novo `useRescheduleMutation` (chama `PATCH /appointments/reschedule`,
  invalida agenda + review, toast "Reagendado para ..."). ✅ (2026-10-08:
  rota real é `POST /appointments/reschedule`; + `useRelocationOptionsMutation`
  e `appointmentsApi.relocationOptions/reschedule`; testes em
  `apps/web/tests/appointment-relocation.spec.ts`)
- Bot inalterado (pergunta por texto; mesma regra passa a servir de verdade).

### Gate parcial 0

`pnpm build && pnpm test && pnpm lint && pnpm lint:arch` + smoke: criar com
conflito → diálogo oferece mover o outro → confirmar move os **dois** no
calendário; opção impossível → mensagem e nada salvo.

**FEITO (2026-10-09)** — gates verdes (549 testes) + smoke E2E real: API
(create+move-other atômico, edit+move-other, 409 stale D4 sem escrever, 409
blocked com `conflictWith`, `force` ignorado no PATCH, outbox re-materializado
com zero sobreposições no banco) e browser (modal "Reagendamento Assistido" →
"Mover DENTISTA-SMOKE" gravou os dois lados atomicamente). Bug pego pelo smoke:
409 handler faltante em relocation-options/PATCH → gotcha #15 + teste de
regressão.

> **Nota de sequenciamento**: ao remover o `force`, o fluxo de conflito do
> form da web passa a existir de verdade (antes da Etapa 0 o modal não tinha
> ação nenhuma em 409 — bug C.11 aberto). A Etapa 0 já **fecha C.11** de
> brinde.

## Etapa 1 — Grades Dia/Semana/Mês (datas e horas explícitas)

### 1.1 `schedule-core` (TDD primeiro)

- **`hourGrid(dayRange, now?)`** → célula por hora coberta pela range do dia
  (UTC): `{ hourUtc, label }`.
- **`layoutDayTimeline(items, dayStart, dayEnd, offsetMin)`** → posição em %:
  - âncora = **hora de início local** (compromisso de 23h começa na linha das
    23h local, atravessando a meia-noite visualmente);
  - altura ∝ duração (clampada à grade);
  - sobrepostos lado a lado (algoritmo de colunas guloso já usado nos backlogs
    de conflito);
  - `isPast` por célula (agora passa daquela hora).
- Testes: meia-noite, travessia de dia, sobreposição 2/3 itens, offset ≠ 0.

### 1.2 Web — correções de datas (Mês/Semana)

- `MonthGrid.vue` / `WeekGrid.vue`: número do dia **sempre visível** (remover
  `hidden md:`).

### 1.3 Web — Visão Dia com grade

- `DayGrid.vue` (burda): coluna de 24 linhas `data-testid="day-slot-HH"`,
  hora local; overlay dos blocos com top/height % de `layoutDayTimeline`;
  título+horário dentro do bloco; vazio → `EmptyState`; **lista do dia
  continua abaixo** (notações/anexos legíveis).
- Celula vazia → cria compromisso **naquele dia e hora** (`presetDate` passa a
  levar hora; `AppointmentModal`/`useAppointmentForm` já aceitam start ISO —
  só preencher com `:00`).
- `useAgendaPage.composable`: expor `dayTimeline` (layout prático a partir de
  `groupByLocalDay` + `layoutDayTimeline`).
- `AgendaPage.vue`: `bodyKind === 'day'` renderiza DayGrid.
- Sem mudança de API. Celular: lista (grade é desktop; mesma política atual).

### Gate parcial 1

`pnpm build && pnpm test && pnpm lint && pnpm lint:arch` + smoke browser
(números visíveis em viewport estreito; 24 linhas; clicar 14:00 → modal
14:00; bloco 23h-0h posicionado às 23h).

**FEITO (2026-10-09)** — gates verdes (schedule-core 165 testes: +19 novos
de `hourGrid`/`layoutDayTimeline`; web 85: +9 de `day-grid.spec`; build/lint/
lint:arch ok). TDD red-green em `hourGrid.spec.ts`/`layoutDayTimeline.spec.ts`
(meia-noite local, travessia de dia, sobreposição 2/3, offset ≠ 0). Web: dia
SEMPRE visível no Mês/Semana (regressão em `day-grid.spec`), `DayGrid.vue` burra
(linhas `hourGrid` + blocos `layoutDayTimeline` via `useAgendaPage`), célula vazia
→ criar dia+hora (preset agora leva `hour`), bloco → detalhes; lista do dia
continua abaixo. Smoke browser FEITO: viewport estreito (navegação pelo menu,
números do Mês/Semana no DOM sem `hidden`), 24 linhas, clique 14:00 → modal
14:00, sobrepostos 11:00–12:30/11:30–12:00 lado a lado 50% com top/height
corretos, bloco → detalhes com Excluir/Editar. Bug pego no smoke: dev server
servindo módulo transformado sem o head → gotcha #17.

## Etapa 2 — Drag-and-drop de compromissos

### 2.1 Mecânica (sem lib nova — decisão a registrar como ADR-0014)

radix-vue 1.19 **não** expõe drag-and-drop; HTML5 DnD não funciona em toque.
Implementar com **Pointer Events** (unifica mouse+toque), hook próprio:

- `useDragAppointment(onDrop)` na AgendaPage/composable:
  - `pointerdown` no bloco → `setPointerCapture`; movimento acima de ~4px vira
    drag (abaixo disso = clique normal → abre edição);
  - `touch-action: none` **só no bloco arrastável** (fundo da grade mantém
    scroll);
  - overlay fantasma segue o ponteiro; **célula-alvo** destacada via hit-test
    (`document.elementFromPoint` / registry de células por `data-cell-key`);
  - `pointerup` na célula de origem → no-op; fora de qualquer célula → cancela
    (volta ao lugar, sem mutação);
  - ESC durante o drag cancela.
- Alvos por visão: **Dia** = células de hora (mesmo dia); **Semana** = célula
  (dia × hora); **Mês** = célula-dia (sem hora).
- Preview de destino durante o arrasto mostra o novo horário ("→ qui 18:00").

### 2.2 Alvo = cálculo determinístico (schedule-core, TDD)

- Reaproveitar `hourGrid`/`layoutDayTimeline`: a célula sob o ponteiro dá o
  offset de deslocamento; o **novo intervalo** é o antigo transladado
  (mesma duração) — nada de recalcular duração no front.
- Testes de regras: transladação preserva duração; drag no mês muda só a data
  preservando hora local; drag que atravessa meia-noite mantém 24h; drag pra
  célula conflituosa → `hasConflict` verdadeiro (a UI abre o diálogo).

### 2.3 Fluxo ao soltar (AgendaPage)

1. Calcula novo intervalo (regra pura: transladação, mesma duração).
2. `check-conflicts` para o novo intervalo (cacheado, `ignoreId` = movido).
3. **Sem conflito** → `PATCH /appointments/reschedule` (ou `update` quando só
   um lado muda) → toast "Reagendado para ..." → invalida agenda.
4. **Com conflito** → abre o **Reagendamento Assistido** (Etapa 0) já
   preenchido: opções "Mover o existente para <hora>", "Mover o que estou
   arrastando para <hora>" ou, quando a jogada é `impossible`, explica e
   **não salva**. Confirmar = `reschedule` transacional (move os dois);
   cancelar = nada muda (bloco volta ao lugar).
5. Erro da mutação → toast de erro, bloco volta à posição original (rollback
   visual: **sem optimistic update** — a posição só muda após o server
   confirmar; mantém o cache como fonte da verdade).

### 2.4 Acessibilidade

- Drag de mouse/toque é opcional: cada bloco mantém clique → modal de edição
  (alterar data/hora por campos) — caminho equivalente para teclado/leitores
  de tela. `aria-label` dos blocos anuncia data/hora atual.
- `aria-live` anuncia "Reagendado para <data hora>" após soltar.

### 2.5 Testes

- `useDragAppointment` (unit, jsdom/happy-dom): threshold de 4px, cancel por
  ESC, drop na origem = no-op, drop fora = cancel.
- `schedule-core`: transladação + `planRelocation` no drop (TDD; soma-se aos
  testes da Etapa 0).
- Views: soltar bloco em célula dispara callback com o novo intervalo
  (testid das células já existente).
- Mês: soltar em outra célula muda a data mantendo a hora; o bloco continua
  clicável → modal de edição abre com os horários atuais (garante o ajuste de
  hora posterior — requisito humano explícito).
- E2E browser: arrastar bloco 14–15h → célula 18h salva; arrastar sobre outro
  → Reagendamento Assistido abre; "mover o existente" move os dois; cancelar
  restaura; drag no mês muda a data e o clique no bloco abre a edição.

## Arquivos

- **Novos**: `DayGrid.vue`, `useDragAppointment.ts`, `tests/drag-appointment.spec.ts`, `useRescheduleMutation.ts`, `RescheduleDialog` (o Reagendamento Assistido), ADR-0014 (Pointer Events sem lib) + ADR-0015 (fim do `force`/sobreposição invariante), spec `.ia/specs/agenda/reagendamento-assistido.spec.md` (Etapa 0) + `.ia/specs/web/grades-drag-agenda.spec.md` (Etapas 1–2, pré-código)
- **Editados**: `MonthGrid.vue`, `WeekGrid.vue`, `AgendaPage.vue`, `useAgendaPage.composable.ts`, `useAppointmentForm.ts` (preset com hora + remove force), `AppointmentModal.vue` (preset hora + opções de reagendamento), `calendar.ts`+`index.ts` (schedule-core), `appointments.controller/service` (reschedule + remove force), `agenda.service.ts` (conflitos no range do dia), `packages/contracts` (schemas sem `force` + reschedule), specs/README, `docs/gotchas.md` se necessário

## Definition of Done

Gates verdes + spec/planos registrados + ADR-0014 + deparo humano.

## Fora de escopo

Redimensionar bloco (mudar duração arrastando a base) — backlog; drag na
Lista; recorrência/lixeira; Fases 6 residual/9; mensagens de erro da web.
