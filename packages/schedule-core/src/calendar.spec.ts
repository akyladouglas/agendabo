import { describe, expect, it } from 'vitest';
import { monthGridRange, userDayRange, userMonthRange, userWeekRange, userYearRange } from './dates';
import {
  dayDensity,
  groupByLocalDay,
  monthCells,
  weekRows,
  type LocalizedItem,
} from './calendar';

/**
 * Base fixa da Fase 7 (spec calendario-visoes E.3): America/Sao_Paulo (-180),
 * `now` sempre injetado (testing.md — nunca `new Date()` em regra).
 */
const sp = -180;

/** Chave local esperada 'YYYY-MM-DD' a partir de um instantâneo UTC (mesma conta da regra). */
function localKey(utc: Date, offsetMin: number): string {
  const local = new Date(utc.getTime() + offsetMin * 60_000);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, '0');
  const d = String(local.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function item(startsAt: Date, endsAt: Date, id = 'a'): LocalizedItem & { id: string } {
  return { id, startsAt, endsAt };
}

describe('monthCells — 42 células da grade do mês (4.1)', () => {
  it('grade de outubro/2026: 42 células com dateKeys ÚNICOS e consecutivos, âncora incluída', () => {
    const anchor = new Date('2026-10-08T11:00:00Z'); // qui 08/10 08:00 local
    const grid = monthGridRange(anchor, sp);
    const cells = monthCells(grid, sp);
    expect(cells).toHaveLength(42);
    const keys = cells.map((c) => c.date);
    expect(new Set(keys).size).toBe(42);
    // consecutivos: cada key é o anterior + 1 dia local (o próprio array é a referência)
    for (let i = 1; i < cells.length; i++) {
      const prevMidnightLocal = new Date(grid.start.getTime() + i * 86_400_000);
      expect(keys[i]).toBe(localKey(prevMidnightLocal, sp));
    }
    // grade começa no domingo 27/09 (01/10/2026 = quinta) e a âncora 08/10 está na grade
    expect(keys[0]).toBe('2026-09-27');
    expect(keys).toContain('2026-10-08');
  });

  it('cada célula carrega a meia-noite LOCAL do seu dateKey (start/end half-open)', () => {
    const anchor = new Date('2026-10-08T11:00:00Z');
    const cells = monthCells(monthGridRange(anchor, sp), sp);
    for (const c of cells) {
      // meia-noite local em -03:00 = 03:00Z do MESMO dia civil (dia longo o bastante)
      expect(c.start.toISOString()).toBe(`${c.date}T03:00:00.000Z`);
      const next = new Date(`${c.date}T12:00:00Z`);
      expect(c.end.toISOString()).toBe(
        userDayRange(next, sp).end.toISOString(),
      );
    }
  });

  it('inMonth: false nos dias vazios de meses vizinhos (leading set / trailing nov)', () => {
    const anchor = new Date('2026-10-08T11:00:00Z');
    const cells = monthCells(monthGridRange(anchor, sp), sp);
    const leading = cells.filter((c) => c.date < '2026-10-01');
    const trailing = cells.filter((c) => c.date >= '2026-11-01');
    // 01/10/2026 = quinta => 4 células de setembro; grade de 42d alcança 07/11
    expect(leading.map((c) => c.date)).toEqual(['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30']);
    expect(trailing.length).toBeGreaterThan(0);
    expect(trailing.map((c) => c.date)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']);
    for (const c of leading) expect(c.inMonth).toBe(false);
    for (const c of trailing) expect(c.inMonth).toBe(false);
    for (const c of cells) {
      if (c.date >= '2026-10-01' && c.date <= '2026-10-31') expect(c.inMonth).toBe(true);
    }
  });

  it('isToday: só a célula do dia civil do `now` injetado (dia 1 e dia 31)', () => {
    const octGrid = monthGridRange(new Date('2026-10-08T11:00:00Z'), sp);
    const onFirst = monthCells(octGrid, sp, new Date('2026-10-01T12:00:00Z'));
    expect(onFirst.filter((c) => c.isToday).map((c) => c.date)).toEqual(['2026-10-01']);
    const on31 = monthCells(octGrid, sp, new Date('2026-10-31T12:00:00Z'));
    expect(on31.find((c) => c.date === '2026-10-31')?.isToday).toBe(true);
    expect(on31.filter((c) => c.isToday)).toHaveLength(1);
    // "hoje" fora do período da grade (ex.: navegou para outro mês) => nenhuma célula marcada
    const noneToday = monthCells(octGrid, sp, new Date('2026-12-25T12:00:00Z'));
    expect(noneToday.filter((c) => c.isToday)).toHaveLength(0);
    // omitido `now` => nenhuma célula marcada como hoje
    const noNow = monthCells(octGrid, sp);
    expect(noNow.filter((c) => c.isToday)).toHaveLength(0);
  });

  it('fevereiro bissexto (2028): célula 29/02 existe e é do mês; grade termina em 11/03', () => {
    const anchor = new Date('2028-02-15T12:00:00Z');
    const cells = monthCells(monthGridRange(anchor, sp), sp);
    const feb29 = cells.find((c) => c.date === '2028-02-29');
    expect(feb29).toBeDefined();
    expect(feb29?.inMonth).toBe(true);
    // 01/02/2028 = terça => grade começa dom 30/01; última célula (30/01 + 41d) = 11/03
    expect(cells[41]?.date).toBe('2028-03-11');
  });

  it('fevereiro NÃO bissexto (2026): 29/02 não existe; grade começa no próprio 01/02', () => {
    const anchor = new Date('2026-02-11T12:00:00Z');
    const cells = monthCells(monthGridRange(anchor, sp), sp);
    expect(cells.some((c) => c.date === '2026-02-29')).toBe(false);
    // 01/02/2026 = DOMINGO => grade começa no dia 1 sem leading; última = 01/02 + 41d
    expect(cells[0]?.date).toBe('2026-02-01');
    expect(cells[0]?.inMonth).toBe(true);
    expect(cells[41]?.date).toBe('2026-03-14');
    expect(cells.find((c) => c.date === '2026-02-28')?.inMonth).toBe(true);
  });

  it('mês de 6 linhas (nov/2026): grade fixa de 42 dias exibe 6 linhas; a 6ª é toda do vizinho', () => {
    const anchor = new Date('2026-11-11T12:00:00Z'); // qua 11/11/2026 09:00 local
    const cells = monthCells(monthGridRange(anchor, sp), sp);
    // 01/11/2026 = DOMINGO e o mês tem 30 dias => 4 linhas e meia de novembro; como a
    // grade é sempre 42 dias (spec B.8, máx. 6×7), as células de dezembro preenchem o
    // resto — inclusive a 6ª linha inteira — com inMonth=false.
    expect(cells[0]?.date).toBe('2026-11-01');
    expect(cells[0]?.inMonth).toBe(true);
    expect(cells[29]?.date).toBe('2026-11-30'); // último dia de novembro
    expect(cells[29]?.inMonth).toBe(true);
    const lastRow = cells.slice(35);
    expect(lastRow.map((c) => c.date)).toEqual([
      '2026-12-06',
      '2026-12-07',
      '2026-12-08',
      '2026-12-09',
      '2026-12-10',
      '2026-12-11',
      '2026-12-12',
    ]);
    expect(lastRow.every((c) => c.inMonth === false)).toBe(true);
    // a linha anterior à 6ª ainda tem dias de dezembro com inMonth=false (trailing real)
    expect(cells[30]?.date).toBe('2026-12-01');
    expect(cells[30]?.inMonth).toBe(false);
  });

  it('DST America/Sao_Paulo: 42 dateKeys únicos e consecutivos atravessando a transição', () => {
    // Limitação declarada (spec E.6): offset ÚNICO por período. Com a meia-noite local
    // a cada 24h no modelo de offset fixo (ADR-002), a grade não pode repetir nem pular
    // um dateKey mesmo quando a transição real de DST cai dentro do mês.
    const anchor = new Date('2026-11-11T12:00:00Z'); // qua 11/11/2026 — novembro atravessa a transição BR (madrugada 15/11 no fuso real)
    const keys = monthCells(monthGridRange(anchor, sp), sp).map((c) => c.date);
    expect(new Set(keys).size).toBe(42);
    for (let i = 1; i < keys.length; i++) {
      const prev = new Date(`${keys[i - 1]}T12:00:00Z`);
      const cur = new Date(`${keys[i]}T12:00:00Z`);
      expect(cur.getTime() - prev.getTime()).toBe(86_400_000);
    }
  });

  it('virada de semana na fronteira do mês: primeiro dia do mês cai em qualquer coluna', () => {
    // dez/2026 começa em terça: leading = [29/11, 30/11], e 01/12 tem inMonth=true
    const anchor = new Date('2026-12-08T12:00:00Z');
    const cells = monthCells(monthGridRange(anchor, sp), sp);
    expect(cells[0].date).toBe('2026-11-29');
    expect(cells[0].inMonth).toBe(false);
    expect(cells[2].date).toBe('2026-12-01');
    expect(cells[2].inMonth).toBe(true);
  });
});

describe('weekRows — 7 linhas da semana (dom..sáb) da âncora (4.2)', () => {
  it('linhas dom..sáb com as MEIAS-NOITES LOCAIS de cada dia e dateKey', () => {
    const anchor = new Date('2026-10-08T11:00:00Z'); // qui 08/10 08:00 local
    const rows = weekRows(userWeekRange(anchor, sp), sp);
    expect(rows.map((r) => r.date)).toEqual([
      '2026-10-04', // domingo
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08', // âncora
      '2026-10-09',
      '2026-10-10', // sábado
    ]);
    // cada start é a meia-noite local daquele dateKey no offset
    for (const r of rows) {
      expect(r.start.toISOString()).toBe(
        userDayRange(new Date(`${r.date}T12:00:00Z`), sp).start.toISOString(),
      );
      expect(r.end.getTime() - r.start.getTime()).toBe(86_400_000);
    }
  });

  it('isToday marca exatamente a linha do dia civil do `now` (hoje = âncora)', () => {
    const anchor = new Date('2026-10-08T11:00:00Z');
    const rows = weekRows(userWeekRange(anchor, sp), sp, new Date('2026-10-08T22:00:00Z'));
    expect(rows.filter((r) => r.isToday).map((r) => r.date)).toEqual(['2026-10-08']);
    // navegou para outra semana => nenhuma linha marcada
    const otherWeek = weekRows(userWeekRange(anchor, sp), sp, new Date('2026-10-01T11:00:00Z'));
    expect(otherWeek.filter((r) => r.isToday)).toHaveLength(0);
  });

  it('DST America/Sao_Paulo: 7 dateKeys consecutivos sem repetição atravessando a transição', () => {
    // Semana dom 08/11 a sáb 14/11/2026 — a transição de horário de verão BR cai na
    // madrugada de domingo 15/11 no fuso real. Com offset ÚNICO -180 (limitação E.6) a
    // semana não repete nem pula dia.
    const anchor = new Date('2026-11-11T12:00:00Z'); // qua 11/11 09:00 local
    const keys = weekRows(userWeekRange(anchor, sp), sp).map((r) => r.date);
    expect(new Set(keys).size).toBe(7);
    for (let i = 1; i < keys.length; i++) {
      const prev = new Date(`${keys[i - 1]}T12:00:00Z`);
      const cur = new Date(`${keys[i]}T12:00:00Z`);
      expect(cur.getTime() - prev.getTime()).toBe(86_400_000);
    }
  });
});

describe('groupByLocalDay — agrupa pelo INÍCIO LOCAL (4.3)', () => {
  it('critério Gherkin: 23:50→00:10 local pertence ao dia de INÍCIO (só um dateKey)', () => {
    // 23:50 local (-03) = 02:50Z do dia 10; 00:10 local do dia 11 = 03:10Z do dia 11
    const overnight = item(new Date('2026-10-11T02:50:00Z'), new Date('2026-10-11T03:10:00Z'));
    const map = groupByLocalDay([overnight], sp);
    expect([...map.keys()]).toEqual(['2026-10-10']);
    expect(map.get('2026-10-10')).toEqual([overnight]);
    expect(map.has('2026-10-11')).toBe(false);
  });

  it('dias sem compromisso não criam chave (Map esparso)', () => {
    const a = item(new Date('2026-10-08T13:00:00Z'), new Date('2026-10-08T14:00:00Z'));
    const map = groupByLocalDay([a], sp);
    expect([...map.keys()]).toEqual(['2026-10-08']);
  });

  it('ordenado por startsAt dentro de cada dia; dias do Map em ordem cronológica', () => {
    const later = item(new Date('2026-10-08T15:00:00Z'), new Date('2026-10-08T16:00:00Z'), 'b');
    const earlier = item(new Date('2026-10-08T12:00:00Z'), new Date('2026-10-08T13:00:00Z'), 'a');
    const nextDay = item(new Date('2026-10-09T12:00:00Z'), new Date('2026-10-09T13:00:00Z'), 'c');
    const map = groupByLocalDay([later, earlier, nextDay], sp);
    expect([...map.get('2026-10-08')!].map((i) => i.id)).toEqual(['a', 'b']);
    expect([...map.keys()]).toEqual(['2026-10-08', '2026-10-09']);
  });

  it('vários itens cruzando a meia-noite em sequência agrupam cada um no seu dia de início', () => {
    const items = [
      item(new Date('2026-10-11T02:30:00Z'), new Date('2026-10-11T03:30:00Z'), 'x'), // 23:30→00:30 de 10
      item(new Date('2026-10-11T02:50:00Z'), new Date('2026-10-11T03:10:00Z'), 'y'), // 23:50→00:10 de 10
      item(new Date('2026-10-12T02:10:00Z'), new Date('2026-10-12T02:40:00Z'), 'z'), // 23:10→23:40 de 11 (não cruza)
    ];
    const map = groupByLocalDay(items, sp);
    expect([...map.get('2026-10-10')!].map((i) => i.id)).toEqual(['x', 'y']);
    expect([...map.get('2026-10-11')!].map((i) => i.id)).toEqual(['z']);
  });

  it('array vazio devolve Map vazio', () => {
    expect(groupByLocalDay([], sp).size).toBe(0);
  });
});

describe('dayDensity — dias civis com ≥1 compromisso por mês (4.4)', () => {
  const year = userYearRange(new Date('2026-10-08T11:00:00Z'), sp);

  it('critério Gherkin: 3 dias com compromisso e 1 dia com 2 ⇒ densidade 3 (não 4)', () => {
    const items = [
      item(new Date('2026-10-05T13:00:00Z'), new Date('2026-10-05T14:00:00Z'), 'a'),
      item(new Date('2026-10-06T13:00:00Z'), new Date('2026-10-06T14:00:00Z'), 'b'),
      item(new Date('2026-10-07T13:00:00Z'), new Date('2026-10-07T14:00:00Z'), 'c'),
      item(new Date('2026-10-07T16:00:00Z'), new Date('2026-10-07T17:00:00Z'), 'd'), // 2º no dia 07
    ];
    const oct = dayDensity(items, year, sp).get(10);
    expect(oct).toEqual({ month: 10, daysWithAppointments: 3, dayKeys: ['2026-10-05', '2026-10-06', '2026-10-07'] });
  });

  it('itens FORA do período não contam — período do MÊS: só a chave do mês, sem dezembro', () => {
    const october = userMonthRange(new Date('2026-10-08T11:00:00Z'), sp);
    const inRange = item(new Date('2026-10-05T13:00:00Z'), new Date('2026-10-05T14:00:00Z'), 'a');
    const farFuture = item(new Date('2026-12-31T13:00:00Z'), new Date('2026-12-31T14:00:00Z'), 'b');
    const byMonth = dayDensity([inRange, farFuture], october, sp);
    expect([...byMonth.keys()]).toEqual([10]);
    expect(byMonth.get(10)?.daysWithAppointments).toBe(1);
  });

  it('período do ANO inteiro: 12 entradas (meses 1..12), mês sem compromisso = 0', () => {
    const one = item(new Date('2026-03-10T13:00:00Z'), new Date('2026-03-10T14:00:00Z'));
    const byMonth = dayDensity([one], year, sp);
    expect([...byMonth.keys()]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(byMonth.get(3)?.daysWithAppointments).toBe(1);
    expect(byMonth.get(3)?.dayKeys).toEqual(['2026-03-10']);
    expect(byMonth.get(1)?.daysWithAppointments).toBe(0);
    expect(byMonth.get(1)?.dayKeys).toEqual([]);
  });

  it('ano bissexto: 29/02 conta como dia de fevereiro', () => {
    const leapYear = userYearRange(new Date('2028-06-01T12:00:00Z'), sp);
    const feb29 = item(new Date('2028-02-29T12:00:00Z'), new Date('2028-02-29T13:00:00Z'));
    expect(dayDensity([feb29], leapYear, sp).get(2)?.dayKeys).toEqual(['2028-02-29']);
  });

  it('mês com todos os 31 dias ocupados: densidade 31 (julho/2026)', () => {
    const items = Array.from({ length: 31 }, (_, i) => {
      const day = String(i + 1).padStart(2, '0');
      // 12:00 local = 15:00Z — nunca cruza a meia-noite
      const startsAt = new Date(`2026-07-${day}T15:00:00Z`);
      return item(startsAt, new Date(startsAt.getTime() + 3_600_000), `d${i}`);
    });
    const july = dayDensity(items, year, sp).get(7);
    expect(july?.daysWithAppointments).toBe(31);
    expect(july?.dayKeys).toHaveLength(31);
    expect(july?.dayKeys[0]).toBe('2026-07-01');
    expect(july?.dayKeys[30]).toBe('2026-07-31');
  });

  it('dayKeys em ordem cronológica; item que cruza a meia-noite conta no dia de início', () => {
    const overnight = item(new Date('2026-10-11T02:50:00Z'), new Date('2026-10-11T03:10:00Z'));
    const normal = item(new Date('2026-10-03T13:00:00Z'), new Date('2026-10-03T14:00:00Z'));
    const oct = dayDensity([overnight, normal], year, sp).get(10);
    expect(oct?.dayKeys).toEqual(['2026-10-03', '2026-10-10']);
    expect(oct?.daysWithAppointments).toBe(2);
  });

  it('sem itens: todos os meses do período com 0 dias (visão Ano vazia)', () => {
    const byMonth = dayDensity([], year, sp);
    expect([...byMonth.values()].every((m) => m.daysWithAppointments === 0)).toBe(true);
  });
});
