/** Quantos envelopes e se algum tem tag de worker (smoke Etapa 6). */
const fs = require('fs');
const t = fs.readFileSync('C:/Projetos/estudos/agendabo/tools/.smoke-envelopes.log', 'utf8');
console.log('evento com tag worker?', /worker/.test(t));
console.log('envelopes:', (t.match(/===== /g) || []).length);
