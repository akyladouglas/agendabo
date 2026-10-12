/**
 * Camada PURA da decisão de ALVO da consulta de agenda (spec compartilhamento
 * E.24, decisão D6 do plano) — SEM Nest, sem I/O: o LLM só EXTRAI o candidato
 * (`alvo`/`alvo_nome` do contrato); a decisão de ACESSO é 100% determinística
 * aqui (ADR-004/008): o nome dito é casado com os vínculos RECEBIDOS ATIVOS do
 * usuário (régua 1/N/0 espelhando `findMatchingAppointments` do schedule-core).
 *
 * A norma de comparação é a mesma da borda (`normalize` de messages.ts /
 * `normalizeB2`): trim, minúsculas, NFD sem combining marks, espaços comprimidos.
 * Comparação do nome INTEIRO normalizado — sem chute de substring/prefixo
 * (subtítulo "souza" sozinho não e a Ana Souza: a régua e exata, 0 = pergunta).
 */

/** Vínculo recebido ativo mínimo que a pura precisa (nome do dono pode ser null). */
export interface SharedTargetLink {
  id: string;
  ownerId: string;
  ownerName: string | null;
}

/** Veredito determinístico do alvo (quem age sobre ele é o AgendaQueryService). */
export type SharedTargetResolution =
  | { kind: 'own' } // alvo ausente ou 'minha' — caminho exato de hoje (regressão zero)
  | { kind: 'single'; link: SharedTargetLink } // 1 match: consulta a agenda do dono
  | { kind: 'ambiguous'; names: string[] } // N matches: lista numerada, nunca chuta
  | { kind: 'none' }; // 0 matches, ou compartilhada sem nome: pergunta/sem acesso

/** Norma de comparação de nomes: trim/minúsculas/NFD-sem-acentos/espaços únicos. */
export function normalizeSharedName(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Régua do alvo compartilhado (espelho da régua 1/N/0 da edição):
 *  - alvo ausente / 'minha' => `own` (os vínculos nem são lidos);
 *  - 'compartilhada' SEM nome => `none` (o service pergunta "De qual agenda?");
 *  - matches pelo nome normalizado: 1 => `single`, N => `ambiguous` (nomes na
 *    ordem dos vínculos), 0 => `none` (o service responde "sem acesso").
 * Dono sem nome (`ownerName` null) nunca casa — não há o que comparar.
 */
export function resolveSharedTarget(
  alvo: 'minha' | 'compartilhada' | undefined,
  alvoNome: string | undefined,
  linksAtivos: readonly SharedTargetLink[],
): SharedTargetResolution {
  if (alvo !== 'compartilhada') return { kind: 'own' };

  const wanted = normalizeSharedName(alvoNome);
  if (!wanted) return { kind: 'none' }; // sem nome dito: pergunta, nunca chuta

  const matches = linksAtivos.filter((link) => normalizeSharedName(link.ownerName) === wanted);
  if (matches.length === 1) return { kind: 'single', link: matches[0]! };
  if (matches.length > 1) {
    // nomes na ordem recebida (a mensagem numerada preserva a ordem estável);
    // dono sem nome (impossível de casar) nunca entra aqui.
    return { kind: 'ambiguous', names: matches.map((m) => m.ownerName ?? '') };
  }
  return { kind: 'none' };
}
