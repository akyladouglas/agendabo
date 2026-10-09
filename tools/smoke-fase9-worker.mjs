/**
 * Smoke do init do tracker nos processos standalone (Fase 9, Etapa 6): sobe o
 * WORKER com REDIS_URL morta => BullMQ emite `error` e o processo para sozinho
 * (shutdown code 1 + flush do SDK). Confirma que o envelope com
 * tags.process=worker chega ao mock do DSN. Ambiente real NAO e tocado.
 */
import { spawn } from 'node:child_process';

const child = spawn('node', ['dist/workers/notifications-worker.js'], {
  cwd: 'C:/Projetos/estudos/agendabo/apps/api',
  env: {
    ...process.env,
    REDIS_URL: 'redis://127.0.0.1:6399', // porta morta de proposito
    DATABASE_URL: 'postgresql://agendabo:agendabo_dev@localhost:5434/agendabo?schema=public',
    SENTRY_DSN: 'http://smoketestpk@127.0.0.1:9099/1',
    SENTRY_ENVIRONMENT: 'smoke',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (out += d));
const killer = setTimeout(() => child.kill('SIGKILL'), 30000);
child.on('exit', (code, sig) => {
  clearTimeout(killer);
  console.log('tracker (worker) ativo?', /tracker de erros ativo \(worker\)/.test(out));
  console.log('crash real (Redis)?', /ECONNREFUSED 127\.0\.0\.1:6399/.test(out));
  console.log('falha logada no shutdown?', /falha nao tratada/.test(out));
  console.log('saida do filho (últimos 600c):\n' + out.slice(-600));
  console.log('code/sig:', code, sig);
});
