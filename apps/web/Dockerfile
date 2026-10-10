# Web do Agendabô — build (monorepo pnpm) + Caddy servindo a SPA com proxy /api.
# Contexto de build: a RAIZ do repo. Em produção o /api é feito aqui (mesma
# origin => cookie do refresh same-site, sem cookie de terceiro).
# Build args:
#   VITE_API_URL    default /api (produção) — dev não usa este Dockerfile.
#   VITE_SENTRY_DSN opcional — tracker da web (Fase 9; ausente = desligado).
# Runtime env:
#   API_UPSTREAM host:port do serviço api (Coolify: http://<host-interno>:3001)

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/schedule-core/package.json packages/schedule-core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY . .
ARG VITE_API_URL=/api
ARG VITE_SENTRY_DSN=
ARG VITE_SENTRY_ENVIRONMENT=
ENV VITE_API_URL=$VITE_API_URL VITE_SENTRY_DSN=$VITE_SENTRY_DSN VITE_SENTRY_ENVIRONMENT=$VITE_SENTRY_ENVIRONMENT
RUN pnpm --filter @agendabo/contracts build \
 && pnpm --filter @agendabo/schedule-core build \
 && pnpm --filter @agendabo/web build

FROM caddy:2-alpine
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
ENV API_UPSTREAM=http://localhost:3001
EXPOSE 80
