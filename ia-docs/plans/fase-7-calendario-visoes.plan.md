# Plano — Fase 7: Calendário da agenda (visões mês/semana/dia/ano)

- Spec: `.ia/specs/web/calendario-visoes.spec.md` (aprovada 2026-10-08, defaults da tabela Aberto)
- Dono: humano | Execução: IA (feature-builder + test-writer + reviewers)
- Branch: `main` (padrão do repo até aqui)

## Decisões travadas pela spec

- Escopo: **Mês (grade nova) + Ano (12 mini-meses com densidade) + upgrade da Semana**; Dia e Revisão intocadas.
- **Sem lib de calendário** — grade própria; registrar **ADR-0013**.
- Regra pura em `schedule-core` (células do mês, linhas da semana, agrupamento dia→compromissos por fuso, densidade do ano) + `dates.ts`: `monthGridRange`, `shiftMonthRange`, `shiftYearRange`. TDD obrigatório (regra de data).
- Deep-link: **estado interno** (nada na URL). Navegação por âncora (dia focado) + menu ir-para (ano/mês, radix Select/Popover).
- API: nenhuma mudança (`GET /appointments?from&to` com contenção já existente).
- Defaults aprovados: semana começa domingo | densidade do Ano por dia com compromisso | mês mobile com bolinhas | ir-para-data só menu | criar a partir da célula usa 09:00 local | trocar mês ancora no dia 1.
- Responsivo: mês compacto (bolinhas) `<md`, semana vira lista vertical de dias, ano vira 12 linhas.
- Extração: `useAgendaPage.composable.ts` fora de `AgendaPage.vue` (~500 linhas hoje); grades `.vue` só recebem props prontas.
- `AppointmentModal` ganha `prestartDate?: string (YYYY-MM-DD local)` (UI apenas).
- Drag-and-drop: FORA de escopo.

## Etapas (ordem; gates ao final)

1. **[CONCLUÍDA 2026-10-08] test-writer-first (schedule-core, TDD red→green)** — `calendar.spec.ts` + extensões `dates.spec.ts` (120 testes no package, todos verdes; exports prontos para a etapa web: `monthGridRange(date, offsetMin)`, `shiftMonthRange(date, offsetMin, n) → Date` (meia-noite local do dia 1 do mês destino), `shiftYearRange(date, offsetMin, n) → Date` (01/01 do ano destino), `monthCells(gridRange, offsetMin, now?)` / `weekRows(weekRange, offsetMin, now?) → CalendarDay[]` (dom..sáb), `groupByLocalDay(items, offsetMin)` (pelo INÍCIO local), `dayDensity(items, range, offsetMin) → Map<1..12, {month, daysWithAppointments, dayKeys}>`):
   - `monthGridRange(anchorUtc, offsetMin)`: grade 6×7 cobrindo a âncora; casos: fevereiro bissexto, mês em 6 linhas, mês em 5 linhas, virada de mês nos dias vazios.
   - `weekRowsRange(anchorUtc, offsetMin)` (semana começando domingo — manter convenção atual): DST America/Sao_Paulo (deslocamento único por range, limitação declarada C/E da spec), compromisso cruzando meia-noite agrupa no dia de início LOCAL.
   - `groupByLocalDay(items, offsetMin)` e `dayDensity(items, yearRangeUtc, offsetMin)` (dias civis com ≥1 compromisso).
   - `shiftMonthRange`/`shiftYearRange` (trocar mês ancora no dia 1; ano troca o ano da âncora).
2. **[CONCLUÍDA 2026-10-08] contracts**: nenhum payload novo — a agenda consome `appointmentsListResponseSchema` existente; nenhum arquivo tocado.
3. **[CONCLUÍDA 2026-10-08] web — composable + visões**:
   - `useAgendaPage.composable.ts` (novo): view/âncora estado interno + persistência em localStorage (`agenda:view`, `agenda:anchor` como dateKey civil); período da query, grade/células/densidade derivados só via schedule-core. A página expõe a instância em `window.__agenda` (linha `@test-hook`) para o harness de testes.
   - `MonthGrid.vue`, `YearGrid.vue`, `WeekGrid.vue`, `AgendaNav.vue` (novos) e `AgendaPage.vue` orquestradora fina: grades burras (props prontas; zero regra de data/conflito no `.vue` — E.4/E.5 ok). Corpo da página = UM elemento por branch (v-else-if sem `<template>` irmão — gotcha happy-dom, docs/gotchas.md #10).
   - Mês "efetivo": mês exibido derivado da ÂNCORA (nunca do início da grade); célula com dayIndex ≥ 35 na própria grade (trailing) puxa o mês seguinte.
   - Conflito visível (C.12): `conflicts-pairs.ts` NO schedule-core (`conflictedIds`, `firstConflictLabel`) com testes — par determinístico sobre o período visível (limitação da contenção declarada em código).
   - `AppointmentModal`: `presetDate` + `DEFAULT_CREATE_HOUR = 9` na criação por célula; `:key` por sessão de abertura força form novo (o form é reativo). Atenção ao nome da prop (`:preset-date`, não `:prestart-date` — docs/gotchas.md #9).
   - `tests/calendar-views.spec.ts`: 11/11 verdes (harness DOM vivo; abas radix trocadas pela instância do composable; FocusScope/FocusGuards stubbados — docs/gotchas.md #10).
4. **[CONCLUÍDA 2026-10-08] ADR-0013** (`ia-docs/decisions/pt-br/0013-sem-lib-de-calendario.md` — sem lib externa, grade própria, regra em `schedule-core/calendar.ts`; índice `README.md` atualizado) + `architecture-overview.md` atualizado (tabela de packages + seção Decisões estruturais); `pnpm sync:ia` rodado.
5. **[CONCLUÍDA 2026-10-08] Gates**: `pnpm build` exit 0 | `pnpm test` exit 0 (vitest: contracts 44/44, schedule-core 127/127, api 118/118, web 61/61; jest api 146/146) | `pnpm lint` exit 0 (só warnings pré-existentes MODULE_TYPELESS_PACKAGE_JSON) | `pnpm lint:arch` exit 0 (depcruise: 124 módulos, 384 deps, zero violações).
6. **Smoke E2E no navegador** (dark + leve, 3 viewports): trocar visões mantendo âncora, navegar meses, ano→clique→mês, clique célula→modal com data pré-preenchida, clique compromisso→detalhes, mobile mês/semana/ano. **PENDENTE** (inclui o clique real nas abas radix, não exercitado nos testes unitários)
7. **Review** (code-reviewer ou review-orchestrator se diff largo em schedule-core+web). **PENDENTE**
8. **Commit** com mensagem convencional + push (após OK do humano). **PENDENTE** (mudanças mantidas não-commitadas por instrução da etapa)

## Riscos/conhecido

- Emparelhamento de conflito usa o período visível (limitação da contenção `from/to` declarada na spec C.12) — chip pode não mostrar par fora do mês; aceitável.
- DST: offset único por range (limitação declarada E.6); Brasil não tem DST desde 2019, risco baixo.
- `AgendaPage.vue` grande: extração do composable é pré-requisito para não crescer mais.
- Harness de teste depende de `window.__agenda` (`@test-hook` na página) e stub de FocusScope — documentado em docs/gotchas.md #10; trocar para abas radix reais quando o happy-dom suportar RovingFocus.

## Definition of Done

Spec 100% coberta + testes da regra pura com `now`/offset injetáveis + gates verdes + smoke aprovado + ADR-0013 registrado + spec/plano marcados como concluídos.
