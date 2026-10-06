/**
 * Textos do bot em PT-BR (Fase 1) — centralizados aqui (plano etapa 5).
 * Tom informal do PROMPT.md. Os `{...}` sao preenchidos pelo SchedulingFlowService
 * sempre com dados ja formatados no timezone do usuario (ADR-002).
 * Revisao final das strings: humano, no PR (decisao de produto #1 da spec).
 */

/** Palavras aceitas como "sim" / "nao" nas perguntas de sim-ou-nao do fluxo. */
const YES_WORDS = [
  'sim',
  's',
  'yes',
  'pode',
  'confirma',
  'confirmar',
  'confirmo',
  'isso',
  'ok',
  'beleza',
  'certo',
  'anotar',
  'lembrar',
];
const NO_WORDS = ['nao', 'n', 'no', 'negado', 'sem', 'depois', 'agora nao', 'nenhuma'];

function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.!?,;:]+$/g, '')
    .trim();
}

/** Resposta de sim/nao determinística; `null` = entendeu nada (quem chama re-pergunta). */
export function parseYesNo(text: string): boolean | null {
  const t = normalize(text);
  if (!t) return null;
  // fala de desistencia (spec 13) conta como "sim" para descartar o fluxo
  if (givesUp(text)) return true;
  const head = t.split(/\s+/)[0] ?? '';
  if (YES_WORDS.includes(t) || YES_WORDS.includes(head)) return true;
  if (NO_WORDS.includes(t) || NO_WORDS.includes(head)) return false;
  return null;
}

/** Desistência por fala natural ("deixa pra lá", "melhor não", "para") — spec 13. */
export function givesUp(text: string): boolean {
  const t = normalize(text);
  return (
    /deixa (pra l[a]?|pr[a]? l[a]|pra la)/.test(t) ||
    /deixa quieto/.test(t) ||
    /melhor n[a]o/.test(t) ||
    /^(para|para tudo|chega|desiste(r)?i?|abandona)/.test(t)
  );
}

/** Prefixo "anotar:" (criterio de aceite da regra 5 da spec) — removido da nota salva. */
export const NOTES_PREFIX_RE = /^(anotar|anota|nota|obs|observaç[õa]es?)\s*(?::|-)?\s*/i;

/** Texto de nota do usuario: "não" -> null; "anotar: X" -> "X" (spec #5). */
export function parseNotesAnswer(text: string): string | null {
  const t = text.trim();
  if (parseYesNo(t) === false) return null;
  const stripped = t.replace(NOTES_PREFIX_RE, '').trim();
  return stripped.length > 0 ? stripped : t;
}

/** Escapa texto dinâmico p/ parse_mode HTML do Telegram (gotcha 6). */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const BOT_MESSAGES = {
  /** Regra 1 — chat nao cadastrado/sem email confirmado: so orientacao de cadastro. */
  cadastroNecessario:
    'Oi! Eu sou o Agendabô👋\n\n' +
    'Para eu funcionar, primeiro passa no site e cria sua conta para que eu possa funcionar.' +
    ' Depois de criar a conta, volta aqui que a gente começa a organizar sua agenda. 😉',

  /** Regra 2 — intencao fora do escopo / duvidosa: resposta padrao, nada e criado. */
  fallback:
    'Hmm, acho que isso eu ainda não sei resolver 😅\n\n' +
    'Se quiser marcar um compromisso, é só dizer algo como "quero marcar uma consulta".',

  /** Regra 2/13 — classificacao duvidosa: pergunta em vez de agir no chute. */
  pediuEsclarecimento: 'Hmm, não tenho certeza se entendi 🤔... O que você gostaria de fazer aqui?',

  /** Regra 13 — confianca baixa num cancelar: confirma antes de descartar. */
  confirmarCancelamento: 'Quero cancelar este compromisso, certo? (sim / não)',

  /** Decisao de produto #9 — criar com fluxo aberto: pergunta antes de descartar. */
  confirmarSubstituicao:
    'Você já tem um compromisso em andamento aqui.\n\n' +
    'Quer descartar ele e começar um novo? (sim / não)',

  /** Etapa (a) — titulo. */
  pedeTitulo: 'Bora marcar! 📅 Como eu chamo esse compromisso?',

  /** Etapa (b) — dia do inicio. */
  pedeDia: (titulo: string) => `Certo, "${titulo}"! Em que dia vai ser?`,

  /** Rotulo do atalho deterministico hoje/amanha (spec decisao #7). */
  hojeLabel: 'Hoje',
  amanhaLabel: 'Amanhã',

  /** Rotulo de data "dd/mm" (dd/mm/aaaa quando cai fora do ano corrente). */
  diaLabel: (dia: { year: number; month: number; day: number }, currentYear: number) =>
    `${String(dia.day).padStart(2, '0')}/${String(dia.month).padStart(2, '0')}` +
    (dia.year === currentYear ? '' : `/${dia.year}`),

  /** Etapa (b) — hora do inicio. */
  pedeHora: (diaLabel: string) => `No dia ${diaLabel}, que horas começa? (ex.: 14:30)`,

  /** Etapa (c) — fim ou duracao (decisao de produto #10: nunca inventar 1h). */
  pedeFim: 'Perfeito! Que horas termina? Ou me diz a duração (ex.: "1h30" ou "15min").',

  /** Regra 12 — fim <= inicio: re-pergunta com erro, nada e descartado. */
  erroHorarioInvalido: 'Opa, o fim precisa ser depois do início 😅 Me diz de novo o horário?',

  /** Regra 7 — conflito cita o existente (1.1) + pergunta remarcar/abortar. */
  conflito: (existente: { title: string; range: string }) =>
    `Deu conflito com o que você já tem 😬\n\n` +
    `Você já tem "${existente.title}" de ${existente.range}.\n\n` +
    `Quer remarcar pra outro horário ou abortar este agendamento?`,

  /** Decisao de produto #4 — passou de 3 tentativas de remarcar. */
  conflitoLimiteAtingido:
    'Já tentamos bastante horário, hein 😅\n\n' +
    'Se quiser, eu abortamos este agendamento por ora — ou me passa mais um horário pra eu tentar.',

  /** Regra 11 — abortar: nada e salvo. */
  abortado: 'Beleza, agendamento abortado. Nada foi salvo. Quando quiser, é só chamar! ✌️',

  /** Regra 13 — cancelar/desistir: estado descartado, nada salvo. */
  cancelado:
    'Sem problema, pode deixar pra lá — cancelei aqui e nada foi salvo. Quando quiser, é só chamar! 👋',

  /** Regra 5 (1.3) — pergunta por notas. */
  pedeNotas: (resumo: string) =>
    `Anotado: ${resumo}\n\n` +
    `Tem alguma informação importante pra eu anotar nesse compromisso? ` +
    `(Se não, responde "não")`,

  /** Regra 6 — resumo unico final (decisao de produto #3) + confirmar/alterar. */
  resumoFinal: (resumo: string, notas: string) =>
    `Fechando então:\n\n` +
    `📌 ${resumo}\n` +
    `📝 ${notas}\n\n` +
    `Confirmo? (confirmar / alterar)`,

  /** Regra 6 — criacao ok: confirma citando titulo e horario no tz do usuario. */
  criado: (titulo: string, range: string) => `Prontinho! Criei "${titulo}" de ${range} ✅`,

  /** Alterar no resumo final: o que mudar? */
  alterarPergunta: 'Tranquilo, o que você quer alterar? (título, dia, horário, duração ou notas)',

  /** Regra 12/ajuste: "depois de um alterar" re-pergunta mantendo o passo. */
  perdoaRepetido: 'Beleza, continua por aqui então 🙂 ',

  /** Alterar: para onde voltar. */
  alterarMapa: {
    titulo: 'titulo',
    dia: 'dia',
    horario: 'hora',
    hora: 'hora',
    duracao: 'fim',
    fim: 'fim',
    nota: 'notas',
    notas: 'notas',
  } as Record<string, 'titulo' | 'dia' | 'hora' | 'fim' | 'notas'>,

  /** Nao entendi a resposta do passo atual: re-pergunta o mesmo passo. */
  naoEntendi: 'Hmm, não entendi 🤔 ',

  /** Resposta de alterar fora do vocabulario. */
  alterarNaoEntendido:
    'Não entendi o que alterar 🤔 Responde: título, dia, horário, duração ou notas.',
} as const;
