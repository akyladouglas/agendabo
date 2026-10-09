/** Checa o que o scrub DEIXOU passar (request deve estar fora). */
const fs = require('fs');
const t = fs.readFileSync('tools/.smoke-envelopes.log', 'utf8');
console.log('request/normalized_request no corpo?', /"request":|normalized_request/.test(t) ? 'SIM (verificar se sobreviveu ao scrub)' : 'NAO (scrub cumpriu)');
console.log('runId presente?', /run1791582305552/.test(t));
console.log('senha smoke presente?', /senha-smoke-123/.test(t));
