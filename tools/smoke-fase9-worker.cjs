/**
 * Smoke do WORKER com o tracker (Fase 9, Etapa 6): sobe o worker com DSN mock,
 * mata o Redis (fora) para gerar excecao real e ve se o envelope sai com
 * tags.process=worker. Uso local de dev (para o Redis do repo de proposito).
 */
const { spawnSync } = require('node:child_process');

console.log('derrubando o Redis (docker)...');
spawnSync('docker', ['stop', 'agendabo-redis-1'], { stdio: 'inherit' });

const { Worker } = require('C:/Projetos/estudos/agendabo/node_modules/.pnpm/bullmq@5.34.10/node_modules/bullmq/dist/cjs/index.js');
process.env.DATABASE_URL = 'postgresql://agendabo:agendabo_dev@localhost:5434/agendabo?schema=public';
process.env.REDIS_URL = 'redis://localhost:6381';
process.env.JWT_SECRET = 'x'.repeat(32);
process.env.EVENTS_HASH_SECRET = 'x'.repeat(32);
process.env.LLM_PRICE_INPUT_USD_PER_MTOK = '1000000';
process.env.LLM_PRICE_OUTPUT_USD_PER_MTOK = '5000000';

// so o worker nu: bullmq tentando reconnect num Redis morto gera excecoes
const w = new Worker('smoke-morto', async () => ({}), {
  connection: { host: 'localhost', port: 6381, maxRetriesPerRequest: null },
});
w.on('failed', (job, err) => console.log('job falhou:', err.message.slice(0, 80)));
w.on('error', (err) => console.log('worker error:', err.message.slice(0, 80)));

// espera um pouco e restaura o Redis
setTimeout(() => {
  console.log('restaurando o Redis...');
  spawnSync('docker', ['start', 'agendabo-redis-1'], { stdio: 'inherit' });
  w.close().then(() => process.exit(0));
}, 8000);
