# Web do Agendabô — build (monorepo pnpm) + Caddy servindo a SPA com proxy /api.
# Contexto de build: a RAIZ do repo (Build Context=./ e Dockerfile Path=apps/web/Dockerfile).
# Em produção o /api é feito aqui (mesma origin => cookie do refresh same-site).
#
# Por que o install roda DEPOIS do COPY do source: o pnpm isolated e feito de
# symlinks relativos em node_modules; um `COPY . .` posterior os apaga (dir vs
# link). Fonte da verdade do install = o proprio source copiado.
#
# Build args:
#   VITE_API_URL    default /api (produção) — dev não usa este Dockerfile.
#   VITE_SENTRY_DSN opcional — tracker da web (Fase 9; ausente = desligado).
#   API_UPSTREAM host:port do serviço api, SEM esquema (Coolify: <host-interno>:3001)
#   (o Caddy rejeita placeholder com esquema no reverse_proxy)

# --- build ---
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts
ARG VITE_API_URL=/api
ARG VITE_SENTRY_DSN=
ARG VITE_SENTRY_ENVIRONMENT=
ENV VITE_API_URL=$VITE_API_URL VITE_SENTRY_DSN=$VITE_SENTRY_DSN VITE_SENTRY_ENVIRONMENT=$VITE_SENTRY_ENVIRONMENT
RUN pnpm --filter "./packages/**" --filter @agendabo/web build

# --- runtime: Caddy serve a SPA + faz proxy de /api -> API_UPSTREAM ---
FROM caddy:2-alpine
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
ENV API_UPSTREAM=localhost:3001
EXPOSE 80
