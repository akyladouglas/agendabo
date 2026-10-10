# Primeiro deploy no Coolify — o que realmente funcionou (2026-10-10)

Complemento REAL do `docs/deploy-coolify.md`: o que deu errado no primeiro
deploy e as soluções que funcionaram. Leia os dois juntos.

## Configuração que pegou (API)

| Campo          | Valor                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| Build pack     | **Nixpacks** (Railpack também existe, mas o guia usa Nixpacks)                                                      |
| Base directory | `/`                                                                                                                 |
| Install        | `pnpm install --frozen-lockfile`                                                                                    |
| Build          | `pnpm -r build`                                                                                                     |
| Start          | `node apps/api/dist/main.js`                                                                                        |
| Port to expose | `3001`                                                                                                              |
| Build var      | `NIXPACKS_NODE_VERSION=22`                                                                                          |
| Domínio        | `https://api-agendabo.akyla-douglas.dev` → registro **A** `api` → `2.28.39.84` no Cloudflare (DNS only/nuvem cinza) |

**Nota do banco:** o Postgres 18 do Coolify serve normalmente (Prisma 6.19 é
compatível). O único SQL cru do repo (`appointments.service.ts` com
`FOR UPDATE`) funciona igual no 16 e no 18.

## Armadilha 1 — build quebrava com 129 erros do Prisma

**Sintoma:** `nest build` falha com
`Module '@prisma/client' has no exported member 'Prisma'` / `Property 'user' does not exist on type 'PrismaService'`.

**Causa:** nenhum passo do build rodava `prisma generate` — o
`@prisma/client` ficava o esqueleto vazio.

**Correção (feita no repo, commit `8ab2299`):** `postinstall` no `apps/api`
roda `prisma generate` automaticamente em todo install. Nada a fazer no
Coolify.

## Armadilha 2 — Terminal diz "Terminal unavailable"

**Causa:** o Terminal do Coolify só funciona com container **Running**. Se o
boot morre (ex.: banco sem tabelas), você não tem terminal para consertar o
banco (ovo-e-galinha).

**Correção (truque do sleep):** temporariamente, Start Command:

```sh
sh -c "cd /app/apps/api && npx prisma migrate deploy && sleep 999999"
```

Deploy → container fica Running (dormindo) → Terminal libera → rode o migrate
(ou o que precisar) → Runtime Logs mostra o resultado. Depois volta o Start
para o normal e dá Deploy de novo.

## Armadilha 3 — `P1001: Can't reach database server at 'agendabo-postgres:5432'`

**Causa REAL aqui:** os containers subiram na network `bridge` padrão do
Docker. Alias de network (`--network-alias agendabo-postgres`) **só resolve
em network custom** — na bridge a DNS de nomes não existe. (Não era SSL, não
era senha: `wget http://host:5432` também não prova nada com Postgres.)

**Diagnóstico que fechou a questão** (terminal do servidor, não do container):

```sh
docker network ls                      # só bridge/coolify/host/none = sem network custom
docker ps --format '{{.Names}}'        # nomes reais dos containers
docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' <container-do-postgres>
# teste cru de porta DE DENTRO da api (bash /dev/tcp):
docker exec <container-da-api> sh -c 'timeout 3 bash -c "cat < /dev/null > /dev/tcp/IP_DO_PG/5432" && echo PORTA_ABERTA || echo FALHOU'
```

**Correção que usamos:** apontar o `DATABASE_URL` para o **IP da bridge** do
Postgres:

```
postgresql://postgres:<senha>@10.0.1.11:5432/agendabo?schema=public
```

⚠️ **Risco do IP fixo:** o IP pode mudar se o container do banco for
recriado (rebuild/deploy do serviço Postgres). Se um dia a API voltar com
`Can't reach database server` e a senha estiver certa, **reconfira o IP** com
o `docker inspect` acima.

**Correção robusta (fazer quando possível):** criar uma network e amarrar os
dois serviços nela. No Coolify, serviço Postgres e serviço API →
**Advanced → Networks** → mesma network (ex.: a `stretchable` do projeto) →
Deploy dos dois. Aí o hostname interno do Coolify (aquele `<hash>.<porta>` da
aba Domains do serviço do banco) passa a resolver e você troca o IP pelo nome
— sem risco de IP mudar nunca mais.

## Armadilha 4 — `P1000: Authentication failed for 'postgres'`

**Causa:** senha na URL com caractere errado na cópia (a real tinha `O`
maiúsculo; a URL tinha `0` zero).

**Correção:** copiar a senha do serviço Postgres → **General → Credentials →
Password** (olhinho 👁) em vez de digitar/ler de print. Se algum dia trocar a
senha lá, atualize o env da API no mesmo minuto.

## Rotina: ALTEREI AS TABELAS — o que fazer (sempre)

Sempre que você mudar o `prisma/schema.prisma` (coluna/tabela/índice novo):

1. **Local (dev):** criar a migration e testar:
   ```sh
   pnpm infra:up
   pnpm --filter @agendabo/api prisma:migrate
   ```
   (pega um nome, roda contra o Postgres dev, sobe junto com o código no commit.)
2. **Commit + push:** `git add apps/api/prisma && git commit && git push`.
   Auto-deploy builda e publica a API normalmente.
3. **Aplicar a migration no banco de produção** (a 4.4.6 não tem hook de
   deploy, então é manual, 2 opções):

   **Opção A — container está Running** (mudou código, não derrubou o boot):
   serviço api → **Terminal**:

   ```sh
   cd /app/apps/api && npx prisma migrate deploy
   ```

   → restart da API.

   **Opção B — boot morre sem o schema novo** (migration obrigatória para o
   código subir): truque do sleep:
   - Start Command → `sh -c "cd /app/apps/api && npx prisma migrate deploy && sleep 999999"` → Deploy
   - lê o resultado em **Runtime Logs** (`All migrations have been successfully applied.`)
   - Start Command → `node apps/api/dist/main.js` → Deploy.

   O `migrate deploy` é **idempotente**: pode rodar de novo que não recria
   tabela nenhuma. E nunca use `prisma migrate dev/reset` em produção.

4. **Confirmação:** `https://api-agendabo.akyla-douglas.dev/health` → 200.

## Estado atual do deploy (2026-10-10)

- API: buildada, banco com TODAS as migrations aplicadas (init → fase9 →
  llm_calls_cache_tokens). Start final: `node apps/api/dist/main.js`.
- `DATABASE_URL` aponta para `10.0.1.11` (IP da bridge do Postgres) — ver
  Armadilha 3 para o upgrade para hostname estável.
- GlitchTip SaaS: projeto `agendabo`, 1 client key (sem segunda key — usar a
  mesma na web, `VITE_SENTRY_DSN`).
