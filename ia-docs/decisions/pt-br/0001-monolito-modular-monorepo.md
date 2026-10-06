# 0001 — Monolito modular em monorepo (sem microserviços, sem turbo)

- Status: Aceito
- Data: 2026-10-05

## Contexto

Agendabô é um produto pequeno com dois runtime consumers (API/bot e web estática). O
PROMPT sugere "pnpm + turbo"; o projeto-irmão `financas` (mesma escala, mesma stack)
orquestra com `pnpm -r` e nunca sentiu falta de cache incremental. Microserviços/tráfego
de rede entre bot, regras e web só adicionaria latência e deploys.

## Decisão

- Um deployável de API (`apps/api`: HTTP Nest + bot Telegram + workers BullMQ no mesmo
  processo ou via flag), uma web estática (`apps/web`), dois packages (`contracts`,
  `schedule-core`).
- Orquestração de tasks por `pnpm -r` + `--filter`; **sem turbo.json**. Reavaliar só se o
  build passar de ~2 min.
- Modularidade é lógica (módulos Nest + grafo de imports do ADR-007), não física.

## Consequências

- Zero infra extra; CI simples (`pnpm -r build/test/lint`).
- Escalar o bot separadamente da API exige, no futuro, quebrar o processo — mas o código
  já está isolado por módulo para isso.
- Arquivos de config turbo não existem para "sincronizar" — nada a manter.
