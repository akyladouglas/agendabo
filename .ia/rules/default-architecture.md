# Regra — Arquitetura (API NestJS + monorepo)

**Escopo:** todo código em `apps/api` e a fronteira entre apps/packages.

## Camadas do NestJS (obrigatória)

```
controller (fina) → service (orquestração + regra de application) → PrismaService (dados)
```

1. **Controller** só: valida entrada com **zod** (schemas de `@agendabo/contracts`), chama
   exatamente um service, mapeia erro de domínio → HTTP. Nunca: Prisma, `Date` de negócio,
   `if` de regra, LLM, Telegram SDK.
2. **Service** recebe/retorna **DTOs tipados** (contracts), orquestra casos de uso e delega
   decisão de domínio para `@agendabo/schedule-core`.
3. Repositórios: nesta escala, `PrismaService` faz o papel; se um service crescer além de
   ~300 linhas ou precisar de cache, extraia `X.repository.ts` no módulo.
4. **O handler do bot é fino** (equivalente ao controller): extrai intenção → chama service.
   Nada de regra de negócio no `modules/bot`.
5. `modules/ai/` é o **único** lugar que importa `@anthropic-ai/sdk` (eslint +
   dependency-cruiser). `shared/telegram` + `modules/bot` são os únicos com `telegraf`.
   `modules/auth/mail.service.ts` é o único com `resend`.
6. Comunicação entre módulos: via serviços **exportados** no `*.module.ts` e declarados no
   grafo `CROSS_MODULE_EDGES` de `.dependency-cruiser.cjs`. Aresta nova = linha no grafo +
   justificativa (ADR se não-óbvia).
7. Guard global `JwtAuthGuard` é **deny-by-default**; rota pública exige `@Public()` explícito.
8. Validação nas bordas é **zod** (contracts), nunca class-validator. O `ValidationPipe`
   global é passthrough (`transform: false`) por decisão registrada.
9. Jobs: fila BullMQ com **outbox pattern** — a linha em Postgres é a fonte de verdade do
   disparo; o job carries o id. Cron de resumo diário é fino (`@Cron` chama método puro
   com `now` injetável) e idempotente por usuário/dia.
10. Env: só via `ConfigService<Env, true>` tipado por `config/env.validation.ts`; nada de
    `process.env` fora do bootstrap.

## Anti-padrões (reprovação em review)

- `prisma` em controller ou no handler do bot.
- `new Date()` dentro de funções de domínio de `schedule-core` (injete `now`).
- Lógica de conflito ou de horário duplicada fora de `schedule-core`.
- Import de service de outro módulo direto por caminho (fora do grafo).
- `any` vindo do LLM sem passar por `safeParse` de contracts.
