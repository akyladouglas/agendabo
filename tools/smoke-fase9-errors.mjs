/**
 * Smoke do tracker da API (Fase 9, Etapa 6): dispara UMA excecao REAL com
 * identidade no corpo, com mensagem de erro UNICA por run (passa no Dedupe do
 * SDK). Truque: o zod de /auth/reset-password tem `token` + `password`; um
 * `password` invalido (sem digito) gera ZodError — e o corpo do request fica
 * anexado ao evento pelo SDK (request.data), de onde o scrub TEM que arrancar
 * e-mail/telegramId/senha. O grepe roda no arquivo do mock (.smoke-envelopes).
 */
const BASE = 'http://localhost:3001';
const EMAIL = `smoke-scrub-${Date.now()}@exemplo.com`;
const TELEGRAM = String(700000000 + (Date.now() % 99999999));
const runId = `run${Date.now()}`;

// token UNICO por run (64 hex falsos => ZodError "token de redefinicao
// invalido" com path "token") e o corpo leva e-mail/telegramId/senha — o SDK
// anexa request.data ao evento; o scrub tem que arrancar tudo.
const res = await fetch(BASE + '/auth/reset-password', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    token: (runId + 'f'.repeat(64)).slice(0, 64),
    password: 'senha-smoke-123',
    email: EMAIL,
    telegramId: TELEGRAM,
  }),
});
console.log('reset-password status =', res.status, '| run =', runId);
await new Promise((r) => setTimeout(r, 5000));
console.log('EMAIL_TESTE=' + EMAIL);
console.log('TELEGRAM_TESTE=' + TELEGRAM);
console.log('RUN=' + runId);
