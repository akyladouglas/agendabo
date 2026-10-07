import type { AppointmentLike } from './types';

const MINUTE = 60_000;

/**
 * Busca determinística de candidatas para editar/cancelar pelo chat (Fase 4, spec
 * llm-avancado regra 11). O LLM fornece SOMENTE a descrição (palavras do título) e um
 * quando aproximado; quem localiza é esta função pura — ambiguidade nunca resolve sozinha.
 */
export interface MatchQuery {
  /** Palavras do título ditas pelo usuário; vazio/sem-token = sem filtro de texto. */
  texto?: string;
  /** Período aproximado do alvo (half-open [start, end)); ausente = sem filtro de data. */
  intervalo?: { start: Date; end: Date };
}

/**
 * Normalização canônica para comparação de título: minúsculas, sem acento, espaços
 * colapsados (a MESMA normalização dos atalhos do bot — comportamento único).
 */
export function normalizeTitle(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tokens "substantivos" da descrição (≥3 caracteres, após normalização). */
function queryTokens(texto: string): string[] {
  return normalizeTitle(texto)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
}

/** Título casa com a descrição: substring OU todos os tokens substantivos presentes. */
function titleMatches(title: string, tokens: string[]): boolean {
  const norm = normalizeTitle(title);
  if (tokens.length === 0) return true; // descrição só com conectivos ("a", "o") → sem filtro
  if (tokens.every((t) => norm.includes(t))) return true;
  const joined = tokens.join(' ');
  return norm.includes(joined);
}

/**
 * Filtra as candidatas que casam com o pedido, ordenadas por `startsAt` (empate: ordem
 * de chegada — entrada já ordenada pelo caller). Half-open: `startsAt` dentro de
 * `[intervalo.start, intervalo.end)`. Zero I/O, `now` não é necessário (a janela de
 * futuras já vem do caller).
 */
export function findMatchingAppointments<T extends AppointmentLike>(
  candidates: readonly T[],
  query: MatchQuery = {},
): T[] {
  const tokens = query.texto ? queryTokens(query.texto) : [];
  return candidates
    .filter((appt) => {
      if (query.intervalo) {
        const t = appt.startsAt.getTime();
        if (t < query.intervalo.start.getTime() || t >= query.intervalo.end.getTime()) return false;
      }
      return titleMatches(appt.title, tokens);
    })
    .slice()
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/**
 * Delta → novo intervalo (spec regra 10): "adianta 1 hora" desloca início e FIM em
 * deltas iguais (duração preservada); cruza a meia-noite naturalmente (datas são
 * instantes UTC — aritmética de minutos, ADR-002). Puro: só recebe e devolve `Date`.
 */
export function applyShift(
  startsAt: Date,
  endsAt: Date,
  deltaMinutes: number,
): { startsAt: Date; endsAt: Date } {
  const shift = deltaMinutes * MINUTE;
  return { startsAt: new Date(startsAt.getTime() + shift), endsAt: new Date(endsAt.getTime() + shift) };
}
