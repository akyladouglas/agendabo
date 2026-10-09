/**
 * Mock do GlitchTip/DSN (smoke da Fase 9): recebe os envelopes `sentry_envelope`
 * dos processos, responde 200 e despeja o corpo em tools/.smoke-envelopes.log
 * (o smoke GREPA esse arquivo por e-mail/telegramId/conversacao — se o scrub
 * vazar, aparece la). Uso: node tools/error-tracker-mock.js [porta]
 */
const fs = require('fs');
const http = require('http');
const path = require('path');

const port = Number(process.argv[2] || 9099);
const dump = path.join(__dirname, '.smoke-envelopes.log');

http
  .createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      fs.appendFileSync(dump, `\n===== ${req.method} ${req.url} (${body.length}b)\n${body}\n`);
      console.log(`RECEBIDO ${req.method} (${body.length} bytes)`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
  })
  .listen(port, () => console.log(`PORTA=${port}`));
