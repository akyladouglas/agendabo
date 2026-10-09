/** Grepe final: identidade plantada no crash do worker NAO pode estar no envelope. */
const fs = require('fs');
const t = fs.readFileSync('C:/Projetos/estudos/agendabo/tools/.smoke-envelopes.log', 'utf8');
const checks = [
  ['NAO vazou o e-mail do crash do worker', !/worker-crash-\d+@exemplo\.com/.test(t)],
  ['NAO vazou o telegramId do crash (9+8 digitos)', !/\b9\d{8}\b/.test(t)],
  ['NAO vazou a senha plantada (hunter3)', !/hunter3/.test(t)],
  ['evento do worker PRESENTE (tag process=worker)', /"process":"worker"/.test(t)],
  ['algum e-mail cru em QUALQUER envelope', false],
];
checks[4][1] = !/[a-z0-9._%+-]+@[a-z0-9-]+\.[a-z]{2,}/i.test(t.replace(/sentry_key=\S+/gi, ''));
let fail = 0;
for (const [name, ok] of checks) {
  if (!ok) fail++;
  console.log(`${ok ? 'OK ' : 'FALHA'} ${name}`);
}
console.log(fail === 0 ? 'SMOKE-SCRUB-WORKER: TODOS OS CHECKS OK' : `SMOKE-SCRUB-WORKER: ${fail} FALHAS`);
