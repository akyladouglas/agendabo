/** Mostra o evento de erro (JSON) do ultimo envelope com event_id. */
const fs = require('fs');
const t = fs.readFileSync('tools/.smoke-envelopes.log', 'utf8');
const blocks = t.split('===== ').filter((b) => /event_id/.test(b));
const b = blocks[blocks.length - 1];
const lines = b.split('\n').filter((l) => l.startsWith('{'));
// linha 0 = envelope header, linha 2 = o item error
const rawLine = lines[2] || lines[1] || lines[0];
let ev;
try {
  ev = JSON.parse(rawLine);
} catch {
  // despejo antigo truncado — so as chaves de interesse por regex
  const m = (re) => (rawLine.match(re) || ['<ausente>'])[0];
  console.log('(evento truncado pelo despejo antigo — checagens pontuais)');
  console.log('user:', m(/"user":\{[^}]*\}/));
  console.log('request?', /"request":/.test(rawLine) ? 'PRESENTE (ruim)' : 'ausente (bom)');
  console.log('tags.process:', m(/"process":"[a-z]+"/));
  process.exit(0);
}
const view = {
  event_id: ev.event_id,
  message: ev.message,
  logentry: ev.logentry && { message: ev.logentry.message },
  exception: ev.exception && ev.exception.values && ev.exception.values[0] && {
    type: ev.exception.values[0].type,
    value: (ev.exception.values[0].value || '').slice(0, 200),
  },
  user: ev.user,
  request: ev.request,
  tags: ev.tags,
  breadcrumbs: (ev.breadcrumbs || []).length + ' items',
  extra: ev.extra,
};
console.log(JSON.stringify(view, null, 1));
