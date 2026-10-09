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
 * Visão Dia com GRADE de horas (plano grades-dia-semana-mes, Etapa 1.4): linhas
 * `day-slot-HH` no fuso do usuário, bloco posicionado em % (top/height do
 * layoutDayTimeline), clique em célula vazia → criar NAQUELE dia+hora, clique no
 * bloco → detalhes, e o número do dia SEMPRE no DOM em Mês/Semana (regressão 1.2).
 * Harness igual ao calendar-views.spec (service mockado na borda, âncora fixa via
 * localStorage, visão trocada pela instância `window.__agenda`).
 */

vi.mock('vue-sonner', () => ({
  toast: Object.assign(() => undefined, { error: vi.fn(), success: vi.fn(), info: vi.fn() }),
}));
vi.mock('../src/app/composables/queries/useReview.query', () => ({
  useReviewQuery: () => ({ data: { value: undefined } }),
}));

const TZ = 'America/Sao_Paulo';
/** agora fixo: qui 08/10/2026 09:00 SP (testing.md — datas fixas). */
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

/** fixtures de 08/10/2026 (SP): 11:00–12:30 e par em conflito 11:00–12:00/11:30–12:30. */
const FIXTURES: AppointmentDto[] = [
  appt({
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Dentista',
    startsAt: new Date('2026-10-08T14:00:00.000Z'), // 11:00 SP
    endsAt: new Date('2026-10-08T15:30:00.000Z'), // 12:30 SP
  }),
  appt({
    id: '22222222-2222-4222-8222-222222222222',
    title: 'Call overlap',
    startsAt: new Date('2026-10-08T14:30:00.000Z'), // 11:30 SP (choca com Dentista)
    endsAt: new Date('2026-10-08T15:00:00.000Z'), // 12:00 SP
  }),
];

const list = vi.fn();
// spy na borda do service, UMA vez (mesmo padrão do calendar-views.spec: se o spy
// fosse instalado depois do import, o queryFn real vaza e tenta GET real)
vi.spyOn(appointmentsService.appointmentsApi, 'list').mockImplementation(list);

/** items da CENA do teste atual (undefined = FIXTURES; null = vazio). */
let sceneItems: AppointmentDto[] | null | undefined;

function mountAgenda(opts: { items?: AppointmentDto[] | null } = {}) {
  sceneItems = 'items' in opts ? (opts.items ?? null) : undefined;
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
  if (mounteds.__mounteds) mounteds.__mounteds.push(w);
  else mounteds.__mounteds = [w];
  const q = (sel: string): HTMLElement | null => document.querySelector(sel);
  const qa = (sel: string): HTMLElement[] => Array.from(document.querySelectorAll(sel));
  const live = {
    find: (sel: string) => wrap(q(sel)),
    findAll: (sel: string) => qa(sel).map((el) => wrap(el)),
    text: () => document.body.textContent ?? '',
  };
  function wrap(el: HTMLElement | null) {
    return {
      exists: () => el !== null,
      text: () => el?.textContent?.trim() ?? '',
      attributes: (name?: string) => (name ? (el?.getAttribute(name) ?? undefined) : undefined),
      style: (prop: string) => {
        // lê o style REAL do elemento; `calc(...)` (left/width) não é parseável —
        // os testes de largura usam `styleRaw` e extraem o % do calc
        if (!el) return undefined;
        return (el.style as unknown as Record<string, string>)[prop] || undefined;
      },
      styleRaw: () => el?.getAttribute('style') ?? '',
      element: el ?? (undefined as unknown as HTMLElement),
      trigger: async (event: string) => {
        el?.dispatchEvent(new window.Event(event, { bubbles: true, cancelable: true }));
        await flushPromises();
      },
    };
  }
  return {
    w: live,
    get agenda(): UseAgendaPage {
      const a = (window as unknown as { __agenda?: UseAgendaPage }).__agenda;
      if (!a) throw new Error('hook window.__agenda ausente (linha @test-hook)');
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

async function nav(h: ReturnType<typeof mountAgenda>, testId: string) {
  await h.w.find(`[data-testid="${testId}"]`).trigger('click');
  await settle();
}

afterEach(() => {
  (globalThis as unknown as { __mounteds?: Array<{ unmount(): void }> }).__mounteds?.forEach((m) =>
    m.unmount(),
  );
  (globalThis as unknown as { __mounteds?: Array<{ unmount(): void }> }).__mounteds = [];
  (document.activeElement as HTMLElement | null)?.blur?.();
});

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  list.mockReset();
  vi.restoreAllMocks();
  // reinstala o spy da borda do service (restore derrubou a implementação) e a
  // impl PERSISTENTE por cena: uma cena por teste vale para TODAS as queries dele
  // (navegação ‹ → nova query do novo período); a cena é definida em mountAgenda.
  vi.spyOn(appointmentsService.appointmentsApi, 'list').mockImplementation(list);
  list.mockImplementation(async () => ({
    items: sceneItems === undefined ? FIXTURES : sceneItems,
  }));
  vi.useFakeTimers({ toFake: ['setInterval'], now: NOW.getTime() });
});

describe('Visão Dia com grade (grades-dia-semana-mes Etapa 1)', () => {
  it('grade com 24 linhas day-slot-HH no fuso do usuário (00..23, -03:00)', async () => {
    const h = mountAgenda();
    await settle();
    expect(h.w.find('[data-testid="day-grid"]').exists()).toBe(true);
    expect(h.w.findAll('[data-testid^="day-slot-button-"]').length).toBe(24);
    expect(h.w.find('[data-testid="day-slot-00"]').exists()).toBe(true);
    expect(h.w.find('[data-testid="day-slot-23"]').exists()).toBe(true);
    // a célula 00:00 LOCAL existe mesmo com o dia começando às 03:00Z (meia-noite local)
    // R7/a11y: o rótulo vive no BOTÃO (o gridcell pai não repete mais o aria-label)
    expect(h.w.find('[data-testid="day-slot-button-00"]').attributes('aria-label')).toContain('00:00');
  });

  it('bloco posicionado com estilo top/height % do layoutDayTimeline (11:00–12:30 SP)', async () => {
    const h = mountAgenda();
    await settle();
    const block = h.w.find('[data-testid="day-block-11111111-1111-4111-8111-111111111111"]');
    expect(block.exists()).toBe(true);
    // top = 11/24*100 ≈ 45.83%, height = 90/1440*100 = 6.25%
    expect(parseFloat(String(block.style('top')))).toBeCloseTo((11 / 24) * 100, 2);
    expect(parseFloat(String(block.style('height')))).toBeCloseTo((90 / 1440) * 100, 2);
    // título + horário dentro do bloco
    expect(block.text()).toContain('Dentista');
    expect(block.text()).toContain('11:00');
    // lista do dia continua ABAIXO da grade (notações legíveis preservadas)
    expect(h.w.find('[data-testid="day-list"]').exists()).toBe(true);
    expect(h.w.text()).toContain('via web');
  });

  it('sobrepostos lado a lado: os dois blocos do par em conflito têm largura 50%', async () => {
    const h = mountAgenda();
    await settle();
    const a = h.w.find('[data-testid="day-block-11111111-1111-4111-8111-111111111111"]');
    const b = h.w.find('[data-testid="day-block-22222222-2222-4222-8222-222222222222"]');
    // width/left vêm como calc(50% - 4px)/calc(N% + 2px) — extrai o % do calc
    const pct = (raw: string, prop: string) =>
      Number(new RegExp(`${prop}:\\s*calc\\(\\s*([\\d.]+)%`).exec(raw)?.[1]);
    expect(pct(a.styleRaw(), 'width')).toBeCloseTo(50, 1);
    expect(pct(b.styleRaw(), 'width')).toBeCloseTo(50, 1);
    // left distintos (colunas 0 e 1)
    expect(a.styleRaw()).not.toBe(b.styleRaw());
  });

  it('clique em célula VAZIA da grade → criar NAQUELE dia+hora (14:00 → 14:00, não 09:00)', async () => {
    const h = mountAgenda();
    await settle();
    await h.w.find('[data-testid="day-slot-button-14"]').trigger('click');
    await settle();
    const date = document.getElementById('ap-date') as HTMLInputElement | null;
    const time = document.getElementById('ap-time') as HTMLInputElement | null;
    expect(date?.value).toBe('2026-10-08');
    expect(time?.value).toBe('14:00');
  });

  it('clique no BLOCO abre os detalhes do compromisso (editar a partir deles)', async () => {
    const h = mountAgenda();
    await settle();
    await h.w.find('[data-testid="day-block-11111111-1111-4111-8111-111111111111"]').trigger('click');
    await settle();
    const dialogText = document.body.textContent ?? '';
    expect(dialogText).toContain('Dentista');
    expect(dialogText).toContain('Excluir');
    // navegação nenhuma: a grade continua lá
    expect(h.w.find('[data-testid="day-grid"]').exists()).toBe(true);
  });

  it('dia SEM compromissos: grade navegável continua + aviso "Nada neste dia."', async () => {
    const h = mountAgenda({ items: [] });
    await settle();
    expect(h.w.find('[data-testid="day-grid"]').exists()).toBe(true);
    expect(h.w.findAll('[data-testid^="day-slot-button-"]').length).toBe(24);
    expect(h.w.text()).toContain('Nada neste dia.');
    // e dá para criar às 15:00 mesmo sem nada no dia
    await h.w.find('[data-testid="day-slot-button-15"]').trigger('click');
    await settle();
    const time = document.getElementById('ap-time') as HTMLInputElement | null;
    expect(time?.value).toBe('15:00');
  });  it('regressão 1.2: número do dia SEMPRE no DOM na visão Mês (sem hidden só-md)', async () => {
    const h = mountAgenda();
    await settle();
    await tab(h, 'month');
    // o número do dia é o ÚNICO span com o data-testid cell-day-* (não some no mobile)
    const el = h.w.find('[data-testid="daynum-2026-10-08"]').element;
    expect(el.textContent?.trim()).toBe('8');
    const cls = el.getAttribute('class') ?? '';
    expect(cls).not.toMatch(/(^|\s)hidden(\s|$)/);
  });

  it('regressão 1.2: número/label do dia SEMPRE no DOM na visão Semana', async () => {
    const h = mountAgenda();
    await settle();
    await tab(h, 'week');
    const el = h.w.find('[data-testid="week-day-number-2026-10-08"]').element;
    expect(el.textContent).toContain('8');
    const cls = el.getAttribute('class') ?? '';
    expect(cls).not.toMatch(/(^|\s)hidden(\s|$)/);
  });

  it('regressão: semana VAZIA mostra as 7 colunas (dias navegáveis) + aviso discreto, nunca o ícone vazio', async () => {
    const h = mountAgenda({ items: [] });
    await settle();
    await tab(h, 'week');
    // as 7 colunas continuam lá (cada uma é alvo de navegar/criar — B.7)
    expect(h.w.findAll('[data-testid^="week-day-20"]').length).toBe(7);
    expect(h.w.find('[data-testid="week-day-number-2026-10-08"]').exists()).toBe(true);
    // aviso discreto em texto, SEM o bloco de ícone (Inbox) do empty antigo
    expect(h.w.text()).toContain('Nada nesta semana.');
    expect(h.w.find('[data-testid="week-empty-icon"]').exists()).toBe(false);
  });

  it('navegação ‹ mantém a grade no novo dia (grade navegável)', async () => {
    // SEM compromissos no período: o dia 09 está vazio e a grade continua lá.
    const h = mountAgenda({ items: [] });
    await settle();
    await nav(h, 'nav-next');
    expect(h.w.find('[data-testid="agenda-heading"]').text()).toContain('9 de out');
    expect(h.w.find('[data-testid="day-grid"]').exists()).toBe(true);
    // dia vazio: grade continua, com aviso
    expect(h.w.text()).toContain('Nada neste dia.');
  });
});
