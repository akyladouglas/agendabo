# Deploy (Coolify) — o que criar e como

O repo é um monorepo pnpm com **3 processos** que precisam rodar ao mesmo
tempo e **zero Dockerfiles** — a infra de prod (Coolify 4.x) precisa fornecer:

| Processo   | O que é                                                                           | Porta   |
| ---------- | --------------------------------------------------------------------------------- | ------- |
| `api`      | API NestJS (`node apps/api/dist/main.js`)                                         | 3001    |
| `worker`   | worker de lembretes/resumo (`node apps/api/dist/workers/notifications-worker.js`) | —       |
| `bot`      | bot Telegram (`node apps/api/dist/bot-main.js`)                                   | —       |
| `web`      | SPA estática (`apps/web/dist`, Vue buildada)                                      | 80      |
| `postgres` | Postgres 16 (serviço do Coolify)                                                  | interno |
| `redis`    | Redis 7 (serviço do Coolify)                                                      | interno |

**Build** (qualquer build pack que respeite o pnpm do lockfile — nixpacks ou
Dockerfile próprio):

```
pnpm install --frozen-lockfile
pnpm -r build            # contracts -> schedule-core -> api (nest) -> web (vite)
```

**Migrations no deploy:** `scripts/deploy-migrate.sh` (hook de deploy — ver
abaixo). Ele roda `prisma generate` + `prisma migrate deploy` e é idempotente
(nunca recria tabela).

## Variáveis de produção (uma "environment" no Coolify para todos os serviços)

```env
# API
API_PORT=3001
NODE_ENV=production
WEB_ORIGIN=https://SEU-DOMINIO-DA-WEB        # CORS — exatamente o origin do browser
DATABASE_URL=postgresql://agendabo:<senha-forte>@<host-do-postgres>:5432/agendabo?schema=public
REDIS_URL=redis://:<senha-redis>@<host-do-redis>:6379

# Auth
JWT_SECRET=<>=16 chars, aleatorio>
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL_DAYS=30

# Telegram
TELEGRAM_BOT_TOKEN=<token do BotFather>

# Resend (email de cadastro)
RESEND_API_KEY=re_xxx
RESEND_FROM=Agendabô <no-reply@agendabo.SEU-DOMINIO>

# LLM
ANTHROPIC_API_KEY=sk-ant-xxx
LLM_MODEL_PRIMARY=claude-haiku-4-5-20251001
LLM_MODEL_ESCALATION=claude-sonnet-5-5
MIN_CONFIDENCE_TO_ACCEPT=0.7
BOT_SESSION_TTL_MINUTES=30

# Notificações (worker)
NOTIFY_MAX_ATTEMPTS=3
NOTIFY_STALE_MINUTES=30

# Observabilidade (Fase 9)
SENTRY_DSN=http://<public-key>@<host-glitchtip>/<projeto>   # sem isto: tracker desligado
SENTRY_TRACES_SAMPLE_RATE=0
SENTRY_ENVIRONMENT=production
EVENTS_HASH_SECRET=<>=16 chars, ALEATORIO, DIFERENTE do JWT_SECRET>
LLM_PRICE_INPUT_USD_PER_MTOK=1000000
LLM_PRICE_OUTPUT_USD_PER_MTOK=5000000
```

A web NÃO precisa de env em runtime (o `VITE_API_URL` default é `/api` via
proxy de dev — em produção o proxy fica no Coolify, ver domínio).

## Checklist no Coolify (v4.4.x)

1. **Recursos**: `+ Resource` → **Postgres** (serviço do Coolify, senhas dele)
   e **Redis** (serviço do Coolify). Anote as URLs internas deles.
2. **App**: conecte o repo `akyladouglas/agendabo`, branch `main`. Crie **um
   serviço por processo** (a mesma imagem serve para api/worker/bot):
   - Build pack: **Nixpacks** (Base directory `/` — o `packageManager` do
     package.json puxa pnpm 9 e o `.nvmrc` puxa Node 22), ou Dockerfile próprio
     (a criar — o repo ainda não tem).
   - Install command: `pnpm install --frozen-lockfile`
   - Build command: `pnpm -r build`
   - Start command:
     - api → `node apps/api/dist/main.js`
     - worker → `node apps/api/dist/workers/notifications-worker.js`
     - bot → `node apps/api/dist/bot-main.js`
3. **Env**: cole o bloco acima em **Environment Variables** — melhor na raiz do
   recurso (uma env compartilhada) ou repetida nos 3 serviços + web. **Build
   time + runtime** ligados para as variáveis usadas no build da web.
4. **Domínios**:
   - api → `https://api.SEU-DOMINIO` (expondo a porta 3001)
   - web → `https://SEU-DOMINIO` (porta 80 do nginx da imagem)
5. **Proxy da web** (essencial — a web chama `/api`): no domínio da web, aba
   **Features → Proxy → Custom Nginx Configuration**, adicionar no server:
   ```nginx
   location /api/ {
       proxy_pass http://<nome-do-servico-api-na-rede-interna>:3001/;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
   }
   ```
   O `WEB_ORIGIN` da API deve ser `https://SEU-DOMINIO-DA-WEB` (com CORS e
   cookies same-site o refresh funciona sem cookies cross-site).
6. **Hook de deploy** (migrations): nos 3 serviços api/worker/bot, **Features →
   Deploy Hook → Run script before the deployment**:
   ```
   sh /app/scripts/deploy-migrate.sh
   ```
   O script acha o node sozinho (PATH → scan do `/nix/store` da imagem → último
   recurso `/proc`). Se um dia ele não achar, o log diz o comando para rodar à
   mão. Rode no **api** primeiro (é o que precisa das tabelas novas; nos outros
   é idempotente).
7. **Persistência dos bots/worker**: nada precisa de volume além do Postgres/
   Redis do próprio Coolify (a fila é Redis; sessões do bot são memória por
   design da fase).

## Primeiro boot (na ordem)

1. Subir Postgres + Redis (o Coolify cria).
2. Deploy api → hook roda `prisma migrate deploy` (cria `users` etc.) →
   `node dist/main.js` sobe.
3. Deploy web → acesse `https://SEU-DOMINIO/cadastro` e **crie sua conta**:
   o **primeiro usuário do sistema nasce admin automaticamente** (regra D-P7 /
   ADR-0017) — e é pelo painel admin (`PATCH /admin/users/:id/observabilidade`)
   que o rollout do `/bot-events` liga por usuário. O e-mail de confirmação sai
   pelo Resend (o `RESEND_FROM` precisa de domínio verificado lá).
4. Deploy worker + bot (mesma imagem, start command diferente).
5. Smoke de produção: `GET /bot-events` como admin → 200; no GlitchTip, um
   `captureTest` opcional via `pnpm --filter @agendabo/api exec node tools/...`.

## Armadilhas conhecidas (docs/gotchas.md + Fase 9)

- `DATABASE_URL`/`REDIS_URL` devem apontar para os hosts **internos** dos
  serviços do Coolify (o host que ele te dá, ex.: `coolify-db`/porta interna),
  nunca `localhost`.
- `EVENTS_HASH_SECRET` < 16 chars derruba o boot no zod (seguro, mas irritante).
- `SENTRY_DSN` sem public-key no path → SDK loga "Invalid Sentry Dsn" e não
  envia (o resto do app segue normalmente).
- O bot só atende telegramIds cadastrados com e-mail **confirmado** — para o
  smoke do bot, primeiro confirme o e-mail pelo link do Resend.
