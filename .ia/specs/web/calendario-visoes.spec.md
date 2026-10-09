# Spec — Calendário da agenda: visões mês / semana / dia / ano

- Domínio: web (consome agendamento) | Data: 2026-10-08 | Status: **implementada (etapa de código 2026-10-08: web + schedule-core verdes — 11/11 calendar-views, 61/61 web, 127/127 schedule-core; ADR-0013, gates globais e smoke E2e pendentes, ver `ia-docs/plans/fase-7-calendario-visoes.plan.md`)**. Aprovada em 2026-10-08 (humano aprovou os defaults da tabela Aberto: semana em domingo, densidade do Ano por dia com compromisso, mês mobile com bolinhas, ir-para-data só menu, hora 09:00 ao criar, trocar mês ancora no dia 1)
- ADRs relacionados: **ADR-002** (UTC no banco + timezone do usuário na borda — todas as grades nascem daqui), **ADR-004** (regras decidem: a web **mostra** conflito calculado por `schedule-core`, nunca decide), **ADR-005** (web consome `schedule-core` via alias de fonte). **Nenhum ADR vigente é contrariado.** Novo ADR sugerido: **ADR-0013 — "Sem lib de calendário; grade própria com regra pura no `schedule-core`"** (ver F.7; registrar antes de codar).
- Pedida por: usuário (Fase 7 do roadmap PROMPT.md: "Web — agenda: calendário (mês/semana/dia/ano) + tela de revisão") | Fase do roadmap: **7**
- Estado acoplado (não re-descrito aqui): a **tela de revisão já existe e está completa** (Fase 5, commit `05d71c7`; spec `.ia/specs/web/calendario-perfil-revisao-web.spec.md`) — **não há trabalho de revisão nesta fase**. `/agenda` vigente = abas **Dia | Semana** em lista (`AgendaPage.vue`), modal único `AppointmentModal` + `useAppointmentForm` (criar/editar, `check-conflict`, 409), detalhes com excluir em 2 passos, queries `useAppointmentsQuery(from,to)` com `qk.appointments(from,to)`, helpers de fuso em `app/utils/tz.ts` + `schedule-core/dates.ts` (`userDayRange`, `shiftDayRange`, `userWeekRange`, `shiftWeekRange`, **`userMonthRange`, `userYearRange`, `shiftWeekRange` já prontos**), API `GET /appointments?from=&to=` (`listAppointmentsQuerySchema`, zod `z.coerce.date()`) com filtro **`startsAt >= from AND endsAt <= to` (contenção)** — confirmado por inspeção de `appointments.service.ts`.

## Objetivo / dor do usuário

O PROMPT.md (3.4) pede calendário com visões **mês, semana, dia e ano**; a Fase 5 entregou dia+semana em lista (decisão D1, "mês/ano crescem depois sem quebrar") e o mês/ano seguem devidos. O usuário quer abrir a web no celular e ter o panorama do calendário: bater o olho no **mês** e ver onde a semana está lotada, entrar na **semana** em colunas, detalhar o **dia**, e ver o **ano** inteiro como mapa de densidade. Esta fase fecha o 3.4 sem tocar em nada do resto da web.

## Comportamento esperado

### A. Visões e navegação

1. A página `/agenda` ganha **quatro visões: Mês | Semana | Dia | Ano** (tabs, mesma `AppTabs` de hoje) com a navegação `← hoje →` que já existe. Os termos do glossário mandam nos dados (compromisso, dia civil do usuário, revisão); "calendário/visão" é vocabulário novo de UI apenas.
2. **Visão padrão por viewport** (mantém o comportamento vigente, estendido): `<md` abre em **Dia**; `≥md` abre em **Semana**. **Mês nunca é padrão no mobile.** Trocar de visão mantém a **âncora** (o dia focado) — ir para "Mês" mostra o mês que contém o dia que estava aberto; "Ano" mostra o ano que contém a âncora.
3. **Navegação `← hoje →` por visão**: Dia ±1 dia local, Semana ±1 semana local (`shiftWeekRange`), **Mês ±1 mês civil** (novo `shiftMonthRange` no `schedule-core`, ver E.1), **Ano ±1 ano civil** (novo `shiftYearRange`, análogo a `userNextYearRange`). Botão **Hoje** devolve a âncora a `now` e marca hoje nas grades.
4. **Deep-link de data (estado interno, não URL)**: o estado `{visão, âncora}` vive **no componente** (hoje: `ref` `view`/`anchor`), não na URL. **Nenhum par `?view=&date=`** — ver decisão D6 para a discussão (a data isolada até poderia, mas o padrão do repo é não pôr estado de navegação de dados na URL; o custo/benefício não paga). Consequência aceita: compartilhar link ≠ compartilhar a data aberta; entrar em `/agenda` = hoje na visão padrão.
5. **Deep-link "ir para data"**: controle discreto (menu `Ano` + `Mês` no cabeçalho, radix-vue `Select`/`Popover`) troca de ano/mês direto; pular para um **dia** específico é pelo clique na grade do mês. Sem input de data livre nesta fase (Aberto #4).

### B. Visão Mês (a grade nova)

6. Grade de **7 colunas** (domingo a sábado — mesma numeração usada por `userWeekRange`/`formatDayHeading`), linhas de **4 a 6 semanas** cobrindo **todo o mês civil**: as células dos meses vizinhos que aparecem na grade (leading/trailing) vêm **preenchidas com os compromissos reais daqueles dias** (a query busca o período estendido da grade, B.8) e aparecem esmaecidas, mas **clicáveis**.
7. Cada célula mostra: número do dia (destaque "hoje"), e até **3 chips** de compromisso (`HH:mm` + título truncado, `needs_review` com ⚠️ como na lista) + overflow `+N` ("ver N"). Clique na célula (vazia ou no `+N`) abre a visão **Dia** daquele dia; clique no **chip** abre os **detalhes do compromisso** (mesmo painel `AppDialog` da lista: editar/excluir). Célula com compromisso em **conflito** ganha **borda `--danger`** com legenda acessível (ver C.12).
8. **Período da query do mês** = do início da **primeira semana** que toca o mês até o fim da **última** (máx. 6×7 dias). Como `userMonthRange` dá o mês civil e o alinhamento à semana é regra pura, nasce em `schedule-core` `monthGridRange(date, offsetMinutes)` (E.1). Célula → dia → compromissos = agrupamento determinístico (E.2).
9. Compromisso que **cruza a meia-noite** local aparece **nos dois dias** como chip contínuo (prefixo/sufixo `↦`/`↤`), coerente com `formatRangeInTz`, que já trata fim vazando o dia.

### C. Visões Semana, Dia e Ano

10. **Semana**: mantém as **7 colunas de cards** atuais (decisão D2 da Fase 5 — sem eixo de horas), agora com os compromissos **agrupados por dia via E.2** em vez do filtro inline `startsAt >= start && < end` do componente (que fica **errado para compromissos que cruzam a meia-noite** — ver E.4), clique no dia do cabeçalho → visão Dia, e o chip de conflito C.12. Navegação igual (semana a semana).
11. **Dia**: permanece a **lista do dia civil** vigente (zero mudança de comportamento), exceto: abre via clique nas outras visões mantendo a âncora, e ganha o chip de conflito C.12.
12. **Conflito visível**: a web monta, a partir **só dos itens carregados do período**, o conjunto de ids em conflito com o par determinístico **`overlaps` de `schedule-core`** (encostado não conta; a lista da API usa contenção, logo um conflitante que **começa no período mas termina depois** pode faltar — limitação aceita e declarada: o badge é **informativo**, a criação/edição continua checando de verdade via `check-conflict`/409). Dois ou mais comprometos sobrepostos `confirmed` entre si ⇒ chip/célula com **borda `--danger`** + `title`/`aria-label` "Choque com ‹título› (HH:mm–HH:mm no tz)". `needs_review` mantém ⚠️ (sinal independente).
13. **Visão Ano — grade de 12 mini-meses** (3×4 no desktop, 2×6 no tablet, **lista vertical de 12 linhas** no mobile, R.16): cada mini-mês mostra nome+ano e até **7 bolinhas**, uma por **dia civil com ≥1 compromisso não-cancelado** (densidade por **dias com compromisso**, não contagem — Aberto #2), esmaecimento maior para mais dias, bolinha de hoje destacada, e **clicar num mini-mês aprofunda → visão Mês** daquele mês. Clique num dia da linha mobile → visão Dia. Navegação `← hoje →` troca o ano.

### D. Dados, estados e criação

14. **Uma query `GET /appointments` por período visível** (`useAppointmentsQuery` existente, chave `qk.appointments(from,to)` por período; cache TanStack por período = voltar de trás é instantâneo). **Nenhum endpoint novo**: o período do mês é ~6 semanas e o do ano é end-to-end, ambos válidos no zod atual (`z.coerce.date()`) — **a API não precisa de mudanças** (confirmado no controller/service). Os **serviços/queries de revisão permanecem intactos** — nada nesta fase toca `/review` nem `useReview.query`.
15. **Estados por visão**: skeleton próprio por visão (grade pulsando, não 3 listas), bloco de erro com "Tentar de novo", vazio textual próprio ("Nada neste mês." / "Nada neste ano.") — padrão vue.md #8 da Fase 5. **Ano**: 1 query do ano inteiro (≤ ~500 compromissos — ver F.6), com skeleton de 12 mini-meses; sem heurística de prefetch. **Ajuste do smoke E2E (2026-10-08):** em **Mês/Ano** o vazio textual NÃO engole a grade — a grade sempre renderiza (ela é o alvo de clique para criar em dia livre, B.7); "Nada neste mês./ano." aparece como **aviso discreto acima da grade vazia**, nunca no lugar dela. Vazio textual puro só em Dia/Semana.
16. **Criar a partir do calendário**: clique no **espaço vazio** da célula do mês / do card-dia da semana / do cabeçalho do dia → abre o **`AppointmentModal` existente em modo criar** (`useAppointmentForm`, reaproveitado integralmente — nenhuma regra nova de form) com a **data da célula pré-preenchida** (hora default 09:00 local — Aberto #5). Clique em compromisso → detalhes/editação existentes. Mutações invalidam `qk.appointments` como hoje ⇒ a grade atualiza sem recarregar.

### E. Regra pura (onde mora e como se testa)

E.1. **Novas funções em `schedule-core` (`dates.ts`, pureza total, `offsetMinutes` injetável, zero I/O — ADR-002/`schedule-core.md`)**: `monthGridRange(date, offsetMinutes)` (período alinhado às semanas do mês civil), `shiftMonthRange(date, offsetMinutes, n)` e `shiftYearRange(date, offsetMinutes, n)` (navegação mês/ano, transborda ano naturalmente como `shiftDayRange`). Reuso integral de `userMonthRange`/`userYearRange`/`userWeekRange`/`shiftWeekRange` que já existem.

E.2. **Celulas da grade = regra pura nova em `schedule-core` (arquivo `calendar.ts`)**, porque celularidade com mês vizinho, virada de semana e cruzamento de meia-noite é regra de data (regra zero: conflito/notificação/**data** = `schedule-core`):

- `buildMonthCells(grid: { start, end }, offsetMinutes)` → lista de células `{ dateKey (YYYY-MM-DD local), utcStart, utcEnd, isCurrentMonth }`. O "hoje" **não** entra na célula (precisa de `now`): a web deriva `todayKey = toLocalDateString(now, tz)` — formatação de borda existente — ou a função recebe `now` opcional explícito.
- `buildWeekCells(weekStart, offsetMinutes)` → 7 células idênticas.
- `groupByLocalDay(items, offsetMinutes)` → `Map<dateKey, items[]>`: compromisso entra em **todos os dias civis que ele toca** (meia-noite local incluída como toque: `startsAt < diaFim && endsAt > diaInicio`), ordenado por `startsAt`. É a função que corrige o filtro inline atual (C.10).
- `dayDensity(items, range, offsetMinutes)` → `Map<dateKey, count>` (ou booleano "tem dia") para a visão Ano.

E.3. **Testes obrigatórios (vitest, `now`/offset sempre injetáveis — testing.md)**, casos mínimos: célula leading/trailing de mês vizinho; mês que precisa de 6 linhas (ex. `31/10/2025` numa grade dom–sáb); fevereiro em **ano bissexto** (29 dias) e não bissexto; **DST `America/Sao_Paulo`**: mês/semana que atravessa a transição (grade não pode repetir nem pular um `dateKey` — a limitação do modelo de offset único está em E.6); virada de semana na fronteira do mês; compromisso **cruzando a meia-noite** aparece nos dois `dateKey`s; `groupByLocalDay` com item 23:50–00:10; `monthGridRange`/`shiftMonthRange` transbordando dezembro→janeiro; densidade do ano com dia duplo contando **1**; `now` no dia 1 e no dia 31.

E.4. **A web consome apenas** (vue.md #6/#7): as funções de E.1/E.2 via alias de fonte, `measureTzOffset`/formatação existentes, queries em `app/composables/`. O componente monta células e renderiza; **zero cálculo de data/conflito em `.vue`** (o filtro inline de `AgendaPage.vue:394` sai de cena em favor de `groupByLocalDay`).

E.5. **Fronteiras de código**: `packages/schedule-core/src/calendar.ts` (+ `calendar.spec.ts`) → `packages/schedule-core/src/index.ts`; `apps/web/src/view/pages/agenda/` ganha `MonthGrid.vue`, `WeekGrid.vue`, `YearGrid.vue`, `CalendarCell.vue` (componentes burros, props tipadas) e `useAgendaPage.composable.ts` extrai a lógica da página (que passará de ~150 linhas — vue.md).

E.6. **Limitação assumida (declarada, não escondida)**: o modelo de **offset único por período** (o mesmo da Fase 5 com `measureTzOffset(tz, anchor)`) pode deslocar uma célula ao atravessar uma transição de DST dentro do período (mês/ano). Para grades visuais isso é tolerável (o período UTC coberto continua ampla; nenhum **compromisso** é perdido: a célula errante é decorativa, e a query cobre o período inteiro com folga). Se um dia isso doer, a correção é grade por-dia com offset por-dia — regra nova em `schedule-core`, não ADR novo. Registrar em `docs/gotchas.md` se aparecer na prática.

### F. Transversal

F.7. **Sem lib externa de calendário** (fullcalendar, v-calendar etc.) — grade própria com regra pura testada: a regra já é exigida em `schedule-core` (regra zero), libs trazem tz própria que brigaria com ADR-002, peso no bundle e estilo contra os tokens do design system. **Sugestão de ADR-0013** registrando a decisão e o motivo (é decisão que a próxima sessão de IA re-ergueria errado).

F.8. **Visual**: zero design novo — tokens de `styles/main.css` (`--surface`, `--border`, `--danger`, `--warning`), tema escuro default + claro (Fase 5), tipografia/horários `tabular-nums`, raios/espaçamentos do design system, movimento 150/220ms respeitando `prefers-reduced-motion`. Célula hoje = anel `--primary`; dias fora do mês = `--text-muted`; passada = esmaecida (padrão A.3 da Fase 5).

F.9. **Responsivo** (breakpoints Tailwind v4 `sm 640 / md 768 / lg 1024 / xl 1280`; viewports 360×640 / 768×1024 / ≥1280):

| Visão  | ≥`md`                                                     | `<md` (mobile)                                                                                    |
| ------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Mês    | grade 7 colunas, altura fixa por linha, `+N`              | **compacta**: 7 colunas com bolinha de densidade + `n` (sem chips), overflow por toque abre o Dia |
| Semana | 7 colunas atuais (scroll horizontal **contido na grade**) | **lista vertical de 7 dias** (cabeçalho do dia + cards empilhados) — R.16                         |
| Dia    | lista atual                                               | lista atual (já mobile-first)                                                                     |
| Ano    | 3×4 mini-meses                                            | lista vertical de 12 linhas (mês + bolinhas)                                                      |

Em nenhum viewport pode haver scroll **horizontal de página** (scroll da grade da semana é contido, como hoje). Alvos de toque ≥44px: a célula do mês inteiro é alvo (abre o dia); no mobile o chip abre detalhes só por toque direto com área ≥44 (senão a célula ganha).

F.10. **Performance**: uma query por período visível; período do ano ≈ 366 dias ≈ centenas de itens — **aceito** (payload estimado < ~500 KB, `pageSize` não existe na API e não é necessário; se um usuário estourar ~500 itens/ano na prática, paginação = feature futura). TanStack cacheia por chave de período; navegação `←→` não refaz o que já foi visitado; grades derivadas em `computed` (re-render só de célula tocada pelo diff do Vue); sem virtualização (6×7 = 42 células, 12 mini-meses — escala trivial). **Sem debounce/refetch em loop**: query só muda quando `{from,to}` muda.

F.11. **A11y**: grade do mês/semana como tabela semântica ou `role="grid"` com navegação por setas, célula/foco por dia, `aria-label` "8 de outubro, 3 compromissos, hoje"; chip de conflito com texto acessível (não só cor — daltônico); mini-meses do ano com `aria-label` "novembro: 5 dias com compromissos"; tabs com `aria` da `AppTabs`.

## Fronteiras e dados

- **Entidades/contratos tocados**:
  - `contracts/api/appointments.ts` — `listAppointmentsQuerySchema`/`appointmentListResultSchema` **consumidos como estão** (zero schema novo; `from`/`to` aceitam any ISO instant).
  - `appointments.service.ts` `list` — **zero mudança** (a contenção `startsAt>=from AND endsAt<=to` cobre todo período pedido; ver limitação de badge em C.12).
  - `schedule-core`: `dates.ts` (3 funções novas) + `calendar.ts` novo (células/agrupamento/densidade) — exportados no `index.ts`.
  - Prisma/auth/review/notifications/bot: **intocados**.
- **Onde mora a regra**: geração de células, períodos mês/ano, agrupamento por dia civil e detecção de par sobreposto (`overlaps` existente) ⇒ **`schedule-core`** (E.1/E.2, data = regra zero). Decisão de conflito persistida/materialização ⇒ **API** (existente). Web: composição, formatação e navegação — `useAgendaPage.composable.ts` segura `{view, anchor}` e deriva `{from,to}`; `qk` inalterado.

## Critérios de aceite (Gherkin)

### Regra pura (vitest no `schedule-core`, `now`/offset injetáveis)

- **Dado** `2026-10-08` com offset `-180` **Quando** `monthGridRange` **Então** o período começa na **domingo** 00:00 local ≤ 01/10 e termina no sábado 00:00 local ≥ 01/11, em 5 linhas **E** `buildMonthCells` devolve `5×7` células com `dateKey`s **únicos e consecutivos**.
- **Dado** um mês que precisa de 6 linhas **Então** `monthGridRange` cobre a 6ª semana **E** `isCurrentMonth=false` nas células de novembro.
- **Dado** fevereiro/2028 (bissexto) **Então** a última célula da grade ≤ 04/03 **E** o `dateKey` `2028-02-29` existe.
- **Dado** uma semana que atravessa a transição de DST `America/Sao_Paulo` **Então** os 7 `dateKey`s são consecutivos sem repetição (modelo de offset único — E.6).
- **Dado** um compromisso `23:50→00:10` local **Quando** `groupByLocalDay` **Então** ele aparece nos **dois** `dateKey`s.
- **Dado** `shiftMonthRange(2026-12-15, -180, +1)` **Então** o range é o de **janeiro/2027**; `shiftYearRange(2026-06-01, -180, -1)` ⇒ ano civil **2025**.
- **Dado** dois compromissos sobrepostos `confirmed` e dois encostados **Então** só os sobrepostos aparecem no conjunto de ids em conflito (usando `overlaps`, encostado **não**).
- **Dado** 3 dias com compromissos e 1 dia com 2 **Então** `dayDensity` marca **3 dias** (não 4).

### Navegação e visões (vitest do composable + smoke manual)

- **Dado** usuário com `America/Sao_Paulo` **Quando** abre `/agenda` em ≥`md` **Então** a visão é **Semana** e `<md` é **Dia** (mantém vigente).
- **Dado** que ele está no Dia `15/03` **Quando** troca para Mês **Então** a grade mostra **março** com 15 destacado; ao trocar para Ano **Então** 2026.
- **Dado** visão Mês em outubro **Quando** clicar em `→` **Então** a query seguinte usa `from/to` de **novembro alinhado às semanas** (teste do composable com `now` fixo, asserting `qk.appointments(from,to)`).
- **Dado** visão Ano **Quando** clicar no mini-mês de julho **Então** abre a visão **Mês de julho** (uma nova query de período).
- **Dado** URL `/agenda` **Então** nenhuma query string de navegação é lida/escrita (estado interno — D6).

### Interação

- **Dado** célula do dia 22 com 4 compromissos **Então** aparecem 3 chips + `+1`; clique no `+1` **ou** na célula abre a visão **Dia de 22**; clique num chip abre os **detalhes** daquele compromisso (e dele → Editar abre o `AppointmentModal` pré-preenchido, comportamento vigente).
- **Dado** célula vazia de um mês **Quando** clicada **Então** o `AppointmentModal` abre em modo criar com **data = dia da célula** pré-preenchida; salvar cria `origem web` e o chip aparece na célula sem recarregar (invalidação `qk`).
- **Dado** célula criada em mês vizinho (leading/trailing) **Então** o clique abre a **criação com a data correta daquele mês**.
- **Dado** dois compromissos sobrepostos carregados **Então** as células/chips dos dois dias mostram a **borda `--danger`** com `title` "Choque com ‹título› (HH:mm–HH:mm)" **E** ao resolver a sobreposição (editar um deles) o alerta some após a refetch.
- **Dado** um `needs_review` na grade **Então** mostra ⚠️ e link para `/revisao` (padrão vigente da lista).

### Estados e dados

- **Dado** query lenta **Então** a **grade** da visão atual pulsa (skeleton próprio) e nenhum estado fica em branco; erro ⇒ bloco "Não foi possível carregar sua agenda" + "Tentar de novo"; vazio do mês/ano ⇒ texto próprio.
- **Dado** que ele visita outubro, vai a novembro e volta **Então** outubro sai do cache **sem** nova requisição (observável no network do smoke).

### Arquitetura / responsivo / gates

- **Então** nenhum cálculo de célula/período/conflito dentro de `.vue` (import-check: célula só de `schedule-core`) **E** nenhuma fetch fora de `app/composables` **E** rotas inalteradas com `requireAuth` **E** `pnpm build`/`test`/`lint`/`lint:arch` verdes.
- **Dado** 360×640 **Então** mês compacto por bolinhas, semana em lista vertical, ano em 12 linhas, **sem scroll horizontal de página**; **768×1024** e **≥1280**: layout da tabela F.9; checklist manual de smoke por viewport assinado no PR (mesmo da Fase 5).

## Definição de pronto

1. Gates: `pnpm build && pnpm test && pnpm lint && pnpm lint:arch` verdes.
2. Smoke manual no navegador (dark **e** claro, 3 viewports): as 4 visões renderizam com dados reais; `← hoje →` em cada visão; trocar de mês troca a query (network abre); clique em célula vazia abre modal com a data certa; clique em chip abre detalhes; conflito pintado; deep-link mês→dia→ano funciona; mobile sem scroll horizontal.
3. Docs da fase: `ia-docs/plans/fase-7-calendario-visoes.plan.md` (formato `plans.md`), **ADR-0013** (sem lib de calendário) registrado, `architecture-overview.md` atualizado se mencionar a agenda, `docs/gotchas.md` se E.6 morder.

## Decisões tomadas nesta spec (com alternativas)

| #   | Decisão                                            | Alternativas                                                                                                    | Escolhida + justificativa                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Alcance da fase                                    | (a) refazer agenda inteira; (b) **somente o que falta: Mês + Ano + upgrade da Semana**, Dia e Revisão intocadas | **(b)**: a Fase 5 entregou Dia/Revisão; mexer no que funciona é risco sem dor.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| D2  | Semana                                             | (a) grade horária 0–24h com posicionamento; (b) **manter colunas de cards da Fase 5**                           | **(b)**: D2 da Fase 5 continua válida; grade horária (e drag futuro) fica declarada fora.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D3  | Visão padrão                                       | (a) Mês sempre; (b) **manter Dia `<md` / Semana ≥`md`**                                                         | **(b)**: comportamento vigente aprovado; mês é panorama, não foco diário no celular.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D4  | Ano                                                | (a) heatmap GitHub (por contagem); (b) **12 mini-meses com bolinhas por dia com compromisso**                   | **(b)**: lê como calendário (reconhece fins de semana), clicável → Mês; densidade por dia é mais útil que contagem (Aberto #2).                                                                                                                                                                                                                                                                                                                                                                                                             |
| D5  | Semana começa em                                   | (a) segunda; (b) **domingo**                                                                                    | **(b)**: `userWeekRange` civil é segunda **mas** `formatDayHeading`/`weekDays` vigentes indexam por `getUTCDay` dom–sáb; grade dom–sáb alinha com a coluna 1 = dom como hoje. Data a decisão de produto no Aberto #3 (segunda é convenção BR).                                                                                                                                                                                                                                                                                              |
| D6  | Estado na URL (`/agenda?view=mes&date=2026-10-08`) | (a) query params; (b) **estado interno puro**                                                                   | **(b)**: a data em si **não é dado pessoal identificável** (qualquer data é), então a regra "nenhum dado do usuário em query param" não a proíbe — **mas** o padrão do repo (e o risco real: e-mail/id em params) puxa para estado interno, deep-link de calendário não é requisito de produto (usuário manda print, não link), e evita sincronizar router↔query-cache. Custo aceito: não dá para compartilhar "aberto em 22/10". Reversível: o estado já está isolado no composable (E.5); adicionar URL depois não toca em regra nenhuma. |
| D7  | Drag-and-drop                                      | (a) arrastar para reagendar; (b) **fora de escopo**                                                             | **(b)**: sem grade horária (D2) não há alvo; edição é o caminho vigente; arrastar precisa de ADR próprio (conflito em tempo real).                                                                                                                                                                                                                                                                                                                                                                                                          |
| D8  | Lib de calendário                                  | (a) fullcalendar/v-calendar; (b) **grade própria + regra no `schedule-core`**                                   | **(b)**: F.7 + ADR-0013 sugerido.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D9  | Mês com mês vizinho                                | (a) células vazias; (b) **grade preenchida dos dias vizinhos**                                                  | **(b)**: grade 6×7 inevitavelmente mostra vizinhos; escondê-los mente sobre o dia; a query estendida (B.8) custa zero.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| D10 | Badge de conflito sem endpoint                     | (a) endpoint novo de "conflitos do período"; (b) **`overlaps` client-side sobre a lista carregada**             | **(b)**: zero API nova, regra reaproveitada do `schedule-core`; limitação (conflitante fora do período) declarada em C.12; a checagem que **vale** continua sendo `check-conflict`/409.                                                                                                                                                                                                                                                                                                                                                     |

## Fora de escopo

- **Tela de revisão** (pronta na Fase 5 — nada muda), **recorrência** de compromissos, **lixeira**/histórico de exclusão, **trocar e-mail/senha/telegramId**, **deploy/residual da Fase 6**, notificações/lembretes (comportamento pronto), **bot** (nada muda no chat), reset de senha (mini-fase própria, ADR-0012).
- Grade **horária** semanal (eixo 0–24h) e **drag-and-drop** (D2/D7), edição de **regras de lembrete** a partir do calendário (o modal já cobre), exportação de agenda, i18n, PWA, visualização de **fuso de terceiros**, anexos não-texto.

## Aberto (decisões de produto — todas com default proposto para não travar)

| #   | Pergunta                                                                                             | Opções                                                 | Recomendação (default se ninguém responder)                                                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Semana começa **domingo** (grade atual) ou **segunda** (convenção BR)?                               | (a) dom (b) seg                                        | **(b) segunda** — é a convenção do usuário BR; exige mudar `weekDays` vigente (1 linha + teste). Se não responder: manter **dom** para não mexer no já entregue. |
| 2   | Densidade do "Ano": bolinha por **dia com compromisso** ou intensidade por **quantidade** (heatmap)? | (a) dias (b) contagem                                  | **(a) dias** — lê como calendário; contagem favorece quem amontoa coisas no mesmo dia.                                                                           |
| 3   | Mês mobile: bolinhas (compacto, R.16) ou chips de 1 linha?                                           | (a) bolinhas (b) chips                                 | **(a) bolinhas** — 360px não comporta 3 chips legíveis.                                                                                                          |
| 4   | "Ir para data": só menu ano/mês, ou input de data livre (`<input type="date">` no cabeçalho)?        | (a) menu (b) menu+input                                | **(a) menu** — input livre é ganho pequeno e conflita com D6 (nada na URL); easy to add depois.                                                                  |
| 5   | Hora default ao criar pelo clique no calendário (data vem da célula)                                 | 09:00 / próxima hora cheia / manter 00:00?             | **09:00 local** — cria utilizável imediatamente; usuário ajusta no modal.                                                                                        |
| 6   | Clicar no **mês anterior** (ex.: abril) no menu troca só o mês ou também a âncora (dia do mês)?      | (a) mantém nº do dia quando existir (b) vai para dia 1 | **(b) dia 1** — mais simples de explicar; âncora "hoje" continua no Hoje.                                                                                        |

## Notas de implementação (técnicas, para o feature-builder)

- Seguir `ia-docs/plans/` com `fase-7-calendario-visoes.plan.md` **antes** de codar (governança); TDD: `calendar.spec.ts`/`dates.spec.ts` primeiro (regra de testing — data nasce com teste).
- `useAgendaPage.composable.ts` extraído de `AgendaPage.vue` (a página hoje tem ~500 linhas) devolve `{ view, anchor, range, from, to, query, cells }`; as grades `.vue` só recebem props prontas.
- `AppointmentModal` recebe `prestartDate?: string (YYYY-MM-DD local)` — prop nova **de UI apenas** (o form já faz `localDateTimeToUtc` na borda); nenhuma mudança em `useAppointmentForm` além de aceitar o default.
- Conflito client-side: `conflictedIds = new Set()` construído com `overlaps` sobre `items` do período (par a par, O(n²) ok para a escala do período; documentar no comentário o motivo + a limitação da contenção).
- Chaves `qk` inalteradas; nenhuma mutation nova; nenhum endpoint novo; **não tocar** em `useReview.query`/`ReviewPage.vue`.
- Lembre gotcha 3 (aliases vite/tsconfig ao importar o novo módulo do `schedule-core`) e vue.md template-first nos `.vue` novos.
