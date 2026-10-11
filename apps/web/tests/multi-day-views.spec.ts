import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import type { AppointmentDto } from '@agendabo/contracts';
import * as appointmentsService from '../src/app/services/appointments';
import type { UseAgendaPage } from '../src/app/composables/useAgendaPage.composable';
import { useAuthStore } from '../src/app/store/authStore';
import AgendaPage from '../src/view/pages/agenda/AgendaPage.vue';

/**
 * Spec multi-dia-nas-visoes (Gherkin "Web"): a viagem sáb 10/10 23:00 → seg
 * 12/10 17:00 (America/Sao_Paulo, 11/10 02:00Z → 12/10 20:00Z) aparece RECORTADA
 * em cada dia que TOCA:
 * - Semana: blocos nas colunas 10 ("23:00–24:00 ↦"), 11 ("↤ 00:00–24:00 ↦") e
 *   12 ("↤ 00:00–17:00") — `week-item-<id>` repete por coluna (D7) e o clique
 *   abre o MESMO compromisso;
 * - Mês: chip nos 3 dias, só o dia de início COM hora, meio/fim "dia inteiro";
 * - Dia: 10/10 = faixa 23:00→fim-do-dia (top 23/24, altura 1/24) com ↦; 11/10 =
 *   dia inteiro com ↤ e ↦; 12/10 = 00:00→17:00 só com ↤; a lista do dia traz o
 *   período INTEGRAL (D.4/M8);
 * - densidade do Ano: bolinha em cada dia TOCADO (E.8).
 * Marcadores da decisão D4: "↤" quando o recorte VEIO de outro dia
 * (continuesBefore), "↦" quando ele CONTINUA depois (continuesAfter).
 * Harness igual ao day-grid.spec (service na borda, âncora fixa, agora fixo,
 * stubs de FocusScope/FocusGuards e unmount no afterEach — gotchas 10/19).
 */

vi.mock('vue-sonner', () => ({
  toast: Object.assign(() => undefined, { error: vi.fn(), success: vi.fn(), info: vi.fn() }),
}));
vi.mock('../src/app/composables/queries/useReview.query', () => ({
  useReviewQuery: () => ({ data: { value: undefined } }),
}));

const TZ = 'America/Sao_Paulo';
/** agora fixo: dom 11/10/2026 09:00 SP (12:00Z) — no meio da viagem. */
const NOW = new Date('2026-10-11T12:00:00.000Z');
const TRIP_ID = '33333333-3333-4333-8333-333333333333';

function appt(
  over: Partial<AppointmentDto> & Pick<AppointmentDto, 'id' | 'startsAt' | 'endsAt'>,
): AppointmentDto {
  return {
    title: 'Compromisso',
    notes: null,
    status: 'confirmed',
    origin: 'bot',
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    ...over,
  };
}

/** Viagem: sáb 10/10 23:00 SP → seg 12/10 17:00 SP (11/10 02:00Z → 12/10 20:00Z). */
const TRIP = appt({
  id: TRIP_ID,
  title: 'Viagem',
  startsAt: new Date('2026-10-11T02:00:00.000Z'),
  endsAt: new Date('2026-10-12T20:00:00.000Z'),
});

const list = vi.fn();
vi.spyOn(appointmentsService.appointmentsApi, 'list').mockImplementation(list);

function mountAgenda() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().setUser({
    id: 'u1',
    email: 'ana@email.com',
    timezone: TZ,
    resumoDiarioHora: '08:00',
    resumoDiarioAtivo: true,
    isAdmin: false,
    name: 'Ana',
  });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }],
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, refetchOnWindowFocus: false } },
  });
  localStorage.setItem('agenda:anchor', '2026-10-11');
  delete (window as unknown as { __agenda?: unknown }).__agenda;
  const w = mount(AgendaPage, {
    attachTo: document.body,
    global: {
      stubs: {
        RouterLink: { props: { to: {} }, template: '<a><slot /></a>' },
        DialogPortal: { template: '<div><slot /></div>' },
        DialogOverlay: true,
        FocusScope: { template: '<div><slot /></div>' },
        FocusGuards: true,
      },
      plugins: [pinia, [VueQueryPlugin, { queryClient: qc }], router],
    },
  });
  const mounteds = globalThis as unknown as { __mounteds?: Array<{ unmount(): void }> };
  (mounteds.__mounteds ??= []).push(w);
  const q = (sel: string): HTMLElement | null => document.querySelector(sel);
  const wrap = (el: HTMLElement | null) => ({
    exists: () => el !== null,
    text: () => el?.textContent?.trim() ?? '',
    attributes: (name?: string) => (name ? (el?.getAttribute(name) ?? undefined) : undefined),
    styleRaw: () => el?.getAttribute('style') ?? '',
    element: el ?? (undefined as unknown as HTMLElement),
    trigger: async (event: string) => {
      el?.dispatchEvent(new window.Event(event, { bubbles: true, cancelable: true }));
      await flushPromises();
    },
  });
  return {
    w: {
      find: (sel: string) => wrap(q(sel)),
      findAll: (sel: string) =>
        Array.from(document.querySelectorAll(sel)).map((el) => wrap(el as HTMLElement)),
      text: () => document.body.textContent ?? '',
    },
    get agenda(): UseAgendaPage {
      const a = (window as unknown as { __agenda?: UseAgendaPage }).__agenda;
      if (!a) throw new Error('hook window.__agenda ausente');
      return a;
    },
    unmount: () => w.unmount(),
  };
}

const settle = async () => {
  await flushPromises();
  await new Promise((r) => setTimeout(r, 30));
  await flushPromises();
};

async function tab(h: ReturnType<typeof mountAgenda>, view: 'day' | 'week' | 'month' | 'year') {
  h.agenda.setView(view);
  await settle();
}

/** Posições em % do estilo bruto do bloco (left/width vêm como calc() — só top/height). */
const pct = (raw: string, prop: string): number =>
  Number(new RegExp(`${prop}:\\s*([\\d.]+)%`).exec(raw)?.[1] ?? '-1');

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  list.mockReset();
  vi.restoreAllMocks();
  vi.spyOn(appointmentsService.appointmentsApi, 'list').mockImplementation(list);
  list.mockImplementation(async () => ({ items: [TRIP] }));
  vi.useFakeTimers({ toFake: ['setInterval'], now: NOW.getTime() });
});

afterEach(() => {
  (globalThis as unknown as { __mounteds?: Array<{ unmount(): void }> }).__mounteds?.forEach((m) =>
    m.unmount(),
  );
  (globalThis as unknown as { __mounteds?: Array<{ unmount(): void }> }).__mounteds = [];
  (document.activeElement as HTMLElement | null)?.blur?.();
  vi.useRealTimers();
});

describe('multi-dia nas visões (spec multi-dia-nas-visoes)', () => {
  /** Viagem NASCENDO na semana da cena: seg 12 14:00 → qua 14 17:00 SP. */
  const BORN = () =>
    appt({
      id: TRIP_ID,
      title: 'Viagem',
      startsAt: new Date('2026-10-12T17:00:00.000Z'), // seg 12 14:00 SP
      endsAt: new Date('2026-10-14T20:00:00.000Z'), // qua 14 17:00 SP
    });

  it('Semana: a viagem aparece nas 3 colunas tocadas, cada bloco rotulado pelo RECORTE do dia com os marcadores ↤/↦', async () => {
    list.mockImplementation(async () => ({ items: [BORN()] }));
    const h = mountAgenda();
    await settle();
    await tab(h, 'week');
    const blocks = h.w.findAll(`[data-testid="week-item-${TRIP_ID}"]`);
    // `week-item-<id>` PODE repetir (decisão D7: um bloco por (item, dia tocado))
    expect(blocks.length).toBe(3);
    const inCol = (date: string) =>
      document.querySelector(`[data-testid="week-day-${date}"] [data-testid="week-item-${TRIP_ID}"]`);
    // dia de início: recorte 14:00→fim-do-dia com ↦ (o fim meia-noite é rotulado
    // 23:59 — half-open, nunca "00:00" com dia deslizante)
    expect(inCol('2026-10-12')?.textContent).toContain('14:00–23:59 ↦');
    // dia do meio: dia inteiro com ↤ (veio de antes) e ↦ (continua depois)
    expect(inCol('2026-10-13')?.textContent).toContain('↤ 00:00–23:59 ↦');
    // dia final: recorte 00:00→17:00 com ↤ e o fim REAL visível
    expect(inCol('2026-10-14')?.textContent).toContain('↤ 00:00–17:00');
    h.unmount();
  });

  it('Semana: a viagem da cena (âncora 11/10) aparece em TODO dia tocado da grade — inclusive nascendo fora da semana da query', async () => {
    // TRIP nasce sáb 10/10 23:00 (fora da grade dom 11..sáb 17); a carga por
    // intersecção a traz pelo FIM e a coluna da segunda a recebe recortada (D7)
    const h = mountAgenda();
    await settle();
    await tab(h, 'week');
    const inCol = (date: string) =>
      document.querySelector(`[data-testid="week-day-${date}"] [data-testid="week-item-${TRIP_ID}"]`);
    expect(inCol('2026-10-11')?.textContent).toContain('↤ 00:00–23:59 ↦');
    expect(inCol('2026-10-12')?.textContent).toContain('↤ 00:00–17:00');
    h.unmount();
  });

  it('Semana: o recorte do dia de início não vira "23:00–00:00" e as alturas são do RECORTE (meio = dia inteiro)', async () => {
    // viagem NASCENDO na semana da cena (seg 12 14:00 → qua 14 17:00 SP): o slice
    // do dia de início existe na grade com o recorte 14:00→fim-do-dia
    list.mockImplementation(async () => ({
      items: [
        appt({
          id: TRIP_ID,
          title: 'Viagem',
          startsAt: new Date('2026-10-12T17:00:00.000Z'), // seg 12 14:00 SP
          endsAt: new Date('2026-10-14T20:00:00.000Z'), // qua 14 17:00 SP
        }),
      ],
    }));
    const h = mountAgenda();
    await settle();
    await tab(h, 'week');
    const seg = h.w
      .find(`[data-testid="week-day-2026-10-12"] [data-testid="week-item-${TRIP_ID}"]`)
      .element;
    // o fim meia-noite do recorte é rotulado 23:59 (half-open) — NUNCA "00:00"
    // com dia deslizante ("14:00–ter 13/10 00:00", o bug antigo do fim falso)
    expect(seg.textContent).toContain('14:00–23:59 ↦');
    expect(seg.textContent).not.toMatch(/14:00–(ter )?00:00/);
    const ter = h.w
      .find(`[data-testid="week-day-2026-10-13"] [data-testid="week-item-${TRIP_ID}"]`)
      .element;
    expect(pct(ter.getAttribute('style') ?? '', 'top')).toBeCloseTo(0, 1);
    expect(pct(ter.getAttribute('style') ?? '', 'height')).toBeCloseTo(100, 1);
    const qua = h.w
      .find(`[data-testid="week-day-2026-10-14"] [data-testid="week-item-${TRIP_ID}"]`)
      .element;
    expect(pct(qua.getAttribute('style') ?? '', 'top')).toBeCloseTo(0, 1);
    expect(pct(qua.getAttribute('style') ?? '', 'height')).toBeCloseTo((17 / 24) * 100, 1);
    h.unmount();
  });

  it('Semana: os 3 blocos recortados abrem o MESMO compromisso (clique → detalhes com o período integral)', async () => {
    list.mockImplementation(async () => ({ items: [BORN()] }));
    const h = mountAgenda();
    await settle();
    await tab(h, 'week');
    const blocks = h.w.findAll(`[data-testid="week-item-${TRIP_ID}"]`);
    expect(blocks.length).toBe(3);
    await blocks[1]!.trigger('click');
    await settle();
    expect(document.body.textContent).toContain('Viagem');
    // painel C2: início E fim integrais — o clique no RECORTE abre o item todo
    expect(document.body.textContent).toMatch(/seg 12\/10 14:00/);
    expect(document.body.textContent).toMatch(/→ qua 14\/10 17:00/);
    h.unmount();
  });

  it('Mês: chip nos 3 dias tocados — só o dia de início COM hora; meio/fim "dia inteiro" sem hora', async () => {
    const h = mountAgenda();
    await settle();
    await tab(h, 'month');
    const chip = (date: string) =>
      document.querySelector(`[data-testid="cell-${date}"] [data-testid="chip-open-${TRIP_ID}"]`);
    expect(chip('2026-10-10')).not.toBeNull();
    expect(chip('2026-10-11')).not.toBeNull();
    expect(chip('2026-10-12')).not.toBeNull();
    // O chip inteiro é o <span> pai do botão "Abrir"; o tempo vive no PRIMEIRO <span>
    const chipTime = (date: string) =>
      chip(date)?.closest('span')?.querySelector('span')?.textContent ?? '';
    // dia de início: hora de início + marcador de continuação (23:00 ↦)
    expect(chipTime('2026-10-10')).toBe('23:00 ↦');
    // dias do meio/fim: SEM hora, "dia inteiro" com o marcador da DIREÇÃO de onde o
    // item VEIO (review 2026-10-11): ↦ prefixado = veio do dia anterior (meio e fim).
    expect(chipTime('2026-10-11')).toBe('↦ dia inteiro');
    expect(chipTime('2026-10-12')).toBe('↦ dia inteiro');
    h.unmount();
  });

  it('Mês: o chip de dia tocado abre os detalhes do MESMO compromisso', async () => {
    const h = mountAgenda();
    await settle();
    await tab(h, 'month');
    expect(h.w.find('[data-testid="cell-2026-10-11"]').exists()).toBe(true);
    const open = document.querySelector(
      `[data-testid="cell-2026-10-11"] [data-testid="chip-open-${TRIP_ID}"]`,
    ) as HTMLElement;
    open.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
    await settle();
    expect(document.body.textContent).toContain('Viagem');
    expect(document.body.textContent).toContain('Excluir');
    // navegar pelos detalhes NÃO troca a visão
    expect(h.w.find('[data-testid="month-grid"]').exists()).toBe(true);
    h.unmount();
  });

  it('Dia 10/10 (começa aqui, termina depois): faixa 23:00→fim-do-dia (top 23/24, altura 1/24) com ↦ e lista com o período COMPLETO', async () => {
    const h = mountAgenda();
    await settle();
    h.agenda.setDate('2026-10-10');
    await settle();
    const block = h.w.find(`[data-testid="day-block-${TRIP_ID}"]`);
    expect(block.exists()).toBe(true);
    expect(pct(block.styleRaw(), 'top')).toBeCloseTo((23 / 24) * 100, 1);
    expect(pct(block.styleRaw(), 'height')).toBeCloseTo((1 / 24) * 100, 1);
    // rótulo do recorte com marcador de continuação (vai para outro dia; fim
    // meia-noite rotulado 23:59 — half-open)
    expect(block.text()).toContain('23:00–23:59 ↦');
    expect(block.attributes('aria-label')).toContain('↦');
    // D.4: a lista do dia mostra o item "de fora" com o período INTEGRAL
    const listText = h.w.find('[data-testid="day-list"]').text();
    expect(listText).toContain('Viagem');
    expect(listText).toContain('23:00–seg 12/10 17:00');
    h.unmount();
  });

  it('Dia 11/10 (começa antes e termina depois): bloco de dia inteiro (0% a 100%) com ↤ e ↦ nos dois lados', async () => {
    const h = mountAgenda();
    await settle();
    h.agenda.setDate('2026-10-11');
    await settle();
    const block = h.w.find(`[data-testid="day-block-${TRIP_ID}"]`);
    expect(block.exists()).toBe(true);
    expect(pct(block.styleRaw(), 'top')).toBeCloseTo(0, 1);
    expect(pct(block.styleRaw(), 'height')).toBeCloseTo(100, 1);
    expect(block.text()).toContain('↤ 00:00–23:59 ↦');
    expect(block.attributes('aria-label')).toContain('↤');
    expect(block.attributes('aria-label')).toContain('↦');
    h.unmount();
  });

  it('Dia 12/10 (dia final): bloco 00:00→17:00 (altura 17/24) com o fim real no rótulo e só ↤', async () => {
    const h = mountAgenda();
    await settle();
    h.agenda.setDate('2026-10-12');
    await settle();
    const block = h.w.find(`[data-testid="day-block-${TRIP_ID}"]`);
    expect(block.exists()).toBe(true);
    expect(pct(block.styleRaw(), 'top')).toBeCloseTo(0, 1);
    expect(pct(block.styleRaw(), 'height')).toBeCloseTo((17 / 24) * 100, 1);
    expect(block.text()).toContain('↤ 00:00–17:00');
    expect(block.text()).not.toContain('00:00–24:00');
    expect(block.attributes('aria-label')).toContain('↤');
    h.unmount();
  });

  it('Ano: a densidade marca os 3 dias TOCADOS (E.8) — bolinhas em 10, 11 e 12/10', async () => {
    const h = mountAgenda();
    await settle();
    await tab(h, 'year');
    expect(h.w.find('[data-testid="year-dot-2026-10-10"]').exists()).toBe(true);
    expect(h.w.find('[data-testid="year-dot-2026-10-11"]').exists()).toBe(true);
    expect(h.w.find('[data-testid="year-dot-2026-10-12"]').exists()).toBe(true);
    h.unmount();
  });

  it('painel de detalhes: período multi-dia com o INÍCIO junto do fim ("sáb 10/10 23:00 → seg 12/10 17:00")', async () => {
    const h = mountAgenda();
    await settle();
    // a âncora é 11/10: o bloco da grade é o RECORTE do dia (dia inteiro) — o
    // clique abre o compromisso INTEGRAL com o período completo no painel (C2)
    await h.w.find(`[data-testid="day-block-${TRIP_ID}"]`).trigger('click');
    await settle();
    const text = h.w.text();
    expect(text).toContain('Viagem');
    expect(text).toMatch(/sáb 10\/10 23:00/);
    expect(text).toMatch(/→ seg 12\/10 17:00/);
    h.unmount();
  });
});
