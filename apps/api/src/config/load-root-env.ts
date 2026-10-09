/**
 * Carrega o .env da RAIZ no process.env (idempotente, nao pisa var ja definida —
 * comportamento default do dotenv). Os entrypoints standalone (worker/bot-main)
 * e o smoke usam isto; o ConfigModule da API ja faz o equivalente via
 * envFilePath. Em producao o env e injetado pelo ambiente e o .env nao existe:
 * o dotenv simplesmente nao encontra arquivo e nao faz nada — nunca explode.
 */
export function loadRootEnv(): void {
  // dotenv e devDependency: em producao o env vem do ambiente e o .env nao
  // existe — o config() simplesmente nao encontra arquivo e nao faz nada.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- carga tardia proposital (dev-only; producao tem env no ambiente)
  const dotenv = require('dotenv') as { config: (o: { path: string }) => unknown };
  dotenv.config({ path: '../../.env' });
}
