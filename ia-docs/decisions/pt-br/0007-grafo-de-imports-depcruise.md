# 0007 — Grafo de imports explícito entre módulos (depcruise)

- Status: Aceito
- Data: 2026-10-05

## Contexto

O monolito modular só vale se as fronteiras forem mecânicas. ESLint sozinho não expressa
"module X só recebe service de Y", e backreference de `to` não é suportada pelo
dependency-cruiser. O financas resolve por regra de pacote; aqui o grafo é pequeno o
bastante para ser **declarado como código**.

## Decisão

- `apps/api/.dependency-cruiser.cjs` declara `CROSS_MODULE_EDGES`: para cada módulo
  destino, a lista branca de origens permitidas; regras geradas a partir dela proíbem o
  resto (import dentro do próprio módulo sempre livre; composition root/`*.module.ts`
  importam serviços exportados à vontade).
- SDK preso ao módulo dono: `@anthropic-ai/sdk` → `modules/ai`; `telegraf` →
  `shared/telegram`+`modules/bot`; `resend` → `modules/auth`.
- `pnpm lint:arch` é gate de CI/fase. Nova aresta = linha na tabela + justificativa no PR
  (e ADR se não-óbvia).

## Consequências

- "Quem pode importar quem" cabe numa tabela revisável.
- O grafo é manual; esquecemos uma aresta legítima → build quebra com mensagem apontando
  a tabela (aceitável: força a decisão ficar explícita).
