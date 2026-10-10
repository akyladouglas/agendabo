# API / bot / worker do Agendabô — UMA imagem para os tres servicos (Coolify).
# Install em duas fases: 1) deps com lockfile-only (sem postinstall — o schema do
# Prisma ainda nao foi copiado); 2) apos COPY . ., pnpm install -w resolve os
# workspace links (contracts/schedule-core) e roda prisma generate. Camada de
# install cacheia enquanto o lockfile nao muda; so o build repete a cada codigo.
# Runtime = mesmo layout do Nixpacks (/app/apps/api/dist), Start Commands atuais
# continuam valendo:
#   api    -> node apps/api/dist/main.js
#   bot    -> node apps/api/dist/bot-main.js
#   worker -> node apps/api/dist/workers/notifications-worker.js
# A web tem Dockerfile proprio (apps/web/Dockerfile).
#
# Coolify: Build pack Dockerfile, Build Context `./`, Dockerfile Location `Dockerfile`.
# Migrations: prisma CLI + engines vao na imagem; Start da api pode manter
# `sh -c "cd apps/api && npx prisma migrate deploy && node dist/main.js"`.

# --- build ---
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --lockfile-only
COPY . .
# instala de verdade: workspace links + postinstall (prisma generate com schema no lugar)
RUN pnpm install --frozen-lockfile --filter @agendabo/api...
RUN pnpm --filter @agendabo/api... build

# --- runtime: source buildado + node_modules SEM devDependencies ---
FROM node:22-alpine
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production
COPY --from=build /app /app
RUN pnpm prune --prod
EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]
