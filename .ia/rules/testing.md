# Regra — Testes

**Escopo:** todos os packages/apps. runners: jest+vitest (api), vitest (packages, web).

## Obrigatórios (não negociáveis)

1. **Conflito de agenda** e **cálculo de notificação** (schedule-core) têm testes para
   **cada** regra e cada caso-limite. Casos mínimos:
   - conflito: mesma hora; sobreposição parcial (2 lados); encostado fim==início (NÃO
     conflita); compromisso passado ignorado; `ignoreId` em edição;
   - notificação: 24h antes; 1/2/3 dias; contagem 3-2-1 (3 disparos ordenados);
     combinação livre; `none`; dedupe de equivalência (24h ≡ 1 dia); descarte de
     disparo no passado sem atrasar os demais;
   - datas: roundtrip local↔UTC; dia civil com offset negativo; semana começando na
     segunda; meia-noite local cruzando dia UTC.
2. Toda resposta do **LLM** validada por zod tem teste de parse: payload válido, payload
   com campo faltando (→ `needs_review`), confiança baixa (→ `needs_review`), campo extra
   (→ ignorado, strip).
3. Rate-limit de código (3 reenvios/30min) tem teste de janela deslizante com `now`
   injetado.

## Convenções

- Specs **co-localizadas** (`X.service.spec.ts` ao lado de `X.service.ts`).
- api: domínio puro (funções sem DI) roda no **vitest**; services Nest com mock plano
  (`jest.fn()`, sem `jest.mock` de módulo) rodam no **jest** (`*.service.spec.ts`).
- web: vitest + happy-dom; testes de view ficam em `tests/`; regra de domínio testada é
  a do package, não a cópia do componente.
- Nunca testar Prisma/BullMQ/Telegram de verdade: mock na fronteira; E2E com infra real
  é manual por fase (`docker compose up` + smoke).
- `now`/relógio sempre injetável em função de regra. Data fixa no teste, nunca
  `new Date()` solto.
- Teste que nasce depois do bug referenciia o gotcha (docs/gotchas.md) no comentário.
