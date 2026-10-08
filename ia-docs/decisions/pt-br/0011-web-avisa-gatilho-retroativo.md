# 0011 — Web avisa gatilho retroativo de lembrete (substitui Aberto #1 da Fase 3)

- Status: Aceito
- Data: 2026-10-08
- Contexto da fase: Fase 5 (visão web completa — agenda, revisão, perfil)
- Substitui: Aberto #1 de `.ia/specs/notificacoes/lembretes-e-resumo-diario.spec.md`
  (Fase 3: "form web com regra retroativa é silencioso — só o bot avisa"), confirmado
  na decisão 3 do Aberto da spec da Fase 5 (`.ia/specs/web/calendario-perfil-revisao-web.spec.md`).

## Contexto

Na Fase 3 decidimos que criar/editar um compromisso na **web** com regra de lembrete cujo
`firesAt` já passou era **silencioso**: a API simplesmente não materializava os gatilhos
do passado (regra é da API — `schedule-core` + materialização de outbox) e nada era dito
ao usuário; só o **bot** avisava no chat. Na Fase 5, ao trazer o editor de regras de
lembrete para o modal de compromisso da web, o humano reavaliou: a mesma fala que o bot
tem ("⏰ alguns lembretes não vão disparar — o horário deles já passou") é informação
útil também na web, e o silêncio entre canais era inconsistência de produto, não escolha.

O ponto sensível é **quem conta**: a regra de materialização (quais gatilhos nascem) é
determinística e mora na API/`schedule-core`. Se a web reimplementasse a contagem,
teríamos duas verdades.

## Decisão

- **A web passa a AVISAR** (não a decidir): ao criar/editar com regra(s) cujo gatilho já
  passou, o `useAppointmentForm` mostra um aviso discreto no formulário ("alguns lembretes
  não vão disparar") **antes** do submit, e exibe toast com o que a API reportou como
  descartado **depois** dele.
- **A regra continua sendo única na API**: a materialização de outbox não muda — só o que
  está no futuro gera job. A web nunca descarta nem fabrica gatilho.
- **Contagem local sem duplicar regra**: o aviso prévio usa `computeAllTriggers` (nova
  exportação pura de `schedule-core.notifications`, testada por TDD); o número exibido é
  `computeAllTriggers(startsAt, rules).length - computeTriggers(startsAt, rules).length`,
  importado por alias de fonte (ADR-005). Zero aritmética de lembrete no front.
- **Verificação pela API**: as respostas de create/update de compromisso passaram a trazer
  `droppedRules` (regras cujos gatilhos foram todos descartados); o toast pós-submit é
  montado a partir dela, não da contagem local.

## Consequências

- Bot e web dão a mesma informação no mesmo tom; o Aberto #1 da Fase 3 está formalmente
  substituído por este ADR.
- `computeAllTriggers` entra na superfície pública do `schedule-core` com testes próprios —
  qualquer mudança futura na materialização tem que continuar satisfazendo a relação
  "todos os gatilhos − gatilhos futuros = gatilhos perdidos".
- O aviso é cosmético: bloquear submit por gatilho retroativo foi rejeitado (o usuário
  pode querer registrar um compromisso passado sem lembretes).
