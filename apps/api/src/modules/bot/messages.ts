/**
 * Textos do bot em PT-BR (Fase 1) — centralizados aqui (plano etapa 5).
 * Tom informal do PROMPT.md. Os `{...}` sao preenchidos pelo SchedulingFlowService
 * sempre com dados ja formatados no timezone do usuario (ADR-002).
 * Revisao final das strings: humano, no PR (decisao de produto #1 da spec).
 */

/** Palavras aceitas como "sim" / "nao" nas perguntas de sim-ou-nao do fluxo. */
const YES_WORDS = [
  "sim",
  "s",
  "yes",
  "pode",
  "confirma",
  "confirmar",
  "confirmo",
  "isso",
  "ok",
  "beleza",
  "certo",
  "anotar",
  "lembrar",
];
const NO_WORDS = [
  "nao",
  "n",
  "no",
  "nada",
  "negado",
  "sem",
  "depois",
  "agora nao",
  "nenhuma",
];

function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.!?,;:]+$/g, "")
    .trim();
}

/** Resposta de sim/nao determinística; `null` = entendeu nada (quem chama re-pergunta). */
export function parseYesNo(text: string): boolean | null {
  const t = normalize(text);
  if (!t) return null;
  // fala de desistencia (spec 13) conta como "sim" para descartar o fluxo
  if (givesUp(text)) return true;
  const head = t.split(/\s+/)[0] ?? "";
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
export const NOTES_PREFIX_RE =
  /^(anotar|anota|nota|obs|observaç[õa]es?)\s*(?::|-)?\s*/i;

/**
 * Spec notas-e-fim-na-web (A2/A3, decisao humana #1): minimo de PALAVRAS NORMALIZADAS
 * para uma resposta que comeca com negacao ser FRASE REAL do usuario (nota literal) em
 * vez de negativa. Constante testavel da borda do bot — nao e regra de schedule-core.
 */
export const NOTES_MIN_PHRASE_WORDS = 4;

/**
 * Texto de nota do usuario: "nao" -> null; "anotar: X" -> "X" (spec #5).
 *
 * Correcao do bug de producao 2026-10-10 (gotcha 24): a versao antiga delegava a
 * `parseYesNo`, que casa negacao pela PRIMEIRA PALAVRA — "Nao esquecer nada na volta"
 * gravava sem nota. Regra nova (spec notas-e-fim-na-web A1-A4, decisao #1):
 *  - comeca com palavra de negacao E tem < NOTES_MIN_PHRASE_WORDS palavras
 *    normalizadas -> negativa (`null`);
 *  - comeca com negacao mas e frase (>= NOTES_MIN_PHRASE_WORDS palavras) -> nota
 *    LITERAL integral (sem limpeza alem de NOTES_PREFIX_RE — ADR-004, zero LLM);
 *  - `parseYesNo` continua o sim/nao puro de cabeca de frase (demais passos do
 *    fluxo dependem disso — NAO mexer aqui).
 */
export function parseNotesAnswer(text: string): string | null {
  const t = text.trim();
  if (startsWithNegation(t)) return null;
  const stripped = t.replace(NOTES_PREFIX_RE, "").trim();
  return stripped.length > 0 ? stripped : t;
}

/**
 * Spec notas-e-fim-na-web (A1, decisao humana #1): comeca com negacao e tem
 * < NOTES_MIN_PHRASE_WORDS palavras normalizadas -> negativa ("nao", "nao tenho
 * nada", "sem notas"). Frase real (>= 4) comecando com "nao" NAO e negativa.
 * `NO_WORDS` tambem contem multi-palavra ("agora nao") -> comparada no texto
 * normalizado inteiro, e desistencia (givesUp) conta como negativa (como em
 * `parseYesNo`).
 */
export function startsWithNegation(text: string): boolean {
  const n = normalize(text);
  if (!n) return false;
  if (givesUp(text)) return true;
  if (NO_WORDS.includes(n)) return true;
  const words = n.split(/\s+/);
  const first = words[0];
  return (
    words.length < NOTES_MIN_PHRASE_WORDS && first !== undefined && NO_WORDS.includes(first)
  );
}

/**
 * Rótulo de "desistência" da consulta ("tanto faz", "tanto", "tanto fez") —
 * análogo a `givesUp`, específico do turno de consulta (spec Fase 2 #14).
 * "tanto faz" NÃO é desistência do fluxo de criar (givesUp), só da consulta.
 */
export function givesUpQuery(text: string): boolean {
  const t = normalize(text);
  return /^(tanto faz|tanto fez|tanto)$/.test(t) || givesUp(text);
}

/** Escapa texto dinâmico p/ parse_mode HTML do Telegram (gotcha 6). */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * B2 da spec fluxo-criacao-robusto: prefixos de INTENÇÃO que nunca fazem parte de um
 * título ("tenho um novo compromisso..." ⇒ título = nada, pergunta). Lista em constante
 * testável (notas técnicas da spec) — regra determinística de borda, nunca estatística.
 */
export const INTENTION_PREFIXES = [
  "tenho",
  "tenho um",
  "quero",
  "quer",
  "marca",
  "marcar",
  "bora",
  "agenda",
  "agendar",
  "anota",
  "anotar",
] as const;

/** Normalização simples da heurística B2: trim/minúsculas/NFD sem acento/espaços comprimidos. */
function normalizeB2(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Heurística determinística B2: o `title` sugerido pelo modelo é UTILIZÁVEL?
 * `false` (⇒ título ausente, a máquina pergunta — B3) quando:
 *  - título vazio;
 *  - título ≈ a fala quase integralmente (`norm(title).length >= 0.8 × norm(fala).length`)
 *    — a frase inteira jamais vira título (B1);
 *  - título normalizado COMEÇA com um prefixo de intenção (`INTENTION_PREFIXES`,
 *    ex.: "tenho um novo compromisso") — verbo de intenção não é nome de evento.
 * Puro e testável (plano D4): quem decide o que fazer com `false` é a máquina/borda.
 */
export function usableTitle(title: string, utterance: string): boolean {
  const t = normalizeB2(title);
  if (!t) return false;
  const u = normalizeB2(utterance);
  if (t.length >= 0.8 * u.length) return false;
  return !INTENTION_PREFIXES.some((prefix) => t.startsWith(prefix));
}

export const BOT_MESSAGES = {
  /**
   * Fase 5 (decisão 7): saudação/endereçamento com o nome quando existir.
   * Sem nome (contas antigas ou usuário não informou) o fallback mantém o texto
   * vigente — o bot nunca inventa tratamento.
   */
  comNome: (
    name: string | null | undefined,
    fallback: string,
    comNome: (n: string) => string,
  ) => (name && name.trim() ? comNome(name.trim()) : fallback),

  /** Regra 1 — chat nao cadastrado/sem email confirmado: so orientacao de cadastro. */
  cadastroNecessario:
    "Oi! Eu sou o Agendabô👋\n\n" +
    "Para eu funcionar, primeiro passa no site e cria sua conta para que eu possa funcionar." +
    " Depois de criar a conta, volta aqui que a gente começa a organizar sua agenda. 😉",

  /**
   * Spec saudacao-e-start-bot A4 — menu de boas-vindas do `/start` (determinístico,
   * zero LLM). `comNome`: com nome "Oi, {nome}! 👋 ..."; sem nome o texto vigente
   * (helper nunca inventa tratamento — decisão 7 da Fase 5).
   */
  saudacaoStart: (nome: string) =>
    `Oi, ${nome}! 👋 Eu sou o Agendabô, seu assistente de agenda. Posso:\n\n` +
    `📌 Marcar compromissos — é só me contar (ex.: "marca consulta quinta 14h")\n` +
    `📖 Consultar sua agenda ("o que tenho amanhã?")\n` +
    `⏰ Te lembrar dos seus compromissos\n` +
    `✏️ Editar ou cancelar pelo chat\n\n` +
    `Manda aí o que você precisa 🙂`,

  /** Sem nome (comNome): menu do /start sem tratamento — texto vigente. */
  saudacaoStartSemNome:
    `Oi! 👋 Eu sou o Agendabô, seu assistente de agenda. Posso:\n\n` +
    `📌 Marcar compromissos — é só me contar (ex.: "marca consulta quinta 14h")\n` +
    `📖 Consultar sua agenda ("o que tenho amanhã?")\n` +
    `⏰ Te lembrar dos seus compromissos\n` +
    `✏️ Editar ou cancelar pelo chat\n\n` +
    `Manda aí o que você precisa 🙂`,

  /**
   * Spec saudacao-e-start-bot B1 — frase de abertura acolhedora no turno em que o criar
   * ABRE por fala (guiado ou atalho). Mensagem separada enviada ANTES da pergunta do
   * título / eco do extraído (decisão D3 do plano); máquina intocada.
   */
  aberturaCriar: (nome: string) =>
    `Olá, ${nome}! Entendi, vamos registrar esse compromisso 🙂`,

  /** Sem nome (comNome): frase de abertura do criar sem tratamento. */
  aberturaCriarSemNome: "Olá! Entendi, vamos registrar esse compromisso 🙂",

  /** Regra 2 — intencao fora do escopo / duvidosa: resposta padrao, nada e criado. */
  fallback:
    "Hmm, acho que isso eu ainda não sei resolver 😅\n\n" +
    'Se quiser marcar um compromisso, é só dizer algo como "quero marcar uma consulta".',

  /** Regra 2/13 — classificacao duvidosa: pergunta em vez de agir no chute. */
  pediuEsclarecimento:
    "Hmm, não tenho certeza se entendi 🤔... O que você gostaria de fazer aqui?",

  /** Regra 13 — confianca baixa num cancelar: confirma antes de descartar. */
  confirmarCancelamento: "Quero cancelar este compromisso, certo? (sim / não)",

  /** Decisao de produto #9 — criar com fluxo aberto: pergunta antes de descartar. */
  confirmarSubstituicao:
    "Você já tem um compromisso em andamento aqui.\n\n" +
    "Quer descartar ele e começar um novo? (sim / não)",

  /** Etapa (a) — titulo. */
  pedeTitulo: "Bora marcar! 📅 Como eu chamo esse compromisso?",

  /** Etapa (b) — dia do inicio. */
  pedeDia: (titulo: string) => `Certo, "${titulo}"! Em que dia vai ser?`,

  /** Rotulo do atalho deterministico hoje/amanha (spec decisao #7). */
  hojeLabel: "Hoje",
  amanhaLabel: "Amanhã",

  /** Rotulo de data "dd/mm" (dd/mm/aaaa quando cai fora do ano corrente). */
  diaLabel: (
    dia: { year: number; month: number; day: number },
    currentYear: number,
  ) =>
    `${String(dia.day).padStart(2, "0")}/${String(dia.month).padStart(2, "0")}` +
    (dia.year === currentYear ? "" : `/${dia.year}`),

  /** Etapa (b) — hora do inicio. */
  pedeHora: (diaLabel: string) =>
    `No dia ${diaLabel}, que horas começa? (ex.: 14:30)`,

  /** Etapa (c) — fim ou duracao (decisao de produto #10: nunca inventar 1h). */
  pedeFim:
    'Perfeito! Que horas termina? Ou me diz a duração (ex.: "1h30" ou "15min").',

  /**
   * Decisão 5 da spec fluxo-criacao-robusto — o atalho extraiu título+início mas NENHUM
   * fim na fala: ecoa o que entendeu (obrigatório, C1) e pergunta só o fim (zero chute).
   */
  perguntaFimAposAtalho: (resumo: string) =>
    `Entendi: ${resumo}. Que horas termina? Ou me diz a duração (ex.: "1h30" ou "15min").`,

  /**
   * C1 da spec fluxo-criacao-robusto — eco incremental do `quando_parcial`: mantém o
   * título extraído (entre aspas) e pergunta SÓ a hora do dia já resolvido.
   */
  ecoParcialHora: (titulo: string, diaLabel: string) =>
    `Entendi: "${titulo}" no dia ${diaLabel} — a que horas começa?`,

  /** Regra 12 — fim <= inicio: re-pergunta com erro, nada e descartado. */
  erroHorarioInvalido:
    "Opa, o fim precisa ser depois do início 😅 Me diz de novo o horário?",

  /** Regra 7 — conflito cita o existente (1.1) + pergunta remarcar/abortar. */
  conflito: (existente: { title: string; range: string }) =>
    `Deu conflito com o que você já tem 😬\n\n` +
    `Você já tem "${existente.title}" de ${existente.range}.\n\n` +
    `Quer remarcar pra outro horário ou abortar este agendamento?`,

  /** Decisao de produto #4 — passou de 3 tentativas de remarcar. */
  conflitoLimiteAtingido:
    "Já tentamos bastante horário, hein 😅\n\n" +
    "Se quiser, eu abortamos este agendamento por ora — ou me passa mais um horário pra eu tentar.",

  /** Regra 11 — abortar: nada e salvo. */
  abortado:
    "Beleza, agendamento abortado. Nada foi salvo. Quando quiser, é só chamar! ✌️",

  /** Regra 13 — cancelar/desistir: estado descartado, nada salvo. */
  cancelado:
    "Sem problema, pode deixar pra lá — cancelei aqui e nada foi salvo. Quando quiser, é só chamar! 👋",

  /** Regra 5 (1.3) — pergunta por notas. */
  pedeNotas: (resumo: string) =>
    `Anotado: ${resumo}\n\n` +
    `Tem alguma informação importante pra eu anotar nesse compromisso? ` +
    `(Se não, responde "não")`,

  /**
   * Fase 4 (spec A4) — mesma pergunta de notas, mas para o ATALHO do criar: a fala já é
   * a confirmação, então o resumo diz "Entendi" (o guiado tradicional diz "Anotado").
   */
  pedeNotasAtalho: (resumo: string) =>
    `Entendi: ${resumo}\n\n` +
    `Tem alguma informação importante pra eu anotar nesse compromisso? ` +
    `(Se não, responde "não")`,

  /** Regra 6 — resumo unico final (decisao de produto #3) + confirmar/alterar.
   *  `lembrete` é a linha `⏰` já formatada (Fase 3, spec regra 1). */
  resumoFinal: (resumo: string, notas: string, lembrete: string) =>
    `Fechando então:\n\n` +
    `📌 ${resumo}\n` +
    `📝 ${notas}\n` +
    `${lembrete}\n\n` +
    `Confirmo? (confirmar / alterar)`,

  /** Regra 6 — criacao ok: confirma citando titulo e horario no tz do usuario. */
  criado: (titulo: string, range: string) =>
    `Prontinho! Criei "${titulo}" de ${range} ✅`,

  /** Alterar no resumo final: o que mudar? */
  alterarPergunta:
    "Tranquilo, o que você quer alterar? (título, dia, horário, duração, notas ou lembrete)",

  /** Regra 12/ajuste: "depois de um alterar" re-pergunta mantendo o passo. */
  perdoaRepetido: "Beleza, continua por aqui então 🙂 ",

  /** Alterar: para onde voltar. */
  alterarMapa: {
    titulo: "titulo",
    dia: "dia",
    horario: "hora",
    hora: "hora",
    duracao: "fim",
    fim: "fim",
    nota: "notas",
    notas: "notas",
    lembrete: "lembrete",
  } as Record<string, "titulo" | "dia" | "hora" | "fim" | "notas" | "lembrete">,

  /** Nao entendi a resposta do passo atual: re-pergunta o mesmo passo. */
  naoEntendi: "Hmm, não entendi 🤔 ",

  /** Resposta de alterar fora do vocabulario. */
  alterarNaoEntendido:
    "Não entendi o que alterar 🤔 Responde: título, dia, horário, duração, notas ou lembrete.",

  // ---------- Fase 2: consulta de agenda sob demanda (spec consultar-agenda-bot) ----------

  /** Spec #9 — cabeçalho repete o período interpretado (o usuário percebe desentendimento). */
  consultaCabecalho: (periodo: string) => `Isto é o que você tem ${periodo}:`,

  /** Spec #10 — caso vazio: só isso, nada mais. */
  consultaVazia: "Você não tem nada nesse período 👌",

  /** Decisão #4 — truncar em 10, nunca cortar mudo. */
  consultaTruncado: (restante: number) =>
    `E mais ${restante} compromisso${restante === 1 ? "" : "s"}... quer ver o resto ou buscar um período menor?`,

  /** Decisão #8 — período muito amplo: contagem + oferta de detalhar. */
  consultaAgregado: (total: number) =>
    `Você tem ${total} compromisso${total === 1 ? "" : "s"} nesse período. ` +
    "É muita coisa pra caber numa mensagem — quer ver mês a mês?",

  /** Spec #5 — LLM não devolveu período confiável: pergunta, nunca age no chute. */
  consultaPerguntaPeriodo:
    "Para qual período você quer ver? Ex.: hoje, amanhã, semana que vem, de 10 a 12 📅",

  /** Spec #14 — 2× pedido de período sem sucesso: encerra educadamente. */
  consultaEncerrado:
    "Tanto faz, encerro aqui então 😊 Quando quiser ver sua agenda de novo, é só perguntar!",

  /** Decisão #3 — compromisso ainda em revisão aparece com o marcador. */
  consultaMarcadorNeedsReview: "⚠️ conferindo",

  // ---------- Fase 3: lembretes no criar + resumo diário (spec lembretes-e-resumo-diario) ----------

  /** Spec 2 — pergunta do esquema de lembrete (atalhos = botões; fala natural por cima). */
  pedeLembrete: (resumo: string) =>
    `Anotado: ${resumo}\n\n` +
    `Como eu te lembro desse compromisso? Pode falar do seu jeito (ex.: "3 dias antes e 1h antes") ` +
    `ou escolher um atalho.`,

  /** Spec 2 — rótulos dos atalhos (botões do teclado de lembrete). */
  lembreteAtalhos: [
    "24h antes",
    "3 dias antes",
    "3-2-1",
    "sem lembrete",
    "personalizado",
  ],

  /**
   * D1 da spec fluxo-criacao-robusto — `callback_data` estruturado do teclado de lembrete
   * (label → payload, ≤ 64 bytes, sem acento): clique NUNCA vira fala pro LLM; o
   * `handleCallback` decodifica `flow:lembrete:*` e manda o evento determinístico
   * `reminderChoice` pra máquina.
   */
  lembreteAtalhosCallback: {
    "24h antes": "flow:lembrete:24h",
    "3 dias antes": "flow:lembrete:3d",
    "3-2-1": "flow:lembrete:countdown",
    "sem lembrete": "flow:lembrete:none",
    personalizado: "flow:lembrete:custom",
  } as Record<string, string>,

  /** Spec 4 — fala que o LLM não traduziu com confiança: re-pergunta, nunca grava no chute. */
  lembreteNaoEntendido:
    "Hmm, não tenho certeza se entendi esse lembrete 🤔 Me diz de novo como quer ser avisado? " +
    '(ex.: "24h antes", "3 dias antes", "3-2-1", "sem lembrete")',

  /**
   * D2 da spec fluxo-criacao-robusto — clique em "personalizado": convite de texto livre
   * (zero LLM no clique); o passo `lembrete` continua aguardando a fala do usuário.
   */
  lembreteConviteCustom:
    'Me diz como você quer ser avisado — ex.: "3 dias antes e 1h antes", ou "hoje às 18h"',

  /**
   * D3 da spec fluxo-criacao-robusto — 2ª falha consecutiva de texto livre: fala exibida
   * JUNTO do teclado de atalhos fixo (anti-loop; texto livre continua aceito depois).
   */
  lembreteRecuperacao:
    'Prefere escolher um atalho aí embaixo? Ou me escreve no estilo "X antes" / "X dias antes".',

  /** Spec 1 — linha do resumo final com o esquema entendido (regras = rótulos schedule-core). */
  lembreteResumo: (regras: string) => `⏰ ${regras}`,
  lembreteResumoNenhum: "⏰ sem lembrete",

  /** Spec 7 (decisão #1) — aviso de gatilho retroativo: o bot avisa e cria mesmo assim. */
  lembreteRetroativo: (rotulos: string[]) =>
    `Heads-up: ${rotulos.join(", ")} ${rotulos.length === 1 ? "não vai" : "não vão"} disparar — ` +
    `o compromisso é logo e o tempo do lembrete já passou. O agendamento segue normal 😉`,

  /** Spec 13 (decisão #3) — lembrete enviado pelo worker (texto aprovado na spec):
   *  `⏰ Lembrete: "X" — qui 08/10 às 14:30 (daqui a 1 hora)` + notas quando existirem. */
  lembrete: (n: {
    title: string;
    when: string;
    lead: string;
    notes: string | null;
  }) =>
    `⏰ Lembrete: "${n.title}" — ${n.when} (${n.lead})` +
    (n.notes ? `\n📝 ${n.notes}` : ""),

  /** Spec 15/17 — resumo diário: cabeçalho "📋 Resumo de <dia>" é gerado em digest.ts; aqui os fixos. */
  resumoVencendoHoje: "⏰ Lembretes que vencem hoje:",
  /** Decisão #5 — dia sem compromisso e sem lembrete vencendo: heartbeat. */
  resumoDiaLivre: "☀️ Hoje você está livre!",

  // ---------- Fase 4: needs_review real, editar/cancelar pelo chat (spec llm-avancado) ----------

  /** Spec E16 — aviso de needs_review: cita o que foi entendido + a evidência. */
  avisoNeedsReview: (v: {
    title: string;
    when: string;
    evidence: string | null;
  }) =>
    `⚠️ Entendi "${v.title}" para ${v.when}, mas não tenho certeza (${
      v.evidence ?? "interpretação com baixa confiança"
    }). ` +
    "Salvei como PENDENTE DE REVISÃO na fila da web e não enviei lembretes. " +
    "Se entendi errado, me avise ou revise em Review na web.",

  /** Spec B8 — pergunta de cancelamento (apagar = decisão #2 do plano). */
  perguntaCancelarCompromisso: (title: string, range: string) =>
    `Vou CANCELAR "${title}" (${range}) e apagar os lembretes dele. Posso cancelar? (sim / não)`,

  /** Spec B9 — diff da edição: de/para + nota de recalculação dos lembretes. "sim" confirma. */
  diffEdicao: (v: { title: string; from: string; to: string }) =>
    `Vou mudar "${v.title}": de ${v.from} para ${v.to}. ` +
    "Os lembretes são recalculados com o horário novo. Confirmo? (sim/não)",

  edicaoFeita: (title: string, range: string) =>
    `Feito! "${title}" agora é ${range}.`,

  /** Spec B10/B14 — negar a edição: nada é gravado (desistir também nega — regra 13). */
  edicaoNegada:
    "Ok, nada mudei. Seu compromisso continua como estava. (se desistir, é só dizer)",

  /** Spec B13 — cancelamento feito: aviso de que os lembretes foram apagados. */
  cancelamentoFeito: (title: string, range: string) =>
    `Cancelado: "${title}" (${range}). Os lembretes desse compromisso foram apagados.`,

  /** Spec B12 — lista numerada de candidatas (máx. maxCandidatas). */
  listaCandidatas: (lines: string) =>
    `Encontrei mais de um. Qual deles? Responda com o número:\n${lines}`,

  /** Spec B11 — nenhuma candidata: não invento, ofereço a consulta para ajudar. */
  naoEncontreiCandidato:
    "Não encontrei esse compromisso. Quer ver sua agenda para me dizer qual é? (sim/não)",

  /** Spec B11 — sem descrição e sem quando na edição: re-pergunta (nunca listar o mundo). */
  pedeDescricaoEdicao:
    "Qual compromisso você quer mudar? (me diga o título ou quando era)",

  /** Spec B11 — candidata achada pelo alvo, falta o que mudar. */
  pedeOQueMudar: (title: string) =>
    `Achei "${title}". O que você quer mudar nele? (data, horário ou título)`,

  procurandoCandidato: "Deixa eu ver se encontro esse compromisso...",
  procurandoMudanca: "Certo, o que exatamente você quer mudar?",

  /** Spec B10 — fala que não contém um quando novo utilizável: re-pergunta. */
  reperguntaHorarioNovo:
    "Não entendi o horário novo. Pode me dizer a data e hora? (se desistir, é só dizer)",

  /** Spec B10 — conflito ao GRAVAR a edição: re-pergunta o quando (máx. 3 tentativas). */
  conflitoEdicao: (v: {
    title: string;
    range: string;
    conflictTitle: string;
    conflictRange: string;
  }) =>
    `Não deu: esse horário novo colide com "${v.conflictTitle}" (${v.conflictRange}). ` +
    `Me diga outro horário para "${v.title}" (agora é ${v.range}). ` +
    `(Se preferir desistir desta edição, é só dizer)`,

  /** Spec regra 7 — needs_review não é editável/cancelável pelo chat. */
  needsReviewNoChat:
    "Esse compromisso está na fila de revisão da web e não pode ser mudado pelo chat. Revise em Review na web.",

  /** Spec B12 — limite de candidatas listadas no chat. */
  maxCandidatas: 5,
} as const;
