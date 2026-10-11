# Spec — Compromissos multi-dia nas visões da web (Dia/Semana/Mês) + conflito multi-dia na API

- Domínio: web + api (consome agendamento) | Data: 2026-10-11 | Status: **aprovada** (as 8 decisões de produto/humano de 2026-10-11 estão registradas aqui como texto; o humano pediu spec+plano+implementação no mesmo despacho)
- ADRs relacionados: **ADR-002** (UTC no banco + offset na borda — os cortes por dia nascem do offset injetado), **ADR-004** (regras decidem: corte/toque/conflito = `schedule-core`), **ADR-005** (web consome schedule-core via alias). Nenhum ADR vigente é contrariado.
- Spec mãe **REFERENCIADA, não reescrita**: `.ia/specs/web/calendario-visoes.spec.md` (grades, navegação, chips, densidade). Onde esta spec muda comportamento dela (ex.: "API zero mudança" de D.14, limitação do badge C.12), ESTA spec prevalece e a mãe fica como histórico.
- Pedida por: incidente de produção 2026-10-11 (prints do usuário) | Fase do roadmap: continuação da 7/8

## Dor (bug real, 2026-10-11)

Compromisso "viagem para lucena" 10/10 23:00 → 12/10 17:00 (America/Sao_Paulo):

- **Mês**: chip só no dia 10; dias 11 e 12 vazios.
- **Semana**: nada em nenhum dia.
- **Dia 10/10**: "Nada neste dia" — nem o segmento 23:00→24:00 aparece.

Causas raiz (confirmadas por inspeção):

1. `appointments.service.list()` filtra por **contenção** (`startsAt >= from AND endsAt <= to`): um item que só TOCA a janela nunca chega à web. O bot já usa `listOverlapping` (intersecção half-open).
2. `groupByLocalDay` bucketeia **só pelo dia de `startsAt`** → o Mês não conhece 11/12.
3. A Semana agrupa por `byDay` (dia de início) → colunas 11/12 não recebem o item; falta o corte por dia.

## Comportamento esperado (Google Agenda — decisões humanas APROVADAS 2026-10-11)

### A. API — carga por intersecção

1. **`GET /appointments` (`list`)** passa a trazer os compromissos que **TOCAM** o período: intersecção half-open **`startsAt < to AND endsAt >= from`** (espelho EXATO de `listOverlapping`, inclusive a borda `endsAt == from` —half-open consistente e documentada nos dois lados). Status/campos/order/`include` inalterados. Efeito: o Dia 10/10 recebe a viagem e mostra 23:00→24:00.
2. **Toda carga de checagem de conflito** (check-conflict, create/update via `existingFor`, reschedule/relocation-options via `existingForInTx`, pré-check do bot `existingConfirmedFuture`) usa **intersecção half-open com o candidato**, nunca contenção — um candidato multi-dia choca com item contido em dia intermediário, e um candidato pontual choca com multi-dia existente. `findConflict` (schedule-core) já é intervalo puro; o que muda é a CARGA. (Hoje essas cargas são "futuras" (`endsAt > now`), o que faz um candidato no PASSADO que toca um item futuro não vê-lo — corrigido: a carga é a **intersecção meia-aberta com o candidato expandido** `[min(now, candidateStart), max(candidateEnd, now + HORIZONTE))` (implementação 2026-10-11; `now` segue em `findConflict` só para descartar obstáculos já encerrados — invariante ADR-0015). Exceção registrada: o pré-check do bot usa a janela futura `[now, now+90d)` porque todo candidato do fluxo guiado nasce ≥ now.)

### B. Visão Dia

3. O bloco mostra a **faixa recortada do dia** na grade de horas (10/10: 23:00→24:00; 11/10: 00:00→24:00; 12/10: 00:00→17:00). `layoutDayTimeline` já clampa — blindado por teste com `now`/offset injetados. Rótulo do bloco = o recorte do dia (com marcador de continuação quando o item vem/vai para outro dia), para não repetir o mesmo período integral nas 3 colunas.
4. A **lista do dia** (abaixo da grade) inclui os itens que TOCAM o dia — mesmo os "de fora" (começam antes / terminam depois) — exibidos com o período completo (`formatRangeInTz`, vigente, conferido).

### C. Visão Semana

5. Cada coluna-dia mostra o **recorte do evento no seu intervalo** na grade de horas (faixa no grid de horas — SEM faixa all-day separada; decisão aprovada). Título **repetido por dia** (decisão aprovada); clique abre o **mesmo compromisso**. Marcadores visuais de continuação ("…" à esquerda quando começou antes, à direita quando continua depois — `continuesBefore`/`continuesAfter`).
6. Drag continua translação pura do intervalo integral: origem do item = dia de `startsAt` (invariante `dropOriginKey`), drop na própria coluna-origem = no-op mudo, drop em outra coluna = mesma hora em outro dia (payloads `startsAt/endsAt` intactos).

### D. Visão Mês

7. **Chip nos dias que o item TOCA** (10, 11 e 12): no dia de início com hora de início; nos dias do meio/fim sem hora ("dia inteiro", marcador de continuação). Helper novo em `schedule-core`: `localDaysTouched(item, offsetMinutes)` enumera os date-keys locais tocados (half-open: item terminando EXATAMENTE na meia-noite NÃO toca o dia seguinte). Limites de chips (3 + `+N`) e bolinhas mobile continuam funcionando com os dias tocados.

### E. Ano/densidade

8. `dayDensity` passa a contar os **dias tocados** (um multi-dia 10→12 marca 3 dias — coerência com D.7).

### F. Regra pura (onde mora)

F.1. `schedule-core` (puro, `offsetMinutes` injetável, zero Intl, half-open em tudo):

- `localDaysTouched(item, offsetMinutes): string[]` — date-keys locais tocados, ordem cronológica; item vazio/degenerado ([x, x)) → [];
- `groupByLocalDayTouched(items, offsetMinutes): Map<dateKey, T[]>` — item entra em TODOS os dias que toca, ordenado por `startsAt` (o `groupByLocalDay` atual, por dia de início, é SUBSTITUÍDO — não há consumidor remanescente);
- `sliceItemToRange(item, range): { startsAt, endsAt, continuesBefore, continuesAfter } | null` — recorte do item a um meio [start, end); `null` quando não toca (half-open: encostado não toca);
- `dayDensity` — dias tocados (E.8);
- `layoutDayTimeline`/`hourGrid`/`dropTarget` — sem mudança de regra (clamp já existe).

F.2. A web consome só via alias de fonte; zero cálculo de data em `.vue` (E.4 da mãe). A borda web mede o offset (Intl em `tz.ts`) e injeta.

F.3. Testes mínimos (obrigatórios, testing.md):

- schedule-core (vitest, offset/`now` fixos): item terminando EXATAMENTE na meia-noite do dia seguinte (não toca o dia seguinte); começando EXATAMENTE na meia-noite (toca só o novo dia); multi-dia 23:00→17:00 toca 3 dias; `sliceItemToRange` recorte/flags/encostado→null; `groupByLocalDayTouched` com o 23:50→00:10 da mãe nos DOIS keys; `dayDensity` com multi-dia contando os dias tocados; mês virando a grade (item que nasce antes da grade e morre dentro).
- api (jest): `list` com intersecção (toque pelos dois lados + contido + encostado fora); carga de conflito com candidato multi-dia × item contido em dia intermediário, e candidato pontual × multi-dia existente (check-conflict e create/update); reschedule/relocation com carga intersecada; bot `existingConfirmedFuture` vê multi-dia "grudado" no horizonte.
- web (vitest): Mês com chips em 10/11/12; Semana com 3 colunas recortadas clicáveis abrindo o MESMO item; Dia 10/10 com o segmento 23:00→24:00; painel de detalhe/lista com item "de fora" sem quebrar.

## Critérios de aceite (Gherkin)

### API (jest)

- **Dado** um item 10/10 02:00Z→12/10 20:00Z **Quando** `list(from=10/10T03:00Z, to=11/10T03:00Z)` **Então** o item vem (toca pelo início) **E** `list(from=11/10, to=12/10)` também o traz **E** `list` com janela encostada no fim do item (`from = endsAt`) NÃO o traz.
- **Dado** compromisso em 17/10 15:00 **Quando** `checkConflict(10/10 00:00 → 20/10 00:00)` **Então** `conflict: true` com ele **E** `create` do mesmo candidato devolve 409 **E** o inverso: candidato 17/10 15:00 contra multi-dia existente choca.
- **Dado** o pre-check do bot com candidato 15/10 09:00 **Quando** existir multi-dia começando ANTES de `now` e terminando em 15/10 **Então** o pré-check vê o conflito.

### Web (vitest)

- **Dado** a viagem 10/10 23:00 → 12/10 17:00 **Quando** abrir o Mês de outubro **Então** há chip `data-chip-item-id=viagem` nas células 10, 11 e 12 (no 10 com hora de início; 11/12 sem hora) **E** todos abrem os mesmos detalhes.
- **Dado** a mesma viagem **Quando** abrir a Semana que contém 11/10 **Então** as colunas 10, 11 e 12 cada uma tem um bloco da viagem posicionado no recorte do dia (10: 23:00→24:00; 11: 00:00→24:00; 12: 00:00→17:00), clicáveis no MESMO compromisso.
- **Dado** a mesma viagem **Quando** abrir o Dia 10/10 **Então** existe bloco com `top` ≈ 23/24 e altura ≈ 1/24 **E** a lista do dia mostra a viagem com o período completo.
- **Dado** um item que começa antes e termina depois da grade do Mês **Então** os chips aparecem nos dias tocados dentro da grade, sem erro.

### Gates

- **Então** `pnpm build && pnpm test && pnpm lint && pnpm lint:arch` verdes (lint: 0 erros; warnings CRLF pré-existentes ok) **E** nenhum cálculo de data/conflito em `.vue` **E** `pnpm sync:ia` rodado após editar `.ia/`.

## Definição de pronto

1. Gates acima verdes.
2. `docs/gotchas.md` com o gotcha novo ("`list` continha, não tocava — evento multi-dia invisível na grade").
3. Plano `ia-docs/plans/multi-dia-nas-visoes.plan.md` atualizado (status/log/próxima ação); spec mãe NÃO reescrita (apenas esta a referencia).
4. Smoke manual (browser, dark/claro, 360/768/1280): viagem de 3 dias visível nas 3 visões; clique nos chips/colunas abre o mesmo compromisso; drag de multi-dia continua translação.

## Decisões tomadas nesta spec (as 8 aprovadas pelo humano em 2026-10-11)

| #   | Decisão                                                                                  | Alternativa descartada                                          | Por quê                                                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | `list` = intersecção half-open espelhando `listOverlapping` (inclusive `endsAt >= from`) | (a) half-open estrito `gt` dos dois lados; (b) manter contenção | (b) é o bug. (a) divergiria de `listOverlapping` (testado) — espelhar a carga do bot dá UMA semântica de "toca" para o produto todo; documentada nos dois lados. |
| M2  | Dia: recorte do dia na grade de horas                                                    | (a) faixa só no dia de início                                   | Google Agenda; o usuário pediu.                                                                                                                                  |
| M3  | Semana: recorte por coluna, título repetido, clicável no MESMO item, SEM faixa all-day   | (a) all-day separada; (b) coluna só no dia de início            | decisão aprovada; a grade de horas por coluna já existe.                                                                                                         |
| M4  | Mês: chip em TODO dia tocado (11/12 sem hora)                                            | (a) só dia de início com ↦/↤                                    | Google Agenda; decisão aprovada.                                                                                                                                 |
| M5  | `dayDensity` conta dias tocados                                                          | contagem por início                                             | coerência com M4 (visão Ano não pode desmentir o Mês).                                                                                                           |
| M6  | Conflito multi-dia: TODAS as cargas de checagem por intersecção half-open                | (a) só `findConflict` (já puro)                                 | o problema é a CARGA, não a regra; decisão humana explícita.                                                                                                     |
| M7  | Drag/check-conflict/relocation: payloads intactos + testes                               | refazer drag                                                    | payloads já levam o intervalo integral.                                                                                                                          |
| M8  | Painel/lista exibem item "de fora" com período completo (`formatRangeInTz` vigente)      | esconder de fora                                                | conferido: `formatRangeInTz` já trata fim vazando o dia.                                                                                                         |

## Fora de escopo

- Faixa all-day separada (linha própria no topo do dia), recorrência, edição de lembretes pelo calendário, exportação, i18n, PWA, URL de deep-link (D6 da mãe), bot (nada muda no chat além da carga do pré-check), notificações, revisão.

## Aberto (decisões de produto)

(vazio — todas as decisões foram aprovadas pelo humano em 2026-10-11)

## Notas de implementação (técnicas, para o feature-builder)

- `list` mantém `include: { notificationRules: true }` e ordenação; o zod da borda (`listAppointmentsQuerySchema`) não muda.
- `existingConfirmedFuture` do bot: intersecção `[agora, horizonte]` = `startsAt < horizonte AND endsAt >= agora` (era `endsAt > now AND <= horizon` — multi-dia começando antes de `now` fica de fora).
- Semana/Dia: recorte via `sliceItemToRange` na borda (composable/página) ANTES do `layoutDayTimeline`, ou o `layoutDayTimeline` recebe os itens integros e clampa (ele já clampa) — o corte é necessário para os FLAGS de continuação e para o rótulo do recorte; a coluna SEMPRE recebe o item (não mais por `byDay` de início).
- Mês: chips por `localDaysTouched`; `chipTime` vigente (`↦`/`↤`) vira marcador de "dia inteiro" nos dias sem início.
- `key` dos blocos por (item.id, dia) — um item pode ocupar 2+ colunas; `week-item-<id>` pode repetir (testes usam `findAll`).
- Gotcha 3 (aliases), gotcha 10 (fragmentos happy-dom), vue.md template-first.
