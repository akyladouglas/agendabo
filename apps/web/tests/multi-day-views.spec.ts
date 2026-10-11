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
 * Spec notas-e-fim-na-web, critérios C (Gherkin): bloco sáb 23:00 → seg 17:00
 * (multi-dia, criado pelo bot) aparece na visão Dia de SEGUNDA com altura do
 * `layoutDayTimeline` (clamp por dia — comportamento vigente) e RÓTULO/aria-label
 * com o fim visível; na Semana cada coluna dia mostra o segmento com rótulo
 * coerente de `formatRangeInTz`; o painel de detalhes traz o dia do início junto.
 * Harness igual ao day-grid.spec (service na borda, âncora fixa, agora fixo).
 */

vi.mock('vue-sonner', () => ({
  toast: Object.assign(() => undefined, { error: vi.fn(), success: vi.fn(), info: vi.fn() }),
}));
vi.mock('../src/app/composables/queries/useReview.query', () => ({
  useReviewQuery: () => ({ data: { value: undefined } }),
}));

const TZ = 'America/Sao_Paulo';
/** agora fixo: seg 12/10/2026 09:00 SP (12:00Z) — dentro do compromisso multi-dia. */
const NOW = new Date('2026-10-12T12:00:00.000Z');
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

/** Viagem: sáb 10/10 23:00 SP → seg 12/10 17:00 SP (02:00Z→20:00Z). */
const TRIP = appt({
  id: TRIP_ID,
  title: 'Viagem',
  startsAt: new Date('2026-10-11T02:00:00.000Z'),
  endsAt: new Date('2026-10-12T20:00:00.000Z'),
});

const list = vi.fn();
vi.spyOn(appointmentsService.appointmentsApi, 'list').mockImplementation(list);

function mountAgenda(_items: AppointmentDto[]) {
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
  localStorage.setItem('agenda:anchor', '2026-10-12');
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
  if (mounteds.__mounteds) mounteds.__mounteds.push(w);
  else mounteds.__mounteds = [w];
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

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  list.mockReset();
  vi.restoreAllMocks();
  vi.spyOn(appointmentsService.appointmentsApi, 'list').mockImplementation(list);
  list.mockImplementation(async () => ({ items: listItems }));
  vi.useFakeTimers({ toFake: ['setInterval'], now: NOW.getTime() });
});

let listItems: AppointmentDto[];

afterEach(() => {
  (globalThis as unknown as { __mounteds?: Array<{ unmount(): void }> }).__mounteds?.forEach((m) =>
    m.unmount(),
  );
  (globalThis as unknown as { __mounteds?: Array<{ unmount(): void }> }).__mounteds = [];
  (document.activeElement as HTMLElement | null)?.blur?.();
  vi.useRealTimers();
});

describe('C — agenda mostra o fim multi-dia (spec notas-e-fim-na-web)', () => {
  it('visão Dia de SEGUNDA: bloco da viagem com clamp do layoutDayTimeline e rótulo/aria-label trazendo o fim 17:00', async () => {
    listItems = [TRIP];
    const h = mountAgenda(listItems);
    await settle();
    const block = h.w.find(`[data-testid="day-block-${TRIP_ID}"]`);
    expect(block.exists()).toBe(true);
    // clamp por dia (layoutDayTimeline): começa 00:00 local (top 0%) e vai até 17:00
    // (17/24*100 ≈ 70.83%) — a altura vem do endsAt, nunca de "3960 minutos"
    const style = block.styleRaw();
    expect(parseFloat(/top:\s*([\d.]+)%/.exec(style)?.[1] ?? '-1')).toBeCloseTo(0, 1);
    expect(parseFloat(/height:\s*([\d.]+)%/.exec(style)?.[1] ?? '-1')).toBeCloseTo(
      (17 / 24) * 100,
      1,
    );
    // rótulo do período com o fim visível no dia em que o bloco termina
    expect(block.text()).toContain('17:00');
    expect(block.attributes('aria-label')).toContain('17:00');
    h.unmount();
  });

  it('aria-label na SEGUNDA usa formatRangeInTz: fim no MESMO dia local (17:00) e hora do início deslizadas', async () => {
    listItems = [TRIP];
    const h = mountAgenda(listItems);
    await settle();
    const label = h.w
      .find(`[data-testid="day-block-${TRIP_ID}"]`)
      .attributes('aria-label') as string;
    // formato vigente do formatRangeInTz quando o clamp faz o trecho ser do mesmo dia
    expect(label).toContain('Viagem');
    expect(label).toMatch(/\d{2}:\d{2}/);
    expect(label).toContain('17:00');
    h.unmount();
  });

  it('visão Semana: um multi-dia que NASCE na semana da query aparece na grade com rótulo coerente', async () => {
    // grade dom 18..sáb 24/10 (âncora 12 não alterada aqui: a semana civil da
    // âncora seg 12 é 12..18; o item abaixo nasce DENTRO dela: seg 12 14:00 →
    // qua 14 17:00 SP) — a coluna da segunda mostra o trecho com fim visível
    const weekTrip = appt({
      id: TRIP_ID,
      title: 'Viagem',
      startsAt: new Date('2026-10-12T17:00:00.000Z'), // seg 12/10 14:00 SP
      endsAt: new Date('2026-10-14T20:00:00.000Z'), // qua 14/10 17:00 SP
    });
    listItems = [weekTrip];
    const h = mountAgenda(listItems);
    await settle();
    h.agenda.setView('week');
    await settle();
    const blocks = h.w.findAll(`[data-testid="week-item-${TRIP_ID}"]`);
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    // coluna da segunda (dia da âncora): o trecho começa 14:00 e o rótulo é
    // coerente com o formatRangeInTz (rótulo do período integral)
    const weekDaySegunda = h.w.find('[data-testid="week-day-2026-10-12"]');
    expect(weekDaySegunda.exists()).toBe(true);
    expect(weekDaySegunda.text()).toContain('Viagem');
    expect(blocks[0]!.attributes('aria-label')).toContain('Viagem');
    expect(blocks[0]!.attributes('aria-label')).toContain('17:00');
    h.unmount();
  });

  it('visão Semana: segment multi-dia mostra o fim real com dia (não "23:00–02:00")', async () => {
    // Espelho do bug do 08/10: item multi-dia desenhado na grade que rotulava o
    // fim como "23:00–02:00". O segmento da grade usa formatRangeInTz e mostra o
    // fim com dia ("14:00–qua 14/10 17:00", regras C1/B9). O bucketing por dia de
    // início é o existente (schedule-core intocado): o segmento nasce na coluna
    // do dia de início e carrega o fim completo.
    const weekTrip = appt({
      id: TRIP_ID,
      title: 'Viagem',
      startsAt: new Date('2026-10-12T17:00:00.000Z'), // seg 12/10 14:00 SP
      endsAt: new Date('2026-10-14T20:00:00.000Z'), // qua 14/10 17:00 SP
    });
    listItems = [weekTrip];
    const h = mountAgenda(listItems);
    await settle();
    h.agenda.setView('week');
    await settle();
    const blocks = h.w.findAll(`[data-testid="week-item-${TRIP_ID}"]`);
    expect(blocks.length).toBe(1);
    const block = blocks[0]!;
    expect(block.text()).toContain('qua 14/10 17:00');
    expect(block.text()).not.toMatch(/14:00–02:00/);
    expect(block.attributes('aria-label')).toContain('14:00–qua 14/10 17:00');
    h.unmount();
  });

  it('painel de detalhes: período multi-dia com o dia do INÍCIO junto do traço ("sáb … · 23:00–seg 12/10 17:00")', async () => {
    listItems = [TRIP];
    const h = mountAgenda(listItems);
    await settle();
    await h.w.find(`[data-testid="day-block-${TRIP_ID}"]`).trigger('click');
    await settle();
    const text = h.w.text();
    expect(text).toContain('Viagem');
    // C2: painel de detalhe com o FIM completo — "... → seg 12/10 17:00"
    expect(text).toMatch(/→ seg 12\/10 17:00/);
    expect(text).toMatch(/sáb 10\/10 23:00/);
    h.unmount();
  });
});
