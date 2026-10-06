# Regras de teste do Agendabô (detalhe por app)

Resumo obrigatório em `.ia/rules/testing.md`; aqui o operacional.

| Onde                     | Runner                     | Config                        | Roda com                           |
| ------------------------ | -------------------------- | ----------------------------- | ---------------------------------- |
| `packages/*`             | vitest                     | `vitest.config.ts` do package | `pnpm --filter <pkg> test`         |
| `apps/api` domínio puro  | vitest                     | `apps/api/vitest.config.ts`   | `pnpm --filter @agendabo/api test` |
| `apps/api` services Nest | jest (`*.service.spec.ts`) | `apps/api/jest.config.js`     | idem (roda os dois)                |
| `apps/web`               | vitest + happy-dom         | `apps/web/vitest.config.ts`   | `pnpm --filter @agendabo/web test` |

Política:

- Os **mínimos obrigatórios** (conflito, notificação, datas, quota, parsing LLM) estão
  listados na regra; PR que mexe nessas áreas sem os testes correspondentes é reprovado.
- E2E com infra real é **manual por fase** (docker compose + smoke dos fluxos), não no CI
  de testes unitários.
- Cobertura não tem meta numérica; tem **lista de casos**. O revisor de testes (agent
  `review-testes`) confere a lista, não o percentual.
