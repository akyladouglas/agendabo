#!/bin/sh
set -eu

# Migracao do schema no deploy (Fase 9: sem isto, tabela nova so existe no dev).
# `prisma migrate deploy` nunca re-cria tabela existente: aplica so o que falta.
#
# Como o node e localizado no container de deploy (a imagem nixpacks nao tem
# curl, e o container do servico fica pausado durante o build):
#  1. PATH normal (funciona em imagem com node ou em teste local);
#  2. senao: scan em /nix/store pelo node do MESMO major do .nvmrc — o deploy
#     roda o script dentro do container da imagem da build, onde o node do
#     nixpacks existe em /nix/store mesmo com o servico pausado;
#  3. senao: deriva do `node` visivel no /proc (mesmo container de servico).
# Se nada achar, o erro no log diz para rodar a migracao manualmente.

cd /app
cd apps/api

if command -v node >/dev/null 2>&1; then
  npx prisma generate
  npx prisma migrate deploy
  exit 0
fi

# (2) scan em /nix/store (imagem nixpacks do proprio app; major pin=22)
NEED_MAJOR=$(sed 's/[^0-9]//g' /app/.nvmrc 2>/dev/null || echo 22)
FOUND=""
for d in /nix/store/*/bin/node; do
  [ -x "$d" ] || continue
  v=$("$d" --version 2>/dev/null | sed 's/v\([0-9]*\).*/\1/' || true)
  if [ "$v" = "$NEED_MAJOR" ]; then FOUND="$d"; break; fi
done

# (3) ultimo recurso: node vivo em algum processo do host do container
if [ -z "$FOUND" ]; then
  for pid in $(ls /proc | grep -E '^[0-9]+$' 2>/dev/null); do
    exe=$(readlink -f "/proc/$pid/exe" 2>/dev/null || true)
    case "$exe" in
      */node) FOUND="$exe"; break ;;
    esac
  done
fi

if [ -z "$FOUND" ]; then
  echo "deploy-migrate: node nao encontrado no container de deploy." >&2
  echo "deploy-migrate: rode manualmente (mesmo repo + .env):" >&2
  echo "  cd apps/api && npx prisma generate && npx prisma migrate deploy" >&2
  exit 1
fi

export PATH="$(dirname "$FOUND"):$PATH"
npx prisma generate
npx prisma migrate deploy
