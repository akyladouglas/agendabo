import type { DateRange } from './calendar';
import { utcToZonedParts } from './dates';

/**
 * Posicionamento dos blocos da GRADE DA VISÃO DIA (plano grades-dia-semana-mes,
 * Etapa 1.1). Regra de data (regra zero): pura, offset/`now` injetáveis, zero Intl.
 * O eixo da grade são as HORAS LOCAIS do dia (a web passa a range UTC do dia civil
 * + o MESMO offset usado para derivá-la — ADR-002; em minutos a grade em % fica
 * idêntica em qualquer fuso, o offset só deriva a âncora local).
 *
 * Âncora = hora de INÍCIO LOCAL: compromisso 23:00–00:30 local começa na linha das
 * 23h e a altura é CLAMPADA ao fim da grade (atravessa a meia-noite visualmente);
 * bloco que começa ANTES da grade e ainda a toca (travessia do dia anterior) entra
 * clampado ao topo. Encostado no limite da grade não entra (half-open — same rule
 * de `conflicts.ts`). Sobrepostos lado a lado: agrupamento por clique de transição
 * + colunas gulosas (k sobrepostos ⇒ largura 1/k), ordem estável por `startsAt`
 * depois `id`.
 */

/** O mínimo que a regra sabe sobre cada compromisso. */
export interface TimelineItem {
  id: string;
  startsAt: Date;
  endsAt: Date;
}

/** Bloco posicionado — a web aplica `top`/`height`/`left`/`width` em %. */
export interface TimelineBlock<T extends TimelineItem = TimelineItem> {
  item: T;
  /** Topo em % da grade (0 = início da range, 100 = fim). Clampado ≥ 0. */
  top: number;
  /** Altura em % da grade (clampada ao que resta da grade). */
  height: number;
  /** Largura em % (100 / colunas do grupo). */
  width: number;
  /** Índice da coluna do bloco (0-based, `left = column * width`). */
  column: number;
  /** Total de colunas do grupo de sobreposição do bloco. */
  columns: number;
  /** Hora local "HH" do INÍCIO (célula-âncora `day-slot-HH` da web). */
  localHourUtc: string;
  /** Só quando `now` é injetado: o agora passou do FIM do bloco (half-open). */
  isPast: boolean;
}

export function layoutDayTimeline<T extends TimelineItem>(
  items: readonly T[],
  dayRange: DateRange,
  offsetMinutes: number,
  now?: Date,
): TimelineBlock<T>[] {
  const from = dayRange.start.getTime();
  const to = dayRange.end.getTime();
  const span = to - from;

  const visible = items
    .map((item) => {
      const rawStart = item.startsAt.getTime();
      const rawEnd = item.endsAt.getTime();
      return {
        item,
        start: Math.max(rawStart, from),
        end: Math.min(rawEnd, to),
        rawStart,
        rawEnd,
      };
    })
    // meia-noite local = `from` de UM dia e `to` do anterior: só meia-noite como
    // INÍCIO entra (half-open — encostado no fim da grade é o dia seguinte)
    .filter((b) => b.rawStart < to && b.rawEnd > from && b.start < b.end)
    .sort(
      (a, b) =>
        a.rawStart - b.rawStart ||
        b.rawEnd - b.rawStart - (a.rawEnd - a.rawStart) ||
        (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0),
    );

  // Agrupamento por clique de transição (varredura canônica de calendar-lanes):
  // um bloco que começa em `end === fim` de todo o grupo aberto inicia novo grupo
  // (encostado não sobrepõe). Dentro do grupo, colunas gulosas na ordem estável.
  const out: TimelineBlock<T>[] = [];
  let cluster: (typeof visible)[number][] = [];
  let clusterEnd = -Infinity;

  const place = (members: (typeof visible)[number][]) => {
    const used: number[] = []; // fim (clampado) por coluna
    const placed = members.map((m) => {
      let col = used.findIndex((endAt) => endAt <= m.start);
      if (col === -1) {
        col = used.length;
        used.push(m.end);
      } else {
        used[col] = m.end;
      }
      return { m, col };
    });
    const columns = used.length;
    for (const { m, col } of placed) {
      const parts = utcToZonedParts(new Date(m.rawStart), offsetMinutes);
      out.push({
        item: m.item,
        top: ((m.start - from) / span) * 100,
        height: ((m.end - m.start) / span) * 100,
        width: 100 / columns,
        column: col,
        columns,
        localHourUtc: String(parts.hour).padStart(2, '0'),
        // "passado" = o bloco ACABOU: o agora passou do FIM (half-open — termina
        // às 10:00 e o agora é 10:00 em ponto ⇒ ainda não é passado). Sem `now`, nunca.
        isPast: now !== undefined && now.getTime() >= m.rawEnd,
      });
    }
  };

  for (const b of visible) {
    if (cluster.length > 0 && b.start >= clusterEnd) {
      place(cluster);
      cluster = [];
      clusterEnd = -Infinity;
    }
    cluster.push(b);
    clusterEnd = Math.max(clusterEnd, b.end);
  }
  if (cluster.length > 0) place(cluster);

  // saída canônica: pela posição na grade, depois coluna, depois id (determinístico
  // independente da ordem de entrada)
  out.sort((a, b) => a.top - b.top || a.column - b.column || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0));
  return out;
}
