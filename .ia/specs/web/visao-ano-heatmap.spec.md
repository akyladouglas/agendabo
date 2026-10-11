# Spec — Visão Ano: heatmap uniforme de 12 meses + query do ano inteiro

- Domínio: web (agenda) | Data: 2026-10-11 | Status: **implementada** (2026-10-11)
- **Refina a regra C.13 da spec mãe** `.ia/specs/web/calendario-visoes.spec.md`
  (12 mini-meses, bolinha por dia com compromisso, esmaecimento após a 7ª, clique no
  mini-mês → visão Mês, ← → troca o ano). Esta spec NÃO reescreve C.13: ela define o
  layout uniforme (heat 7×6 fixo) e o período da query (ano civil completo). Onde
  divergir de C.13 quanto a layout, esta spec vale; os demais comportamentos de C.13
  permanecem.
- Refina também o item multi-dia da spec `.ia/specs/web/multi-dia-nas-visoes.spec.md`
  no recorte temporal: a densidade marca os dias tocados **dentro do ano exibido**
  (dias tocados fora da janela do ano não aparecem — não existe heatmap fora do ano).
- Decisões humanas aprovadas (2026-10-11): D-1 heatmap uniforme desktop; D-2 query do
  ano civil da âncora; mobile mantém a lista de 12 linhas (R.16).

## 1. Problema

Visão Ano atual (print 2026-10-11): (a) mini-meses com ALTURAS DIFERENTES — a grade
7-colunas usa `aspect-square` fluido e cresce com o número de linhas de dias (mês de
6 linhas > mês de 5); (b) meses futuros VAZIOS — a heurística de grades do Ano só
montava 2 grades (mês da âncora + próximo), então apenas meses próximos da janela
carregada recebiam bolinhas; (c) bolinhas sem contexto de dia no desktop, e a
densidade de um dia só existia como espaçador invisível (não clicável no desktop).

## 2. Regras

### A. Heatmap uniforme (desktop ≥md)

- A1. A visão Ano mostra os 12 mini-meses do ANO CIVIL da âncora em cards do MESMO
  tamanho: grade **7 colunas × 6 linhas fixas** (42 células), célula de tamanho FIXO
  (`h-2.5 w-2.5`, nunca `aspect-square` fluido que estica o card). Um mês de 5 linhas
  ocupa a 6ª linha com espaçadores vazios — altura idêntica entre cards.
- A2. Cada dia do mês é um pontinho discreto e alinhado na grade. Dia COM compromisso
  (dia tocado, ver C2) = bolinha `bg-primary/70`; dia de HOJE com compromisso = anel
  `ring-primary`; dia com CONFLITO = tom de danger; dias além da 7ª bolinha do mês =
  esmaecidos (comportamento C.13 existente preservado).
- A3. Clique na bolinha de um dia com compromisso → visão **Dia** daquele dia
  (deep-link, antes só do mobile). Célula sem compromisso não é alvo de clique.
- A4. Clique no card do mês → visão **Mês** do mês clicado (não só o da âncora).
- A5. Cabeçalho do mês + contagem de dias ocupados no aria-label
  ("out: 5 dias com compromissos") — preservado.
- A6. Acessibilidade: cada bolinha clicável é um `<button>` nativo (focável por
  teclado) com aria-label própria ("15 de out: ver o dia"); o card do mês continua um
  `<button>` com o aria-label de contagem. (Aninhamento de botões é inválido em HTML;
  no desktop o card é um container e o nome do mês vira o botão do mês.)

### B. Mobile (<md)

- B1. Mantida a lista vertical de 12 linhas (R.16 da mãe): linha-clique → Mês;
  bolinhas clicáveis → Dia. Dados/idênticos aos do desktop (mesma fonte derivada).

### C. Query do ano inteiro

- C1. A visão Ano consulta `GET /appointments?from=&to=` com o **ano civil local da
  âncora** (`userYearRange(anchor, offset)` — início de 1º/jan 00:00 local, fim
  exclusive 1º/jan do ano seguinte 00:00 local). A janela da query da visão Ano é
  EXATAMENTE esse range.
- C2. A densidade/heat dos 12 meses deriva dos dados dessa query via `dayDensity`
  (schedule-core): um item conta em TODOS os dias locais que TOCA (multi-dia — spec
  multi-dia-nas-visoes), **dentro da janela**: dias tocados fora do ano exibido (ex.:
  item 30/12/ano-anterior → 02/01 marca 01 e 02 do ano exibido; 31/12 do
  ano-anterior fica fora — não existe célula dele no heatmap) não aparecem.
- C3. `← → hoje` na visão Ano mudam o ANO da âncora (01/01 do destino) e a query
  reexecuta para o novo ano (já vigente — preservar).
- C4. Skeleton da visão Ano enquanto carrega: 12 cards pulsando (`skeleton-year`
  existente), nunca as 3 listas genéricas (regra 15 da mãe / D.15).

### D. Domínio (schedule-core)

- D1. A montagem da grade 7×6 dos 12 meses é regra de data e mora no schedule-core:
  `yearHeatmap(yearRange, offsetMinutes, now)` → 12 meses × 42 células (`CalendarDay`
  com `inMonth`/`isToday`, mês da grade = dia do meio, índice 21 — mesma definição de
  `monthCells`). A web só compõe: densidade (`dayDensity`), conflito
  (`conflictedIds`), classes.

## 3. Critérios de aceite (Gherkin)

Cenário: altura uniforme
**Dado** a visão Ano de um ano com meses de 5 e 6 linhas (ex.: 2026)
**Quando** renderiza o heatmap desktop
**Então** os 12 cards têm grade com exatamente 42 células
**E** toda célula usa a classe de tamanho fixo (`h-2.5 w-2.5`)
**E** nenhuma célula usa `aspect-square`

Cenário: heat dos 12 meses com a query do ano
**Dado** compromissos em fevereiro e dezembro do ano da âncora
**Quando** abro a visão Ano
**Então** a query usa `from`/`to` do ano civil local da âncora
**E** os dias com compromisso desses meses têm bolinha (não só o mês da âncora)

Cenário: multi-dia na fronteira do ano
**Dado** um item multi-dia nascido em 31/12 do ano ANTERIOR e terminando em 02/01
**Quando** abro a visão Ano do ano corrente
**Então** 01/01 e 02/01 têm bolinha
**E** não existe célula/bolinha de 31/12 do ano anterior no heatmap

Cenário: mês vazio
**Dado** um mês do ano sem nenhum compromisso
**Quando** renderiza o heatmap
**Então** o card tem a mesma altura (42 células fixas), heat vazio e contagem 0
no aria-label ("fev: 0 dias com compromissos")

Cenário: cliques
**Dado** a visão Ano
**Quando** clico no card de julho
**Então** abro a visão Mês de julho
**E quando** clico na bolinha de 15/10
**Então** abro a visão Dia de 15/10 (desktop e mobile)

Cenário: navegação anual
**Dado** a visão Ano de 2026
**Quando** pressiono →
**Então** a âncora vai a 01/01/2027 e a query reexecuta para o ano civil de 2027

Cenário: skeleton
**Dado** a visão Ano com a query pendente
**Então** aparecem 12 cards de skeleton pulsando (`skeleton-year`)

Cenário: acessibilidade
**Dado** a visão Ano
**Então** cada card de mês tem aria-label "<mês>: N dia(s) com compromissos"
**E** cada bolinha de dia com compromisso é `<button>` focável com aria-label
"<dia> de <mês>: ver o dia"

## 4. Fora de escopo

- Heatmap na lista mobile (lista de linhas continua — R.16).
- Zoom/tooltip com a lista de compromissos do dia.
- Qualquer mudança na API/contracts (a `list` com interseção half-open já cobre).

## 5. Pontos de contato no código

- `packages/schedule-core/src/calendar.ts` — `yearHeatmap` (+ teste `calendar.spec.ts`).
- `apps/web/src/app/composables/useAgendaPage.composable.ts` — `yearHeat` derivado
  (substitui `yearMonthCells`); `range` da visão Ano já é `userYearRange` (confirmar).
- `apps/web/src/view/pages/agenda/YearGrid.vue` — heatmap burro 7×6 + botões de dia.
- `apps/web/src/view/pages/agenda/AgendaPage.vue` — `yearMinis` a partir de `yearHeat`
  - `density` + conflito (`conflictedIds`).
- Testes: `apps/web/tests/year-heatmap.spec.ts` (novo), `calendar-views.spec.ts` e
  `multi-day-views.spec.ts` (adaptados ao novo DOM do desktop).

## 6. Notas de implementação (o que a spec não previa)

- **Mobile**: a lista de 12 linhas não tem cellas por dia — um dia sem compromisso não
  existe lá — então o placeholder vazio do desktop ganhou testid próprio
  (`year-empty-<date>`) em vez de herdar `year-dot-<date>`. A bolinha clicável do
  desktop é `year-dot-<mes>-<date>`; a do mobile permanece `year-day-<date>`.
- **Pracência de classes da bolinha** (A2): hoje (anel) > conflito (danger) >
  esmaecido > normal.
- **Esmaecimento C.13** recontado pela ordem do CALENDÁRIO (a 8ª bolinha em diante do
  mês), não pelo índice do `dayKeys` — comportamento equivalente, mais direto.
- **Contagem 0** aparece como "—" no cabeçalho do card (decisão humana D-1); o
  aria-label mantém o número ("dez: 0 dias com compromissos").
- **DST/offset no ano**: o offset da grade/densidade do Ano é medido no INÍCIO do
  range do ano (modelo de offset único por período — ADR-002/E.6), não na âncora;
  coincide com a âncora quando a âncora é meia-noite local do dia 1.
