# 0013 — Calendário sem lib externa (grade própria, regra no schedule-core)

- Status: Aceito
- Data: 2026-10-08
- Contexto da fase: Fase 7 "Calendário e visões" (grade mês, linhas da semana,
  agrupamento por dia, densidade do ano)
- Relacionado: ADR-0004 (LLM só interpreta; regra determinística decide), ADR-0002
  (datas UTC + timezone por usuário na borda)
- Spec: `.ia/specs/` da Fase 7 (calendário/visões)

## Contexto

A Fase 7 trouxe ao produto um conjunto de visões (grade do mês em 42 células,
linhas da semana, agrupamento por dia local, densidade do ano) cuja dificuldade
real **não é layout** — é regra de data determinística: onde começa a grade do mês
numa semana dominical, que dias pertencem a cada linha, em que dia _local_ do
usuário um compromisso em UTC "cai", e como o offset muda (ou não) ao longo de um
range. Tudo isso precisa ser testável com `now` e offset **injetáveis**, exatamente
o contrato que o `schedule-core` impõe a qualquer regra de data (ADR-0002/0004).

As libs de calendário prontas (FullCalendar, vue-cal e similares) entregam layout
bonito e arrastável, mas **escondem a regra do fuso dentro do componente**: o
arredondamento dia-local, a fronteira da grade e o agrupamento acontecem em código
de terceiros, com Date/Intl próprio, inacessível como função pura. Testar "compromisso
23:30 UTC de domingo aparece na segunda do usuário" viraria teste de integração de
UI — e a decisão sobre em que célula ele cai deixaria de viver no coração
determinístico do produto.

## Decisão

- **Sem lib externa de calendário.** A grade é própria: componentes Vue em
  `apps/web` apenas **renderizam props** — zero cálculo de data no front.
- A regra nasce e vive em `packages/schedule-core`: `calendar.ts` (grade do mês em
  42 células, linhas da semana, agrupamento por dia local, densidade do ano) mais
  extensões em `dates.ts`, toda função pura com `now`/offset injetável e coberta por
  testes vitest antes de ser usada.
- O badge de conflito na web reusa a regra existente por contenção do período
  visível (C.12 da spec) — o calendário não reimplementa conflito.

## Consequências

- Custo aceito: **manter a grade e o responsivo nós mesmos** (layout, navegação de
  mês, acessibilidade das células) em vez de herdar de uma lib.
- **Limitação declarada**: um único offset por range (E.6 da spec). Mudanças de DST
  dentro do range exibido são tratadas com o offset do instante de referência —
  tolerado para meses/semanas em `America/Sao_Paulo` (sem DST desde 2019), seria
  regra nova (ADR-novo) se um dia houver tz com DST.
- Ganho principal: a regra do calendário é testável como regra pura, auditável e
  igual entre bot/web — coerente com ADR-0004. Trocar de lib no futuro vira decisão
  com ADR próprio, não refactor silencioso.
