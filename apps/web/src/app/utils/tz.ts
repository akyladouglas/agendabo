/**
 * Conversão de fuso na BORDA da web (ADR-002): apenas MEDIR o offset (Intl, igual
 * ao `realTzOffset` da API) e FORMATAR para exibição. Nenhum cálculo de período/
 * conflito mora aqui — isso vem de `@agendabo/schedule-core` (gotcha 3: consumido
 * via alias de fonte) ou da API.
 */

/** Minutos leste de UTC observados em `at` (mesmo algoritmo do worker da API). */
export function measureTzOffset(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** "HH:mm" no fuso do usuário (exibição pura). */
export function formatTimeInTz(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

/** "14:00–15:30" (ou "18:00–sex 09/10 00:30" quando o fim vaza o dia) no tz do usuário. */
export function formatRangeInTz(startsAt: Date, endsAt: Date, timeZone: string): string {
  const day = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const time = (d: Date) => formatTimeInTz(d, timeZone);
  if (day(startsAt) === day(endsAt)) return `${time(startsAt)}–${time(endsAt)}`;
  const weekday = new Intl.DateTimeFormat('pt-BR', { timeZone, weekday: 'short' })
    .format(endsAt)
    .replace('.', '');
  const dm = new Intl.DateTimeFormat('pt-BR', { timeZone, day: '2-digit', month: '2-digit' }).format(endsAt);
  return `${time(startsAt)}–${weekday} ${dm} ${time(endsAt)}`;
}

/**
 * Instante com **dia completo** no fuso do usuário ("qui 08/10 14:00").
 * Usado onde o horário pode cair em outro dia (jogada de reagendamento —
 * a a jogada empurra para depois da meia-noite com frequência; omitir o dia
 * assusta). Formatação pura de borda.
 */
export function formatDateTimeInTz(date: Date, timeZone: string): string {
  const weekday = new Intl.DateTimeFormat('pt-BR', { timeZone, weekday: 'short' })
    .format(date)
    .replace('.', '');
  const dm = new Intl.DateTimeFormat('pt-BR', { timeZone, day: '2-digit', month: '2-digit' }).format(date);
  return `${weekday} ${dm} ${formatTimeInTz(date, timeZone)}`;
}

const WEEKDAYS_PT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** Partes do dia/semana local para o cabeçalho (mock: "Hoje · 8 out"). Formatação pura. */
export function formatDayHeading(
  date: Date,
  timeZone: string,
  today: Date,
): { label: string; isToday: boolean; weekday: string } {
  const key = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  const label = new Intl.DateTimeFormat('pt-BR', { timeZone, day: 'numeric', month: 'short' })
    .format(date)
    .replace('.', '');
  const weekdayEn = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' })
    .format(date)
    .replace('.', '');
  const weekday = WEEKDAYS_PT[['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekdayEn)] ?? '';
  return { label, isToday: key(date) === key(today), weekday };
}

/** Nome do mês CALENDARIO do instante no fuso ("janeiro"); `short` = "jan". */
export function monthName(
  date: Date,
  timeZone: string,
  style: 'long' | 'short' = 'long',
): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone, month: style }).format(date).replace('.', '');
}

/** Mês CALENDARIO (1-12) e ano do instante no fuso — só leitura de partes, p/ menu ir-para. */
export function monthCalendarOf(date: Date, timeZone: string): { month: number; year: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric' })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  // en-US numeric: month=MM, year=YYYY (sem U+200E no formato dos navegadores-alvo)
  return { month: Number(parts.month), year: Number(parts.year) };
}

/** "d MMM – d MMM" (rota entre meses funciona: `28 set – 4 out`). */
export function formatWeekHeading(start: Date, endExclusive: Date, timeZone: string): string {
  const end = new Date(endExclusive.getTime() - 1);
  const fmt = new Intl.DateTimeFormat('pt-BR', { timeZone, day: 'numeric', month: 'short' });
  const month = (d: Date) =>
    new Intl.DateTimeFormat('pt-BR', { timeZone, month: 'short' }).format(d).replace('.', '');
  const day = (d: Date) => new Intl.DateTimeFormat('pt-BR', { timeZone, day: 'numeric' }).format(d);
  if (month(start) === month(end)) return `${day(start)} – ${day(end)} ${month(end)}`;
  return `${fmt.format(start).replace('.', '')} – ${fmt.format(end).replace('.', '')}`;
}

/** Data "YYYY-MM-DD" do dia civil do usuário (p/ <input type="date">). */
export function toLocalDateString(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Hora "HH:mm" do instante no dia civil local (p/ <input type="time">). */
export function toLocalTimeString(date: Date, timeZone: string): string {
  return formatTimeInTz(date, timeZone);
}

const MS_MINUTE = 60_000;

/**
 * Instante UTC da meia-noite LOCAL do `dateKey` ('YYYY-MM-DD') no fuso — o mesmo
 * cálculo que `setAnchorDate`/`openCreateOn` faziam inline (âncora sempre
 * normalizada; meio-dia local nunca é madrugada de DST — técnica de
 * `localDateTimeToUtc`). Borda: só MEDIR offset (Intl), nenhum cálculo de período.
 */
export function localMidnightUtc(dateKey: string, timeZone: string): Date {
  const off = measureTzOffset(timeZone, new Date(`${dateKey}T12:00:00Z`));
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) - off * 60_000);
}

/**
 * Monta o instante UTC a partir de `date` (YYYY-MM-DD) + `time` (HH:mm) no fuso do
 * usuário, com bisseção de ambiguidade (uma hora de busca de fallback de 1h — o
 * mesmo modelo de offset fixo do schedule-core aplicado na borda).
 */
export function localDateTimeToUtc(
  date: string,
  time: string,
  timeZone: string,
  hint: Date = new Date(),
): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const offsetHint = measureTzOffset(timeZone, new Date(Date.UTC(y, m - 1, d, 12)));
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm) - offsetHint * MS_MINUTE);
  // refino: offset real no instante estimado (DST pode mudar entre_hint e candidato)
  const refined = measureTzOffset(timeZone, guess);
  const candidate = new Date(Date.UTC(y, m - 1, d, hh, mm) - refined * MS_MINUTE);
  void hint;
  return candidate;
}
