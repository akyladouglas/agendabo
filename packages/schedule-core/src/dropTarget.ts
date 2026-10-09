import { utcToZonedParts } from './dates';

/**
 * Alvo do DRAG-AND-DROP (plano grades-dia-semana-mes, Etapa 2.2 — ADR-0014):
 * o drop diz só o DESLOCAMENTO; o novo intervalo é o antigo TRANSLADADO
 * (mesma duração) — a web nunca recalcula duração nem data. Regra de data
 * (regra zero): pura, offset injetável, datas UTC (ADR-002), zero Intl.
 *
 * Chaves estáveis das células (`data-cell-key` — registry do ADR-0014):
 * - Dia: `hour:<ISO>` (início UTC da célula de hora);
 * - Semana/Mês: `day:YYYY-MM-DD` (célula-dia civil, SEM instante: a meia-noite
 *   local do dateKey depende do offset do usuário, que só a borda sabe).
 */

/** Dia de 24h em ms — com offset FIXO por período (ADR-002) meia-noite local
 *  nasce a cada 24h exatas, então `+N × DAY_MS` preserva a hora local (é o
 *  deslocamento que a web usa no Semana/Mês quando prefere ms em vez de alvo-dia). */
export const DAY_MS = 86_400_000;

/**
 * Sentinela do alvo-dia em APIs que operam em deslocamento-ms: NaN. Se alguém
 * transladar um item com ela, o resultado é NaN visível (defensivo) — o caminho
 * correto do Mês/Semana é `dropTargetRange` com `{ kind: 'day' }`, NUNCA ms.
 */
export const MONTH_TARGET = Number.NaN;

/** Deslocamento em ms entre o início da célula-alvo e o início do item (célula de hora). */
export function dropOffsetMs(cell: { start: Date; end: Date }, itemStart: Date): number {
  void cell.end; // a duração da célula não importa: o que translada é o INÍCIO
  return cell.start.getTime() - itemStart.getTime();
}

/** Translada o intervalo preservando a duração (atravessar meia-noite é irrelevante — instante puro). */
export function translateAppointmentRange(
  item: { startsAt: Date; endsAt: Date },
  offsetMs: number,
): { startsAt: Date; endsAt: Date } {
  return {
    startsAt: new Date(item.startsAt.getTime() + offsetMs),
    endsAt: new Date(item.endsAt.getTime() + offsetMs),
  };
}

/** DataKey civil "YYYY-MM-DD" de `instant` no fuso `offsetMinutes` (leste de UTC). */
export function localDateKey(instant: Date, offsetMinutes: number): string {
  const { year, month, day } = utcToZonedParts(instant, offsetMinutes);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Alvo resolvido da `data-cell-key` sob o ponteiro. */
export type DropTarget =
  | { kind: 'hour'; cellStartUtc: Date }
  | { kind: 'day'; dateKey: string };

/**
 * Parse da chave estável (`hour:<ISO>` | `day:YYYY-MM-DD`). Chave desconhecida,
 * ISO inválida ou dateKey impossível ⇒ `null` (a UI cancela o drop — nada é escrito).
 */
export function dropTargetFromKey(key: string): DropTarget | null {
  if (key.startsWith('hour:')) {
    const instant = new Date(key.slice('hour:'.length));
    return Number.isNaN(instant.getTime()) ? null : { kind: 'hour', cellStartUtc: instant };
  }
  if (key.startsWith('day:')) {
    const dateKey = key.slice('day:'.length);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
    // dateKey IMPOSSÍVEL (mês 13, dia 99) vira data inválida no roundtrip do Date.UTC
    const probe = new Date(`${dateKey}T00:00:00Z`);
    if (Number.isNaN(probe.getTime()) || localDateKey(probe, 0) !== dateKey) return null;
    return { kind: 'day', dateKey };
  }
  return null;
}

/**
 * O novo intervalo dado o alvo (a regra que a página compõe — zero cálculo no `.vue`):
 * - `hour`: translada o item para o INÍCIO da célula de hora;
 * - `day`: troca SÓ A DATA preservando a HORA LOCAL do item — o deslocamento é
 *   `N × DAY_MS` (dias civis entre o dia atual do item e o dateKey do alvo). Com
 *   offset FIXO por período (ADR-002) a meia-noite local nasce a cada 24h exatas,
 *   então ms de dias inteiros preservam a hora local por construção; recompor o
 *   instante a partir do dateKey com `Date.UTC` das partes locais **não** faria isso
 *   em offset negativo (o dia UTC das partes cai no dia anterior à meia-noite local).
 */
export function dropTargetRange(
  target: DropTarget,
  item: { startsAt: Date; endsAt: Date },
  offsetMinutes: number,
): { startsAt: Date; endsAt: Date } {
  if (target.kind === 'hour') {
    return translateAppointmentRange(item, dropOffsetMs({ start: target.cellStartUtc, end: target.cellStartUtc }, item.startsAt));
  }
  const [cy, cm, cd] = localDateKey(item.startsAt, offsetMinutes).split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = target.dateKey.split('-').map(Number) as [number, number, number];
  const shiftDays = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(cy, cm - 1, cd)) / DAY_MS);
  return translateAppointmentRange(item, shiftDays * DAY_MS);
}
