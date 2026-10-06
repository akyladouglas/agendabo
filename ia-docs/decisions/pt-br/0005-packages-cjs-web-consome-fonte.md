# 0005 — Packages compilam CJS; web consome o fonte via alias

- Status: Aceito
- Data: 2026-10-05

## Contexto

`apps/api` (Nest + ts-node runtime via `node dist`) consome `packages/*` sem bundler e
precisa de CommonJS. `apps/web` (Vite) não deve carregar CJS nem depender do build dos
packages para ter HMR nos tipos/zod.

## Decisão

- `packages/contracts` e `packages/schedule-core`: `tsc -b` para **CommonJS** em `dist/`,
  `main`/`types` apontando para dist (igual financas).
- `apps/web` resolve os packages para o **fonte `.ts`** via alias no `vite.config.ts` +
  `paths` no `tsconfig.app.json` + `include` dos fontes — os três juntos (gotcha 3).
- A API consome o `dist/` publicado do workspace (`workspace:*`), então `pnpm build` roda
  packages antes (ordem topológica do `pnpm -r`).

## Consequências

- Web nunca vê CJS; API vê JS estável e tipado.
- A alias precisa de **3 pontos sincronizados** (vite, tsconfig paths, include); qualquer
  novo package repete o trio.
- Vitest da web usa config própria (vitest 2 embute vite 5; misturar com a config do
  vite 6 quebra `vue-tsc -b`).
