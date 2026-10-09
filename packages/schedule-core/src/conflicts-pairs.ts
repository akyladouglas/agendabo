import { overlaps } from './conflicts';

/**
 * Pares sobrepostos VISÍVEIS (spec calendario-visoes C.12 — badge informativo da web).
 * Regra de conflito é schedule-core (regra zero); a web só EMPACOTA aqui o que já
 * carregou do período. Diferente de `findConflict` (checagem de escrita, ignora
 * passados): aqui o badge marca QUALQUER par `confirmed` sobreposto, incluindo
 * passados, porque a grade pinta o período inteiro.
 *
 * Limitação declarada (C.12): a lista da API usa contenção `startsAt>=from AND
 * endsAt<=to`, então um conflitante que começa no período mas termina depois dele
 * pode faltar ao par — o badge é informativo; a checagem que vale continua sendo
 * `check-conflict`/409 da API. O(n²) é aceitável na escala do período visível.
 */

export interface Pairable {
  id: string;
  /** Rótulo do par em choque (o título do parceiro entra na mensagem). */
  title: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
}

/**
 * Ids dos itens `confirmed` que sobrepoem (half-open, encostado NÃO conta) a outro
 * `confirmed` do MESMO conjunto. `needs_review` tem sinal próprio (⚠️) e não entra.
 */
export function conflictedIds(items: readonly Pairable[]): Set<string> {
  const confirmed = items.filter((i) => i.status === 'confirmed');
  const ids = new Set<string>();
  for (let i = 0; i < confirmed.length; i++) {
    for (let j = i + 1; j < confirmed.length; j++) {
      if (overlaps(confirmed[i]!, confirmed[j]!)) {
        ids.add(confirmed[i]!.id);
        ids.add(confirmed[j]!.id);
      }
    }
  }
  return ids;
}

/**
 * Rótulo determinístico "primeiro choque" de um item (para `title`/`aria-label`):
 * o par sobreposto de início mais cedo. Null se o item não choca com ninguém.
 */
export function firstConflictLabel(
  item: Pairable,
  items: readonly Pairable[],
  formatRange: (startsAt: Date, endsAt: Date) => string,
): string | null {
  if (item.status !== 'confirmed') return null;
  const partner = items
    .filter((o) => o.id !== item.id && o.status === 'confirmed' && overlaps(item, o))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
  if (!partner) return null;
  return `Choque com "${partner.title}" (${formatRange(partner.startsAt, partner.endsAt)})`;

}
