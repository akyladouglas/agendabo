import { describe, expect, it } from 'vitest';
import { layoutDayTimeline } from './layoutDayTimeline';
import { userDayRange } from './dates';

/**
 * TDD (testing.md — data nasce com teste): posicionamento dos blocos da grade
 * da visão Dia (Etapa 1, plano grades-dia-semana-mes 1.1). Base fixa: -180.
 * Meia-noite LOCAL do dia civil = 03:00Z (offset -180), meia-noite seguinte = 03:00Z(+1d).
 */
const sp = -180;

function item(id: string, startsAt: string, endsAt: string, title = `t${id}`) {
  return { id, title, startsAt: new Date(startsAt), endsAt: new Date(endsAt) };
}

/** Grade do dia civil 08/10 (-180): 08/10 03:00Z → 09/10 03:00Z. */
function day() {
  return userDayRange(new Date('2026-10-08T12:00:00Z'), sp);
}

describe('layoutDayTimeline — posição % na grade do dia (1.1)', () => {
  it('bloco simples 09:00–10:30 local: top/height ∝ minutos da GRADE (independe do offset)', () => {
    const d = day();
    const blocks = layoutDayTimeline(
      [item('a', '2026-10-08T12:00:00.000Z', '2026-10-08T13:30:00.000Z')], // 09:00–10:30 SP
      d,
      sp,
    );
    expect(blocks).toHaveLength(1);
    const b = blocks[0]!;
    expect(b.top).toBeCloseTo((9 / 24) * 100, 6);
    expect(b.height).toBeCloseTo((90 / 1440) * 100, 6);
    expect(b.column).toBe(0);
    expect(b.columns).toBe(1);
    expect(b.isPast).toBe(false);
    expect(b.localHourUtc).toBe('09');
  });

  it('âncora = hora de INÍCIO LOCAL: compromisso 23:00–00:30 local começa na linha das 23h e é clampado ao fim da grade', () => {
    const d = day();
    const blocks = layoutDayTimeline(
      [item('late', '2026-10-09T02:00:00.000Z', '2026-10-09T03:30:00.000Z')], // 23:00→00:30 local
      d,
      sp,
    );
    const b = blocks[0]!;
    expect(b.top).toBeCloseTo((23 / 24) * 100, 6);
    // 90min pedidos, 60min até o fim da grade → clampa
    expect(b.height).toBeCloseTo((60 / 1440) * 100, 6);
    expect(b.localHourUtc).toBe('23');
  });

  it('travessia de dia: compromisso 23:50 local do dia ANTERIOR até 00:10 do dia da grade entra clampado ao topo', () => {
    const d = day();
    const blocks = layoutDayTimeline(
      // 23:50(07/10) = 02:50Z(08); 00:10(08/10) = 03:10Z(08) — cruza a meia-noite local
      [item('cross', '2026-10-08T02:50:00.000Z', '2026-10-08T03:10:00.000Z')],
      d,
      sp,
    );
    expect(blocks).toHaveLength(1);
    const b = blocks[0]!;
    // âncora = início local (23h do dia anterior) → antes da grade → clampa no topo
    expect(b.top).toBeCloseTo(0, 6);
    expect(b.height).toBeCloseTo((10 / 1440) * 100, 6); // visível até 00:10
  });

  it('item encostado no FIM da grade (termina na meia-noite local) NÃO entra (half-open)', () => {
    const d = day();
    const blocks = layoutDayTimeline(
      // termina em 03:00Z(08) = MEIA-NOITE local do dia da grade → é do dia anterior
      [item('edge', '2026-10-08T01:00:00.000Z', '2026-10-08T03:00:00.000Z')],
      d,
      sp,
    );
    expect(blocks).toHaveLength(0);
  });

  it('sobreposição 3 encadeados: colunas gulosas 0/1/2, largura 1/3, ordem estável por startsAt depois id', () => {
    const d = day();
    // três blocos aos pares sobrepostos com 3 vivos ao mesmo tempo (09:35–09:40):
    // UM grupo de 3 colunas
    const blocks = layoutDayTimeline(
      [
        item('b', '2026-10-08T12:20:00.000Z', '2026-10-08T13:20:00.000Z'), // 09:20–10:20
        item('a', '2026-10-08T12:00:00.000Z', '2026-10-08T12:45:00.000Z'), // 09:00–09:45
        item('c', '2026-10-08T12:40:00.000Z', '2026-10-08T13:40:00.000Z'), // 09:40–10:40
      ],
      d,
      sp,
    );
    const byId = Object.fromEntries(blocks.map((bl) => [bl.item.id, bl]));
    // guloso, ordem estável por startsAt: a→0; b→1 (coluna de a ocupada às 09:20);
    // c→2 (às 09:40 nem a nem b terminaram)
    expect(byId['a']!.columns).toBe(3);
    expect(byId['b']!.columns).toBe(3);
    expect(byId['c']!.columns).toBe(3);
    expect(byId['a']!.column).toBe(0);
    expect(byId['b']!.column).toBe(1);
    expect(byId['c']!.column).toBe(2);
    expect(byId['a']!.width).toBeCloseTo(100 / 3, 6);
    // entrada em outra ordem NÃO muda a atribuição id→coluna (ordem estável)
    const again = layoutDayTimeline(
      [
        item('c', '2026-10-08T12:40:00.000Z', '2026-10-08T13:40:00.000Z'),
        item('b', '2026-10-08T12:20:00.000Z', '2026-10-08T13:20:00.000Z'),
        item('a', '2026-10-08T12:00:00.000Z', '2026-10-08T12:45:00.000Z'),
      ],
      d,
      sp,
    );
    const asMap = (arr: typeof blocks) =>
      [...arr].sort((x, y) => (x.item.id < y.item.id ? -1 : 1)).map((bl) => [bl.item.id, bl.column]);
    expect(asMap(again)).toEqual(asMap(blocks));
  });

  it('empate exato em startsAt: desempate por id (ordem estável)', () => {
    const d = day();
    const blocks = layoutDayTimeline(
      [
        item('z', '2026-10-08T12:00:00.000Z', '2026-10-08T13:00:00.000Z'),
        item('y', '2026-10-08T12:00:00.000Z', '2026-10-08T13:00:00.000Z'),
      ],
      d,
      sp,
    );
    expect(blocks.map((b) => [b.item.id, b.column])).toEqual([
      ['y', 0],
      ['z', 1],
    ]);
    expect(blocks[0]!.width).toBeCloseTo(50, 6);
  });

  it('encostado NÃO sobrepõe: A 09–10 e C 10–11 encostados, B 09:30–10:30 ponte → colunas 0/1 e 0', () => {
    const d = day();
    const blocks = layoutDayTimeline(
      [
        item('A', '2026-10-08T12:00:00.000Z', '2026-10-08T13:00:00.000Z'), // 09–10
        item('B', '2026-10-08T12:30:00.000Z', '2026-10-08T13:30:00.000Z'), // 09:30–10:30
        item('C', '2026-10-08T13:00:00.000Z', '2026-10-08T14:00:00.000Z'), // 10–11
      ],
      d,
      sp,
    );
    const byId = Object.fromEntries(blocks.map((b) => [b.item.id, b]));
    // um ÚNICO grupo (B mantém a cadeia viva): A→0, B→1, C→0 (coluna de A livre às 10h)
    expect(byId['A']!.column).toBe(0);
    expect(byId['B']!.column).toBe(1);
    expect(byId['C']!.column).toBe(0);
    expect(byId['A']!.columns).toBe(2);
  });

  it('isPast: bloco passado quando o AGORA passa do FIM (injetável; sem now = nunca passado)', () => {
    const d = day();
    const items = [
      item('past', '2026-10-08T10:00:00.000Z', '2026-10-08T11:00:00.000Z'), // 07–08 local
      item('now', '2026-10-08T12:00:00.000Z', '2026-10-08T13:00:00.000Z'), // 09–10 local
    ];
    const withNow = layoutDayTimeline(items, d, sp, new Date('2026-10-08T12:31:00Z')); // 09:31 local
    const byId = Object.fromEntries(withNow.map((b) => [b.item.id, b]));
    // passado = o AGORA passou do FIM do bloco (half-open); rodando/aguardando não
    expect(byId['past']!.isPast).toBe(true); // acabou às 08:00, agora é 09:31
    expect(byId['now']!.isPast).toBe(false); // 09–10: está ACONTECENDO às 09:31
    // no EXATO fim o bloco JÁ é passado (>=; half-open — a Página esmaece com a
    // mesma regra `endsAt < now` da lista: 10:00 em ponto, o bloco 09–10 é passado)
    const atEnd = layoutDayTimeline(items, d, sp, new Date('2026-10-08T13:00:00Z')); // 10:00 em ponto
    expect(Object.fromEntries(atEnd.map((b) => [b.item.id, b.isPast]))['now']).toBe(true);
    const noNow = layoutDayTimeline(items, d, sp);
    expect(noNow.every((b) => b.isPast === false)).toBe(true);
  });

  it('offset ≠ 0 vs 0: a grade em % é a MESMA para o mesmo horário local (offset só deriva a âncora)', () => {
    const dayUtc = userDayRange(new Date('2026-10-08T12:00:00Z'), 0);
    const utc = layoutDayTimeline(
      [item('a', '2026-10-08T09:00:00.000Z', '2026-10-08T10:00:00.000Z')],
      dayUtc,
      0,
    );
    const spBlocks = layoutDayTimeline(
      [item('a', '2026-10-08T12:00:00.000Z', '2026-10-08T13:00:00.000Z')], // 09–10 SP
      day(),
      sp,
    );
    expect(utc[0]!.top).toBeCloseTo(spBlocks[0]!.top, 6);
    expect(utc[0]!.height).toBeCloseTo(spBlocks[0]!.height, 6);
    expect(utc[0]!.localHourUtc).toBe('09');
    expect(spBlocks[0]!.localHourUtc).toBe('09');
  });

  it('duração ≥ o que resta da grade: altura clampada, nunca estoura os 100%', () => {
    const d = day();
    const blocks = layoutDayTimeline(
      // 04:00Z(08) = 01:00 local; +26h → termina depois do fim da grade
      [item('big', '2026-10-08T04:00:00.000Z', '2026-10-09T06:00:00.000Z')],
      d,
      sp,
    );
    expect(blocks[0]!.top).toBeCloseTo((1 / 24) * 100, 6);
    expect(blocks[0]!.height).toBeCloseTo((23 / 24) * 100, 6); // 01:00 → fim da grade
  });

  it('itens vazios → array vazio', () => {
    expect(layoutDayTimeline([], day(), sp)).toEqual([]);
  });
});
