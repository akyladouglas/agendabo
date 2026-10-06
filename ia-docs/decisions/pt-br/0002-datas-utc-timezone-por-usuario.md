# 0002 — Datas em UTC + timezone por usuário

- Status: Aceito
- Data: 2026-10-05

## Contexto

O produto é centrado em tempo: conflitos, lembretes, resumo diário, "quinta que vem às
14h". Armazenar hora local cria bug silencioso em DST, viagem e cálculo de intervalo. O
bot recebe a intenção no fuso do usuário; o banco precisa de uma verdade única.

## Decisão

- Todo `DateTime` em Postgres é UTC (`timestamptz` do Prisma).
- `User.timezone` (IANA, default `America/Sao_Paulo`) + `resumoDiarioHora` local ("HH:mm").
- A conversão fala↔UTC acontece **na borda** (bot/web) usando o tz do usuário; o domínio
  (`schedule-core`) recebe/emiti UTC e recebe offsets como parâmetro (funções puras, sem
  tz database embutida — ver `dates.ts`).
- Disparos de lembrete são absolutos (`startsAt - N`), portanto timezone não altera o
  resultado — o que o tz muda é "que dia é hoje" (resumo) e a exibição.

## Consequências

- Conflito/duração são triviais e corretos mesmo com DST.
- Código que formata/interpreta tempo fora da borda é bug; helper de exibição vive na web,
  parsing de intenção no bot.
- `User.timezone` inválida é impossível: validada por zod na API e na web.
