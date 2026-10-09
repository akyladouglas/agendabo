/**
 * Smoke da Fase 9 (observabilidade) contra a API em :3001.
 * Roteiro:
 *  1. signup user A (primeiro do sistema => admin) + user B (nao-admin);
 *  2. confirma os dois via codigo no banco (prisma direto? NAO — usa o token de
 *     confirmacao? aqui usamos UPDATE via prisma do repo);
 *  3. login A e B; PATCH rollout ON em B;
 *  4. B (sem flag) GET /bot-events => 404; A (admin) => 200;
 *  5. A GET /llm-usage => 200; B => 403;
 *  6. B com flag ON => 200 so com os proprios.
 * As senhas/codigos sao deterministicos o bastante para o dev-db.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

// DATABASE_URL do .env da raiz (o prisma client nao le .env sozinho aqui)
const envLine = readFileSync(new URL('../.env', import.meta.url), 'utf8').match(
  /^DATABASE_URL=(.*)$/m,
);
process.env.DATABASE_URL = envLine?.[1];

const BASE = 'http://localhost:3001';
const require = createRequire('file:///C:/Projetos/estudos/agendabo/apps/api/');
const { PrismaClient } = require('@prisma/client');
const results = [];
function check(name, cond, extra) {
  results.push(`${cond ? 'OK ' : 'FALHA'} ${name}${extra ? ' :: ' + extra : ''}`);
}

async function api(path, opts = {}, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  const res = await fetch(BASE + path, { ...opts, headers });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* vazio */
  }
  return { status: res.status, body };
}

async function main() {
  const prisma = new PrismaClient();
  const stamp = Date.now();
  const emailA = `smoke-a-${stamp}@exemplo.com`;
  const emailB = `smoke-b-${stamp}@exemplo.com`;
  const senha = 'senha-smoke-123';

  // limpa qualquer resquício
  await prisma.user.deleteMany({ where: { email: { in: [emailA, emailB] } } });

  // 1) signup A (espera virar admin porque NAO ha admin no dev? — se houver,
  //    o teste de primeiro-admin real exige banco limpo; aqui SÓ registramos)
  const sa = await api('/auth/signup', { method: 'POST', body: JSON.stringify({ email: emailA, password: senha, telegramId: String(900000 + (stamp % 99999)) }) });
  check('signup A 201/200/201', sa.status < 300, `status=${sa.status} ${JSON.stringify(sa.body).slice(0, 120)}`);
  const sb = await api('/auth/signup', { method: 'POST', body: JSON.stringify({ email: emailB, password: senha, telegramId: String(800000 + (stamp % 99999)) }) });
  check('signup B', sb.status < 300, `status=${sb.status}`);

  // confirma os dois pelo banco (o codigo esta la; mais simples: setar confirmado)
  await prisma.user.updateMany({ where: { email: { in: [emailA, emailB] } }, data: { emailConfirmedAt: new Date() } });

  const adminCount = await prisma.user.count({ where: { isAdmin: true } });
  const userA = await prisma.user.findUnique({ where: { email: emailA }, select: { isAdmin: true, id: true } });
  const userB = await prisma.user.findUnique({ where: { email: emailB }, select: { isAdmin: true, id: true } });
  check('isAdmin presente (A e B)', typeof userA.isAdmin === 'boolean' && typeof userB.isAdmin === 'boolean', `adminCount=${adminCount} A=${userA.isAdmin} B=${userB.isAdmin}`);
  check('B nunca nasce admin', userB.isAdmin === false);

  // login
  const la = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: emailA, password: senha }) });
  check('login A', [200, 201].includes(la.status) && la.body?.accessToken, `status=${la.status}`);
  const tokenA = la.body?.accessToken;
  const lb = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: emailB, password: senha }) });
  const tokenB = lb.body?.accessToken;
  check('login B', [200, 201].includes(lb.status) && tokenB, `status=${lb.status}`);
  check('sessao expoe isAdmin', typeof la.body?.user?.isAdmin === 'boolean', JSON.stringify(la.body?.user));

  const adminToken = userA.isAdmin ? tokenA : (await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: emailA, password: senha }) })).body?.accessToken;
  // garante um token ADMIN: se A nao e admin, usa o admin existente? NAO — sem
  // senha do admin existente o smoke usa A; entao exige que A seja admin via
  // update administrativo LOCAL (simula o futuro painel):
  if (!userA.isAdmin) {
    await prisma.user.update({ where: { id: userA.id }, data: { isAdmin: true } });
    const la2 = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: emailA, password: senha }) });
    check('login A (agora admin)', la2.status === 200 && la2.body?.user?.isAdmin === true, 'isAdmin da sessao=true');
  }
  const adminTok = (await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: emailA, password: senha }) })).body?.accessToken;

  // 2) B SEM flag: GET /bot-events => 404
  const r1 = await api('/bot-events', {}, tokenB);
  check('B sem flag GET /bot-events => 404', r1.status === 404, `status=${r1.status}`);

  // 3) A (admin) => 200
  const r2 = await api('/bot-events', {}, adminTok);
  check('admin GET /bot-events => 200', r2.status === 200 && Array.isArray(r2.body?.items), `status=${r2.status}`);

  // 4) llm-usage: A 200, B 403
  const r3 = await api('/llm-usage', {}, adminTok);
  check('admin GET /llm-usage => 200', r3.status === 200 && Array.isArray(r3.body?.buckets), `status=${r3.status} ${JSON.stringify(r3.body).slice(0, 120)}`);
  const r4 = await api('/llm-usage', {}, tokenB);
  check('B GET /llm-usage => 403', r4.status === 403, `status=${r4.status}`);

  // 5) PATCH rollout em B (admin) => 200; body .strict rejeita isAdmin
  const p1 = await api(`/admin/users/${userB.id}/observabilidade`, { method: 'PATCH', body: JSON.stringify({ observabilidadeEventosAtivo: true }) }, adminTok);
  check('PATCH rollout B => 200', p1.status === 200 && p1.body?.observabilidadeEventosAtivo === true, `status=${p1.status}`);
  const p2 = api('/admin/users/' + userB.id + '/observabilidade', { method: 'PATCH', body: JSON.stringify({ observabilidadeEventosAtivo: true, isAdmin: true }) }, adminTok);
  check('PATCH rollout com isAdmin => 400', (await p2).status === 400, `status=${(await p2).status}`);
  const p3 = await api(`/admin/users/${userB.id}/observabilidade`, { method: 'PATCH', body: JSON.stringify({ observabilidadeEventosAtivo: true }) }, tokenB);
  check('B (nao-admin) PATCH => 403', p3.status === 403, `status=${p3.status}`);

  // 6) B COM flag: 200, so proprios (sem userId por linha)
  const r5 = await api('/bot-events', {}, tokenB);
  check('B com flag GET /bot-events => 200', r5.status === 200, `status=${r5.status}`);
  const rows = r5.body?.items ?? [];
  check('linha do rollout sem campo userId', rows.every((i) => !('userId' in i)), `${rows.length} itens`);

  // query proibida (state de form) => 400
  const r6 = await api('/bot-events?search=texto+livre+do+form', {}, adminTok);
  check('query com campo desconhecido => 400', r6.status === 400, `status=${r6.status}`);

  // cleanup
  await prisma.botEvent.deleteMany({ where: { userId: { in: [userA.id, userB.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  await prisma.$disconnect();

  console.log(results.join('\n'));
  const fail = results.filter((r) => r.startsWith('FALHA'));
  console.log(fail.length === 0 ? 'SMOKE-ROTAS: TODOS OS CHECKS OK' : `SMOKE-ROTAS: ${fail.length} FALHAS`);
}

main().catch((e) => {
  console.error('SMOKE ABORTOU:', e);
  process.exit(1);
});
