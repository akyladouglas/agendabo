/**
 * Scrub de eventos do tracker (Fase 9, spec observabilidade A3/A5; ADR-0016).
 *
 * O destino e o SAAS GlitchTip — a politica de privacidade e de fornecedor
 * externo, entao a regra e paranoica por construcao: NENHUM texto de conversa,
 * nome, e-mail, telegramId ou segredo de sessao sai da maquina. `user.id`
 * (uuid interno) e o UNICO identificador permitido, e so quando autenticado
 * (e assim que o admin cruza incidentes com o Postgres sem o cliente saber
 * que existe, assimetria do ADR-0016).
 *
 * Mora no `schedule-core` (dominio puro, zero deps) para ser a POLITICA UNICA
 * dos 4 processos: api/worker/bot a importam direto e a web via alias ADR-005.
 * A funcao e PURA (evento entra, evento|null sai) — o init de cada processo so
 * pluga isto no `beforeSend` do SDK. Retornar `null` descarta o evento inteiro
 * (contrato do SDK).
 */

/** O minimo que o scrub enxerga num evento do SDK (shape estrutural). */
export interface ScrubableEvent {
  [key: string]: unknown;
  user?: Record<string, unknown> | null;
  request?: Record<string, unknown> | null;
  breadcrumbs?: unknown[] | null;
}

/** Keys cujo CONTEUDO nunca vai para o tracker (identidade/seccao/conversa). */
const FORBIDDEN_KEYS = new Set([
  // identidade direta
  'email',
  'telegramid',
  'telegram_id',
  'phone',
  'telefone',
  'name',
  'nome',
  // conteudo de conversa/conteudo de compromisso
  'text',
  'rawtext',
  'raw_text',
  'message',
  'mensagem',
  'title',
  'titulo',
  'note',
  'notes',
  'nota',
  'prompt',
  'completion',
  'response',
  'resposta',
  'excerpt',
  'transcript',
  'reply',
  // segredos/sessao
  'password',
  'senha',
  'authorization',
  'cookie',
  'cookies',
  'set-cookie',
  'secret',
  'token',
  'refresh',
  'code',
  'apikey',
  'api_key',
  'anthropic_api_key',
  'jwt_secret',
  'events_hash_secret',
  'dsn',
]);

/** Padroes de VALOR proibido dentro de strings livres (message, tags etc.). */
const VALUE_PATTERNS: Array<[RegExp, string]> = [
  // e-mails
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]'],
  // telegramId com 5+ digitos (ids reais sao longos; 5+ evita '10h' e anos)
  [/\b\d{5,}\b/g, '[id]'],
  // segredo colado em texto livre (msg de erro custom, log com interpolacao):
  // chave=valor proibida (password/senha/token/secret/apikey...)
  [/\b(password|senha|token|secret|apikey|api_key|authorization|cookie)\b\s*[=:]\s*\S+/gi, '$1=[redacted]'],
];

function scrubValue(value: string): string {
  let out = value;
  for (const [re, rep] of VALUE_PATTERNS) out = out.replace(re, rep);
  return out;
}

function isForbiddenKey(key: string): boolean {
  const k = key.toLowerCase();
  return FORBIDDEN_KEYS.has(k) || k.endsWith('_token') || k.endsWith('_secret') || k.endsWith('hash');
}

/** Varre recursivamente removendo keys proibidas e sanitizando strings. */
function scrubNode(node: unknown): unknown {
  if (typeof node === 'string') return scrubValue(node);
  if (Array.isArray(node)) return node.map(scrubNode);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (isForbiddenKey(key)) continue;
      const cleaned = scrubNode(value);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out;
  }
  return node;
}

/**
 * `beforeSend` dos 4 processos (a politica inteira mora aqui). O que sobra
 * depois do scrub e o que o GlitchTip ve. Se NAO SOBRA NADA alem de
 * identidade nua (ex.: um evento cujo unico conteudo era user.email), devolve
 * null e o evento morre aqui.
 */
export function scrubEvent(event: ScrubableEvent): ScrubableEvent | null {
  const out: ScrubableEvent = { ...event };

  // 1) request inteiro fora: headers/corps de rota sao os canos por onde a
  //    conversa do usuario e o refresh token viajam.
  delete out.request;

  // 2) user: so o uuid interno sobrevive, e so quando presente.
  if (out.user && typeof out.user === 'object') {
    const id = out.user.id;
    if (typeof id === 'string' && id.length > 0) {
      out.user = { id };
    } else {
      delete out.user;
    }
  } else if (out.user !== undefined) {
    delete out.user;
  }

  // 3) breadcrumbs: so o que sobrar depois do pente-fino recursivo.
  if (Array.isArray(out.breadcrumbs)) {
    out.breadcrumbs = out.breadcrumbs
      .map((b) => scrubNode(b))
      .filter((b) => b && typeof b === 'object' && Object.keys(b as object).length > 0);
  }

  // 4) o resto do evento (extra, tags, contexts, message...) varrido.
  for (const key of [
    'extra',
    'tags',
    'contexts',
    'message',
    'exception',
    'stacktrace',
    'threads',
    'logentry',
  ] as const) {
    if (key in out) {
      const v = scrubNode(out[key]);
      if (v === undefined || (typeof v === 'object' && v !== null && Object.keys(v).length === 0)) {
        delete out[key];
      } else {
        out[key] = v;
      }
    }
  }

  // 5) evento sem conteudo = nao existe (um evento vazio nao ajuda ninguem).
  const contentKeys = Object.keys(out).filter((k) => k !== 'event_id');
  if (contentKeys.length === 0) return null;
  return out;
}
