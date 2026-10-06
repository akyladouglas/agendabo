# AGENTS.md — Agendabô

Bot de agenda no Telegram com visão web. Fluxo principal: usuário marca compromisso conversando
com o bot (LLM interpreta, **regras determinísticas decidem**), recebe lembretes e resumo
diário, e gerencia tudo numa web (cadastro com confirmação por email, calendário, fila de
revisão).

## Leia antes de codar (ordem)

1. `PROMPT.md` — produto, modelagem e as 8 fases do roadmap.
2. `.ia/rules/` — as regras deste repo:
   - `default-architecture.md` (camadas NestJS, fronteiras de módulo),
   - `schedule-core.md` (domínio puro — a regra mais dura),
   - `llm.md` (zod na saída, confiança baixa → `needs_review`, ADR-003),
   - `testing.md` (mínimos obrigatórios), `vue.md`, `documentation.md`, `plans.md`.
3. `ia-docs/architecture/architecture-overview.md` + ADRs em `ia-docs/decisions/pt-br/`.
4. `docs/gotchas.md` — armadilhas conhecidas.

## Comandos

```bash
pnpm install
pnpm infra:up            # Postgres 16 (5434) + Redis 7 (6381) via docker compose
pnpm build               # -r: contracts → schedule-core → api → web
pnpm test                # vitest (packages, api domínio, web) + jest (services Nest)
pnpm lint && pnpm lint:arch
pnpm --filter @agendabo/api prisma:migrate   # requer .env com DATABASE_URL
pnpm dev:api             # API em :3001  | pnpm dev:web  # web em :5174
pnpm sync:ia             # propaga .ia/ → pontas (.claude/, .opencode/, CLAUDE.md)
```

## Invariantes do produto (não violar sem ADR)

- O **bot só atende** telegramIds cadastrados com email confirmado.
- **Conflito/notificação/data = `schedule-core`** (determinístico, testado). O LLM só
  extrai candidatos; parse falho ou confiança < `MIN_CONFIDENCE_TO_ACCEPT` → `needs_review`.
- Datas em **UTC** no banco; timezone por usuário aplicado na borda.
- Cadastro: código de 6 dígitos por email (Resend), **3 reenvios/30min** persistido.
- Zod (`@agendabo/contracts`) em toda borda: API, respostas do LLM, formulários.
- Nenhuma lógica de negócio em controller ou handler do bot.
- Segredos só em `.env` (raiz). Nunca commitar `.env`.

## Fluxo de trabalho com IA

- Toda **feature** → spec antes do código (`.ia/specs/<domínio>/`), todo **plano** multi-etapa
  → `ia-docs/plans/<feature>.plan.md` (formato em `plans.md`), toda **decisão não-óbvia** →
  ADR. Edite apenas a fonte canônica `.ia/` e rode `pnpm sync:ia`.
- Fim de fase do roadmap: build+test+lint+lint:arch verdes, specs/planos atualizados, ADRs
  novos registrados, e deparo para o humano antes da fase seguinte.
