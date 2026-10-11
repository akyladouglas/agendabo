# Plano — Visão Ano: heatmap uniforme de 12 meses

- Data: 2026-10-11 | Status: concluído
- Spec: .ia/specs/web/visao-ano-heatmap.spec.md (refina C.13 da mãe calendario-visoes)
- Orquestrador: feature-orchestrator (subagent) | v1 do plano
- Aprovação: decisões humanas já aprovadas na tarefa (heatmap uniforme + query do ano);
  execução autorizada pelo humano ("escreva a spec, o plano, implemente com TDD").

## 1. Objetivo

Reformular a visão ANO da agenda web: 12 mini-meses com altura/tamanho IDÊNTICOS
(grade 7×6 de células fixas, sem `aspect-square` fluido) e query do ANO CIVIL inteiro,
com o heat dos 12 meses derivado dos dados da query (multi-dia marca cada dia tocado
dentro do ano). Bolinha de dia com compromisso vira botão acessível (→ visão Dia) no
desktop também.

## 2. Análise de profundidade

- `YearGrid.vue`: grade desktop `grid-cols-7` com `aspect-square` por célula → altura
  do card cresce com linhas de dias (causa (a)). Desktop não tem bolinha clicável.
- `useAgendaPage.composable.ts`: `range` da visão Ano JÁ é `userYearRange` correto
  (query do ano inteiro chega na API) — o bug (b) é de composição: `yearMonthCells`
  monta só 2 grades (mês da âncora + próximo), então `yearMinis` da página só
  encontra a grade do mês da âncora e os outros 11 meses ficam sem células, embora a
  `density` (dayDensity sobre o range do ano) já tenha os dados de todos os meses.
- `dayDensity(items, range, offset)` já faz exatamente C2: meses 1-12 do range, dias
  tocados DENTRO do período (half-open; 31/12 do ano anterior não entra). Reutilizar.
- Conflito por dia: `conflictedIds(items)` (schedule-core) já disponível na página.
- Grade 7×6 por mês: falta helper puro → criar `yearHeatmap(yearRange, offsetMinutes, now)`
  no schedule-core (12 × 42 `CalendarDay`, mês da grade = índice 21, same técnica de
  `monthCells`/`monthGridRange`).
- Testes afetados: `calendar-views.spec.ts` ("Ano → clique no mini-mês" clica o card —
  no novo DOM desktop o clique vai no botão do mês `year-month-7`); os demais asserts
  (`year-mini-*`, `year-dot-*`) continuam válidos (testids preservados).
- Gotchas: 10 (sem fragmento v-if irmão no corpo — não mexer na cadeia `bodyKind`),
  11 (classe derivada precisa do caso explícito `!hasAppointment → bg-transparent`),
  16 (sem BOM — escrever via ferramenta de arquivo, nunca `Set-Content`).
  Botão dentro de botão é HTML inválido → card desktop vira `<div>` com o nome do mês
  como `<button>` (decisão D3).

## 3. Decisões

| #   | Decisão                                                                                                                                                                   | Alternativa descartada                                                  | Por quê                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| D1  | Helper novo `yearHeatmap` no schedule-core (12 grades 7×6 puras, `now`/offset injetados)                                                                                  | montar as 12 grades na web/página                                       | regra de data no domínio (schedule-core.md); a web só compõe; testes now/offset fixos               |
| D2  | `yearMonthCells` sai do composable, entra `yearHeat` derivado de `yearHeatmap` com offset medido no INÍCIO do range do ano (modelo offset-único-por-período, E.6/ADR-002) | manter as 2 grades + heurística                                         | era exatamente a causa (b); um offset por período é o modelo já declarado                           |
| D3  | Card desktop = `<div>`; nome do mês = `<button>` (`year-month-M`) que leva à visão Mês; bolinha = `<button>` (`year-day-M-date`) → visão Dia                              | botão-aninhado (inválido) ou card inteiro clicável sem bolinha clicável | A3/A6; no mobile a lista atual já separa os botões e permanece                                      |
| D4  | Célula fixa `h-2.5 w-2.5` (desktop) — 42 células por card, sempre                                                                                                         | `aspect-square` fluido / `grid-rows-6`                                  | altura determinística igual entre cards; assertável em teste                                        |
| D5  | Dia com conflito = tom `bg-danger/70` (aninhado no precedence: hoje > conflito > esmaecido)                                                                               | só borda danger                                                         | decisão humana "tom de danger"; precedence explícito p/ caso hoje+conflito                          |
| D6  | `year-dot-<date>` (placeholder da grade, desktop) e `year-row-<m>`/`year-day-<date>` (mobile) preservados como testids                                                    | renomear tudo                                                           | não quebrar `multi-day-views.spec.ts` à toa; novo `year-day-<m>-<date>` p/ bolinha desktop clicável |

## 4. Etapas

| #   | Etapa                                                                                                                                       | Worker          | Status | Saída (condição de pronta)                                                                    | Relatório                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------ | --------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 1   | Spec + plano                                                                                                                                | orquestrador    | feita  | spec refina C.13, plano aprovado pelo escopo da tarefa                                        | este arquivo                                 |
| 2   | `yearHeatmap` TDD no schedule-core (casos: 2026/2027, leading por mês, `inMonth` soma 365/366, `isToday` com `now` fixo, offset −180 e DST) | feature-builder | feita  | `pnpm --filter @agendabo/schedule-core test` verde                                            | 4 testes novos em calendar.spec.ts           |
| 3   | Web: `yearHeat` no composable + `YearGrid` heatmap + `yearMinis` na página (conflito via `conflictedIds`)                                   | feature-builder | feita  | testes novos `year-heatmap.spec.ts` verdes; suites antigas adaptadas (clique no botão do mês) | 8 testes novos página + asserções de classes |
| 4   | Gates raiz: build+test+lint+lint:arch                                                                                                       | orquestrador    | feita  | tudo verde, 0 erros lint                                                                      | ver §6                                       |
| 5   | Docs: spec marcada implementada, `pnpm sync:ia`, plano fechado                                                                              | orquestrador    | feita  | sync sem diff em pontas                                                                       | ver §6                                       |

## 5. Próxima ação

Nada pendente de código. Pendência humana: smoke E2E manual (olhar o DOM real da visão
Ano — gotcha 11 é visual) e commit convencional quando o humano quiser (nada commitado).

## 6. Log

- 2026-10-11 — spec escrita (refina C.13), plano v1 aprovado pelo escopo da tarefa.
- 2026-10-11 — etapa 2: `yearHeatmap` (TDD, 4 testes: leading/trailing por mês,
  12×42 + soma de inMonth = 365/366, isToday por now injetado, offset −180; mês da
  grade = índice 21). Verde.
- 2026-10-11 — etapa 3: composable ganha `yearHeat` (offset medido no início do range
  do ano) e perde `yearMonthCells`; YearGrid redesenhado (desktop: grade 7×6 fixa
  `h-2.5 w-2.5`, sem `aspect-square`, bolinha = botão → Dia; nome do mês = botão →
  Mês; card = div com aria-label de contagem); página monta `yearMinis` de
  `yearHeat`+`dayDensity`+`conflictedIds` (conflito → tom danger; esmaecer ≥ 8ª bolinha
  preservado). `year-heatmap.spec.ts` novo (query do ano, heat multi-mês, fronteira
  31/12↔02/01, mês vazio, cliques mês/dia desktop, classes fixas, clique em jul→Mês
  desktop). calendar-views/multi-day-views: clique do Ano→Mês passa em `year-month-7`
  (desktop) e mantém `year-mini-7` no mobile.
- 2026-10-11 — etapa 4: `pnpm build` ✅, `pnpm test` ✅ (schedule-core, api, web),
  `pnpm lint` ✅ 0 erros (warnings CRLF pré-existentes), `pnpm lint:arch` ✅.
- 2026-10-11 — etapa 5: spec `implementada`, `pnpm sync:ia` rodado. Nada commitado.
- 2026-10-11 — ajustes finais do gate: `year-empty-<date>` (placeholder desktop) em
  vez de `year-dot-<date>` (o testid da bolinha passou a `year-dot-<mes>-<date>`);
  spec ganhou §6 "notas de implementação". Gates reconfirmados na raiz: build/test/
  lint/lint:arch verdes. Nada commitado (humano decide o commit).
