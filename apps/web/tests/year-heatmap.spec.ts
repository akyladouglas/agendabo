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
 * Spec visao-ano-heatmap (Gherkin): visão Ano como heatmap UNIFORME dos 12 meses do
 * ANO CIVIL da âncora, com a query cobrindo o ano inteiro:
 * - altura uniforme: 12 cards com grade de 42 células de tamanho FIXO (`h-2.5 w-2.5`,
 *   nunca `aspect-square`) — assert determinístico no markup (happy-dom não mede
 *   layout, então a invariante testável é a classe fixa + as 42 células);
 * - heat dos 12 meses derivado da query do ano (fev e dez com bolinha, não só out);
 * - multi-dia na FRONTIRA do ano: 01/02-01 marcados, 31/12 do ano anterior sem célula;
 * - clique no mês → Mês daquele mês; clique na bolinha → Dia (desktop);
 * - mês vazio: mesma grade, contagem 0 no aria-label;
 * - conflito em dia com compromisso → tom de danger na bolinha.
 * Harness idêntico ao calendar-views.spec (service na borda, âncora e agora fixos,
 * stubs de FocusScope/FocusGuards e unmount no afterEach — gotchas 10/19).
 */

vi.mock('vue-sonner', () => ({
  toast: Object.assign(() => undefined, { error: vi.fn(), success: vi.fn(), info: vi.fn() }),
}));
vi.mock('../src/app/composables/queries/useReview.query', () => ({
  useReviewQuery: () => ({ data: { value: undefined } }),
}));

const TZ = 'America/Sao_Paulo';
/** agora fixo: qui 08/10/2026 09:00 SP (cena do calendar-views.spec). */
const NOW = new Date('2026-10-08T12:00:00.000Z');

function appt(
  over: Partial<AppointmentDto> & Pick<AppointmentDto, 'id' | 'startsAt' | 'endsAt'>,
): AppointmentDto {
  return {
    title: 'Compromisso',
    notes: null,
    status: 'confirmed',
    origin: 'web',
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    ...over,
  };
}

const list = vi.fn();
vi.spyOn(appointmentsService.appointmentsApi, 'list').mockImplementation(list);

function mountAgenda(opts: { items?: AppointmentDto[] } = {}): {
  w: {
    find(sel: string): {
      exists(): boolean;
      text(): string;
      attributes(name: string): string | undefined;
      trigger(event: string): Promise<void>;
    };
    findAll(sel: string): Array<{ attributes(name: string): string | undefined }>;
    text(): string;
  };
  agenda: UseAgendaPage;
  unmount(): void;
} {
  vi.stubGlobal('matchMedia', (query: string) => ({
    // SEMPRE desktop: o heatmap uniforme é o objeto desta spec (a lista mobile é R.16
    // da spec mãe e já tem cena própria no multi-day-views/calendar-views)
    matches: query.includes('768'),
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
  list.mockResolvedValue({ items: opts.items ?? [] });
  localStorage.setItem('agenda:anchor', '2026-10-08');
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
    attributes: (name: string) => el?.getAttribute(name) ?? undefined,
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

async function tab(h: ReturnType<typeof mountAgenda>, view: 'year') {
  h.agenda.setView(view);
  await settle();
}

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  list.mockReset();
  vi.restoreAllMocks();
  // reinstala o spy da borda do service (restore derrubou a implementação) e a
  // resposta default — sem isto o `list` fica sem impl e a query não resolve
  vi.spyOn(appointmentsService.appointmentsApi, 'list').mockImplementation(list);
  list.mockResolvedValue({ items: [] });
  // `Date` fake também: o "hoje" do composable nasce de `new Date()` na borda
  vi.useFakeTimers({ toFake: ['setInterval', 'Date'], now: NOW.getTime() });
});

afterEach(() => {
  (globalThis as unknown as { __mounteds?: Array<{ unmount(): void }> }).__mounteds?.forEach((m) =>
    m.unmount(),
  );
  (globalThis as unknown as { __mounteds?: Array<{ unmount(): void }> }).__mounteds = [];
  (document.activeElement as HTMLElement | null)?.blur?.();
  vi.useRealTimers();
});

describe('visão Ano — heatmap uniforme (spec visao-ano-heatmap)', () => {
  /** fevereiro e dezembro do ano da âncora + outubro (mês da âncora). */
  const MULTI_MONTH = () => [
    appt({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      startsAt: new Date('2026-02-10T13:00:00.000Z'), // ter 10/02 10:00 SP
      endsAt: new Date('2026-02-10T14:00:00.000Z'),
    }),
    appt({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      startsAt: new Date('2026-12-25T13:00:00.000Z'), // sex 25/12 10:00 SP
      endsAt: new Date('2026-12-25T14:00:00.000Z'),
    }),
    appt({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      startsAt: new Date('2026-10-15T13:00:00.000Z'),
      endsAt: new Date('2026-10-15T14:00:00.000Z'),
    }),
  ];

  it('query da visão Ano = ano civil local da âncora (userYearRange, C1)', async () => {
    const h = mountAgenda();
    await settle();
    await tab(h, 'year');
    const call = list.mock.calls.at(-1)!;
    // `zonedTimeToUtc({2026,1,1}, -180)` = Date.UTC(2026,0,1) + 3h = 03:00Z de
    // 01/01/2026 (dia longo p/ -03:00; é o instante que a API recebe como `from`);
    // fim exclusive = o MESMO cálculo para 01/01/2027. Half-open de 365 dias.
    expect(call[0]).toBe('2026-01-01T03:00:00.000Z');
    expect(call[1]).toBe('2027-01-01T03:00:00.000Z');
    expect(Date.parse(String(call[1])) - Date.parse(String(call[0]))).toBe(365 * 86_400_000);
    h.unmount();
  });

  it('heat dos 12 meses com a query do ano: fev e dez têm bolinha, não só out (causa (b))', async () => {
    const h = mountAgenda({ items: MULTI_MONTH() });
    await settle();
    await tab(h, 'year');
    expect(h.w.find('[data-testid="year-dot-2-2026-02-10"]').exists()).toBe(true);
    expect(h.w.find('[data-testid="year-dot-12-2026-12-25"]').exists()).toBe(true);
    expect(h.w.find('[data-testid="year-dot-10-2026-10-15"]').exists()).toBe(true);
    // aria-label de contagem preservado (A5)
    expect(h.w.find('[data-testid="year-mini-2"]').attributes('aria-label')).toBe(
      'fev: 1 dia com compromissos',
    );
    h.unmount();
  });

  it('altura uniforme: 12 cards × 42 células de tamanho fixo, sem aspect-square (A1)', async () => {
    const h = mountAgenda({ items: MULTI_MONTH() });
    await settle();
    await tab(h, 'year');
    const cards = h.w.findAll('[data-testid^="year-mini-"]');
    expect(cards).toHaveLength(12);
    // assert por card: 42 células de tamanho fixo no heatmap (bolinha clicável +
    // placeholder vazio — ambas `h-2.5 w-2.5`)
    for (const mini of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']) {
      const card = document.querySelector(`[data-testid="year-mini-${mini}"]`);
      expect(card).not.toBeNull();
      const cells = Array.from(
        card!.querySelectorAll('button[data-testid^="year-dot-"], span[data-testid^="year-empty-"], span:not([data-testid])'),
      ).filter((el) => el.classList.contains('h-2.5'));
      expect(cells).toHaveLength(42);
      for (const cell of cells) {
        const cls = cell.getAttribute('class') ?? '';
        expect(cls).toContain('h-2.5');
        expect(cls).toContain('w-2.5');
        expect(cls).not.toContain('aspect-square');
      }
    }
    h.unmount();
  });

  it('multi-dia na fronteira do ano: 01 e 02/01 marcados no ano novo; 31/12 do anterior sem célula', async () => {
    // réveillon 31/12/2026 20:00 SP → 02/01/2027 10:00 SP (nasce FORA do heatmap de
    // 2027, morre dentro)
    const rveillon = appt({
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      startsAt: new Date('2026-12-31T23:00:00.000Z'), // = 31/12/2026 20:00 SP
      endsAt: new Date('2027-01-02T13:00:00.000Z'), // = 02/01/2027 10:00 SP
    });
    const h = mountAgenda({ items: [rveillon] });
    await settle();
    // ano EXIBIDO 2027 (âncora movida para 01/01/2027 — o que o → faz)
    h.agenda.setDate('2027-01-01');
    await tab(h, 'year');
    expect(h.w.find('[data-testid="year-dot-1-2027-01-01"]').exists()).toBe(true);
    expect(h.w.find('[data-testid="year-dot-1-2027-01-02"]').exists()).toBe(true);
    // não existe célula de 31/12/2026 no heatmap de 2027 (a query é do ANO exibido)
    expect(h.w.find('[data-testid^="year-dot-"][data-testid$="2026-12-31"]').exists()).toBe(false);
    expect(h.w.find('[data-testid^="year-empty-2026-12-31"]').exists()).toBe(false);
    // os DIAS DEZEMBRO DE 2027 do heatmap (25..31) existem e estão VAZIOS — o que a
    // cena prova é que nada de dez/2027 vira bolinha. (A contagem "dez" do card é a
    // do mês CALENDÁRIO 12 do range, e o leading/trailing entre anos só aparece como
    // célula vazia — as linhas acima cobrem exatamente isso.)
    expect(document.querySelector('[data-testid^="year-dot-"][data-testid$="2027-12-25"]')).toBeNull();
    expect(document.querySelector('[data-testid="year-empty-2027-12-25"]')).not.toBeNull();
    // janeiro/2027 é o mês da âncora: destacado, com os 2 dias do réveillon contados
    expect(document.querySelector('[data-testid="year-month-1"]')?.getAttribute('aria-label')).toBe(
      'jan: 2 dias com compromissos',
    );
    h.unmount();
  });

  it('clique na bolinha (desktop) → visão Dia daquele dia (A3)', async () => {
    const h = mountAgenda({ items: MULTI_MONTH() });
    await settle();
    await tab(h, 'year');
    await h.w.find('[data-testid="year-dot-2-2026-02-10"]').trigger('click');
    await settle();
    expect(h.w.find('[data-testid="agenda-heading"]').text()).toContain('10 de fev');
    h.unmount();
  });

  it('clique no botão do mês (desktop) → visão Mês do mês clicado (A4)', async () => {
    const h = mountAgenda({ items: MULTI_MONTH() });
    await settle();
    await tab(h, 'year');
    await h.w.find('[data-testid="year-month-4"]').trigger('click');
    await settle();
    expect(h.w.find('[data-testid="month-grid"]').exists()).toBe(true);
    expect(h.w.find('[data-testid="agenda-heading"]').text()).toContain('abril');
    h.unmount();
  });

  it('dia com conflito usa tom de danger; hoje mantém o anel de primária (A2/D5)', async () => {
    // par em conflito num dia PASSADO (15/10): a bolinha leva o tom de danger; 08/10
    // é o "hoje" da cena e mantém o anel (precedência hoje > conflito, D5)
    const a = appt({
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      startsAt: new Date('2026-10-15T14:00:00.000Z'), // qui 15/10 11:00 SP
      endsAt: new Date('2026-10-15T15:00:00.000Z'),
    });
    const b = appt({
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      startsAt: new Date('2026-10-15T14:30:00.000Z'), // choca com a
      endsAt: new Date('2026-10-15T15:30:00.000Z'),
    });
    const today = appt({
      id: 'abababab-abab-4aba-8bab-abababababab',
      startsAt: new Date('2026-10-08T11:00:00.000Z'), // hoje na cena (agora fake)
      endsAt: new Date('2026-10-08T12:30:00.000Z'),
    });
    const h = mountAgenda({ items: [a, b, today] });
    await settle();
    await tab(h, 'year');
    const conflictDot = document.querySelector(
      '[data-testid="year-dot-10-2026-10-15"] span',
    ) as HTMLElement | null;
    expect(conflictDot?.getAttribute('class')).toContain('bg-danger/70');
    const todayDot = document.querySelector(
      '[data-testid="year-dot-10-2026-10-08"] span',
    ) as HTMLElement | null;
    expect(todayDot?.getAttribute('class')).toContain('ring-primary');
    expect(todayDot?.getAttribute('class')).not.toContain('bg-danger');
    h.unmount();
  });

  it('navegação → troca o ANO da âncora e a query reexecuta para 2027 (C3)', async () => {
    const h = mountAgenda();
    await settle();
    await tab(h, 'year');
    h.agenda.shift(1);
    await settle();
    const call = list.mock.calls.at(-1)!;
    expect(call[0]).toBe('2027-01-01T03:00:00.000Z');
    expect(call[1]).toBe('2028-01-01T03:00:00.000Z');
    expect(h.w.find('[data-testid="agenda-heading"]').text()).toContain('2027');
    h.unmount();
  });
});
