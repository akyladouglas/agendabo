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
 * Smoke das 4 visões da agenda (Fase 7, spec calendario-visoes — critérios
 * "Navegação e visões" + "Interação"): render Dia/Semana/Mês/Ano com fixtures,
 * trocar de mês troca o período da query, Ano→clique no mini-mês→Mês, célula vazia
 * → modal de criar com a data da célula + 09:00, ir-para ancora no dia 1,
 * persistência da view. A API é mockada na borda do service (o query Zod-parseia o
 * DTO de verdade).
 *
 * Determinismo: QueryClient e pinia NOVOS por teste (o cache TanStack do plugin é
 * por app — nada de singleton global). A troca de aba por RADIX Tabs não responde a
 * eventos sintéticos do happy-dom (RovingFocus), então a HARNESS troca de visão
 * direto na instância do composable (spy na borda do módulo); o click nas abas em
 * si é coberto pelo smoke manual E2E do plano.
 */

vi.mock('vue-sonner', () => ({
  toast: Object.assign(() => undefined, { error: vi.fn(), success: vi.fn(), info: vi.fn() }),
}));

// A fila de revisão do AppLayout dispararia de verdade sem este mock (ECONNREFUSED
// sem infra); a página em teste não depende dela.
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

/** fixtures de OUTUBRO/2026 (SP): 08 com par em conflito, 15 com um item. */
const FIXTURES: AppointmentDto[] = [
  appt({
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Dentista',
    startsAt: new Date('2026-10-08T14:00:00.000Z'), // 11:00 SP
    endsAt: new Date('2026-10-08T15:00:00.000Z'),
  }),
  appt({
    id: '22222222-2222-4222-8222-222222222222',
    title: 'Call overlap',
    startsAt: new Date('2026-10-08T14:30:00.000Z'), // choca com o Dentista (C.12)
    endsAt: new Date('2026-10-08T15:30:00.000Z'),
    origin: 'bot',
  }),
  appt({
    id: '33333333-3333-4333-8333-333333333333',
    title: 'Academia',
    startsAt: new Date('2026-10-15T22:00:00.000Z'), // 15/10 19:00 SP
    endsAt: new Date('2026-10-15T23:00:00.000Z'),
  }),
];

const list = vi.fn();
// spy na borda do service, UMA vez (antes do import da página): mockReset por teste
// mantém a implementação — se o spy fosse instalado depois do import, o queryFn real
// (capturado na montagem do módulo) vaza e o teste tenta GET real (ECONNREFUSED).
vi.spyOn(appointmentsService.appointmentsApi, 'list').mockImplementation(list);

type LiveEl = {
  exists(): boolean;
  text(): string;
  attributes(name?: string): string | undefined | Record<string, string>;
  element: HTMLElement;
  trigger(event: string): Promise<void>;
};
type Harness = {
  w: {
    find(sel: string): LiveEl;
    findAll(sel: string): LiveEl[];
    text(): string;
    html(): string;
  };
  agenda: ReturnType<typeof import('../src/app/composables/useAgendaPage.composable').useAgendaPage>;
  unmount(): void;
};

function mountAgenda(opts: { desktop?: boolean; view?: string; items?: AppointmentDto[] | null } = {}): Harness {
  vi.stubGlobal(
    'matchMedia',
    (query: string) => ({
      matches: opts.desktop === true && query.includes('768'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  );
  // pinia do teste tem de ser a MESMA instância usada dentro do setup (setActivePinia)
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().setUser({
    id: 'u1',
    email: 'ana@email.com',
    timezone: TZ,
    resumoDiarioHora: '08:00',
    resumoDiarioAtivo: true,
    name: 'Ana',
  });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }],
  });
  // QueryClient NOVO por mount: o cache de um teste nunca vaza no outro.
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, refetchOnWindowFocus: false } },
  });
  list.mockImplementation(async () => ({ items: opts.items === null ? [] : (opts.items ?? FIXTURES) }));
  // A página expõe a instância do composable em window.__agenda (linha marcada
  // @test-hook no produto). Os testes NUNCA chamam useAgendaPage direto: spy no
  // módulo ESM pode recursar (o componente chama o próprio binding spyado) e
  // fora de setup o contexto de injeção fica vazio.
  //
  // ÂNCORA determinística no dia da cena (agora fake = 08/10): sem isto a âncora
  // nasce no "hoje" REAL do executor e a cena (fixtures/outubro) muda de mês.
  localStorage.setItem('agenda:anchor', '2026-10-08');
  delete (window as unknown as { __agenda?: unknown }).__agenda;
  const w = mount(AgendaPage, {
    attachTo: document.body,
    global: {
      // radix Dialog em portal (padrão app-nav.spec): o conteúdo do Dialog sai do
      // wrapper — os asserts do modal leem document.body.
      stubs: {
        RouterLink: { props: { to: {} }, template: '<a><slot /></a>' },
        DialogPortal: { template: '<div><slot /></div>' },
        DialogOverlay: true,
        // radix FocusScope é a ÚNICA fonte de rejeição solta no harness: o
        // `focusin` do DismissableLayer é `async` (await nextTick) e, quando o
        // teste termina com o dialog aberto e o body trocado no teste seguinte,
        // roda com `document.activeElement === null` e morre em `null.closest`
        // (vitest fecha com código 1). O foco preso/Esc é do radix real e é
        // verificado no E2E manual do plano — aqui o que importa é o form/fluxo.
        FocusScope: { template: '<div><slot /></div>' },
        FocusGuards: true,
      },
      plugins: [pinia, [VueQueryPlugin, { queryClient: qc }], router],
    },
  });
  const g = globalThis as unknown as { __mounteds?: Array<{ unmount(): void }> };
  (g.__mounteds ??= []).push(w);
  // O root element da página é um COMENTÁRIO de fragmento (template com o layout
  // + dois diálogos irmãos); `w.find` a partir dele acha zero nós e `w.element`
  // pode ficar órfão entre patches. O `attachTo` é o DOM VIVO: o proxy consulta
  // `document.body` a cada `find`/`text` e devolve wrappers VTU reais (trigger
  // funciona). É a raiz de busca do teste, não uma reimplementação do wrapper.
  const q = (sel: string): HTMLElement | null => document.querySelector(sel);
  const qa = (sel: string): HTMLElement[] => Array.from(document.querySelectorAll(sel));
  const live = {
    find: (sel: string) => mount2(q(sel)),
    findAll: (sel: string) => qa(sel).map((el) => mount2(el)),
    text: () => document.body.textContent ?? '',
    html: () => document.body.innerHTML,
    vm: w.vm,
  };
  function mount2(el: HTMLElement | null) {
    return {
      exists: () => el !== null,
      text: () => el?.textContent?.trim() ?? '',
      attributes: (name?: string) => (name ? (el?.getAttribute(name) ?? undefined) : Object.fromEntries(el ? Array.from(el.attributes).map((a2) => [a2.name, a2.value]) : [])),
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

/** Troca de visão pela HARNESS (a aba radix é verificada só estruturalmente). */
async function tab(h: Harness, view: 'day' | 'week' | 'month' | 'year') {
  h.agenda.setView(view);
  await settle();
}

async function nav(h: Harness, testId: string) {
  await h.w.find(`[data-testid="${testId}"]`).trigger('click');
  await settle();
}

/**
 * UNMOUNT explícito (o `attachTo` cola no body vivo e o VTU não desmonta sozinho):
 * com o radix Dialog aberto, o `focusin` que o happy-dom dispara quando o foco
 * ESCAPA do documento cai no listener do DismissableLayer COM `event.target` null
 * e o radix morre em `null.closest` — rejection não-tratada que faz o vitest
 * fechar com código 1 a despeito de todos os testes passarem.
 */
afterEach(() => {
  (globalThis as unknown as { __mounteds?: Array<{ unmount(): void }> }).__mounteds?.forEach((m) => m.unmount());
  (globalThis as unknown as { __mounteds?: Array<{ unmount(): void }> }).__mounteds = [];
  // radix DismissableLayer (Select/Dialog em portal): o `focusin` com `event.target`
  // null (foco escapando do documento entre testes) morre em `null.closest` — a
  // mesma rejeição do dialog, agora também do popper do Select. Desmontar com o
  // foco DENTRO do documento fecha a janela: blur + body de volta ao document.
  (document.activeElement as HTMLElement | null)?.blur?.();
  if (document.activeElement === null) document.body.focus?.();
  (document.activeElement as HTMLElement | null)?.blur?.();
});

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  list.mockReset().mockResolvedValue({ items: FIXTURES });
  vi.restoreAllMocks();
  // reinstala o spy da borda do service (restore derrubou a implementação)
  vi.spyOn(appointmentsService.appointmentsApi, 'list').mockImplementation(list);
  // SÓ setInterval é fake (o tick de `now` do app); timers de I/O seguem reais.
  vi.useFakeTimers({ toFake: ['setInterval'], now: NOW.getTime() });
});

describe('Agenda — 4 visões (Fase 7)', () => {
  it('<md abre no Dia (padrão vigente) com a lista do dia e o conflito marcado', async () => {
    const h = mountAgenda();
    await settle();
    expect(h.w.find('[data-testid="agenda-heading"]').text()).toContain('8 de out');
    expect(h.w.text()).toContain('Dentista');
    expect(h.w.text()).toContain('Call overlap');
    // C.12: o par sobreposto confirmado ganha marcação de conflito
    expect(h.w.findAll('[data-conflicted="true"]').length).toBeGreaterThan(0);
    expect(list).toHaveBeenCalledWith(
      '2026-10-08T03:00:00.000Z',
      '2026-10-09T03:00:00.000Z',
    );
  });

  it('≥md abre na Semana; tabs Dia | Semana | Mês | Ano; colunas dom..sáb com grade de horas', async () => {
    const h = mountAgenda({ desktop: true });
    await settle();
    const labels = h.w.findAll('[role="tab"]').map((t) => t.text());
    expect(labels).toEqual(['Dia', 'Semana', 'Mês', 'Ano']);
    expect(h.w.find('[data-testid="week-grid"]').exists()).toBe(true);
    // domingo 04/10 .. sábado 10/10 (grade dom..sáb da semana da âncora)
    expect(h.w.find('[data-testid="week-day-2026-10-04"]').exists()).toBe(true);
    expect(h.w.find('[data-testid="week-day-2026-10-10"]').exists()).toBe(true);
    // cada coluna é uma mini-grade de horas (24 células) com o heading dom..sáb
    expect(h.w.findAll('[data-testid^="week-cell-2026-10-04-"]').length).toBe(24);
    expect(h.w.find('[data-testid="agenda-heading"]').text()).toContain('4');
    expect(h.w.find('[data-testid="agenda-heading"]').text()).toContain('10');
    // o bloco do dia aparece POSICIONADO na coluna (overlay), não empilhado
    expect(h.w.find('[data-testid^="week-item-"]').exists()).toBe(true);
    expect(h.w.text()).toContain('Dentista');
  });

  it('Mês: 42 células com hoje marcado; ‹ troca o mês e a query (grade estendida)', async () => {
    const h = mountAgenda();
    await settle();
    await tab(h, 'month');
    expect(h.w.find('[data-testid="month-grid"]').exists()).toBe(true);
    // R8/a11y: o role="grid" caiu (sem keyboard model) — as 42 células são
    // botões com testid; a contagem é por testid agora
    expect(h.w.findAll('[data-testid^="cell-"]')).toHaveLength(42);
    expect(h.w.find('[data-testid="cell-2026-10-08"]').exists()).toBe(true);
    expect(h.w.text()).toContain('outubro');

    await nav(h, 'nav-prev');
        expect(h.w.text()).toContain('setembro');
    const sept = list.mock.calls.at(-1)!;
    // grade de setembro: 30/08 (dom, meia-noite local -03:00) + 42 dias — B.8
    expect(sept[0]).toBe('2026-08-30T03:00:00.000Z');
    expect(Date.parse(String(sept[1])) - Date.parse(String(sept[0]))).toBe(42 * 86_400_000);
  });

  it('trocar de visão MANTÉM a âncora: Mês→Ano mostra o ano da âncora', async () => {
    const h = mountAgenda();
    await settle();
    await tab(h, 'month');
    await tab(h, 'year');
    expect(h.w.find('[data-testid="agenda-heading"]').text()).toContain('2026');
    expect(h.w.findAll('[data-testid^="year-mini-"]').length).toBe(12);
    // densidade por dia com compromisso (dayDensity): 08/10 e 15/10
    expect(h.w.find('[data-testid="year-dot-2026-10-08"]').exists()).toBe(true);
    expect(h.w.find('[data-testid="year-dot-2026-10-15"]').exists()).toBe(true);
  });

  it('Ano → clique no mini-mês de julho → visão Mês de julho', async () => {
    const h = mountAgenda();
    await settle();
    await tab(h, 'year');
    await h.w.find('[data-testid="year-mini-7"]').trigger('click');
    await settle();
    expect(h.w.find('[data-testid="month-grid"]').exists()).toBe(true);
    expect(h.w.find('[data-testid="agenda-heading"]').text()).toContain('julho');
  });

  it('célula vazia do Mês → modal criar com a data da célula e hora 09:00 (Aberto #5)', async () => {
    const h = mountAgenda();
    await settle();
    await tab(h, 'month');
    await h.w.find('[data-testid="cell-2026-10-22"]').trigger('click');
    await settle();
    const date = document.getElementById('ap-date') as HTMLInputElement | null;
    const time = document.getElementById('ap-time') as HTMLInputElement | null;
    expect(date?.value).toBe('2026-10-22');
    expect(time?.value).toBe('09:00');
  });

  it('célula COM compromissos → visão Dia daquele dia (B.7) mantendo a âncora', async () => {
    const h = mountAgenda();
    await settle();
    await tab(h, 'month');
    await h.w.find('[data-testid="cell-2026-10-15"]').trigger('click');
    await settle();
    expect(h.w.find('[data-testid="agenda-heading"]').text()).toContain('15 de out');
    expect(h.w.text()).toContain('Academia');
  });

  it('ir-para do Mês ancora no dia 1 do mês destino (Aberto #6)', async () => {
    const h = mountAgenda();
    await settle();
    await tab(h, 'month');
    // RADIX Select NÃO é testável no happy-dom: o popper usa PointerEvents +
    // posicionamento reais, e o DismissableLayer morre em `null.closest`
    // (rejeição solta, 2 por interação) ao trocar de teste com o popper aberto
    // — o harness stub Dialog/FocusScope mas Select não. O ir-para funcional é
    // exercitado pelo SMOKE E2E-browser (plano fase 7, "ir-para ancora no dia
    // 1", verificado 2026-10-09); aqui fica a regressão estrutural: AppSelect
    // no lugar do <select> nativo (a causa do popup claro ilegível em tema
    // escuro — relato do usuário).
    const trigger = h.w.find('[data-testid="jump-month"]');
    expect(trigger.exists()).toBe(true);
    expect(trigger.element.tagName).toBe('BUTTON'); // gatilho radix, não <select>
    expect(trigger.attributes('aria-expanded')).toBe('false');
    expect(trigger.text()).toContain('outubro');
  });

  it('persiste a escolha de view em localStorage', async () => {
    const h = mountAgenda();
    await settle();
    await tab(h, 'month');
    expect(localStorage.getItem('agenda:view')).toBe('month');
  });

  it('mes sem compromissos renderiza a grade mesmo vazia (clicavel p/ criar, B.7)', async () => {
    const h = mountAgenda({ items: [] });
    await settle();
    await tab(h, 'month');
    // smoke E2E (fase 7): Mês/Ano NUNCA viram "empty" — a grade vazia e o alvo de
    // clique para criar compromisso num dia livre. O vazio e um aviso discreto
    // ACIMA da grade (R.15 ajustada), nunca no lugar dela.
    expect(h.w.find('[data-testid="month-grid"]').exists()).toBe(true);
    expect(h.w.findAll('[data-testid^="cell-"]')).toHaveLength(42);
    expect(h.w.text()).toContain('Nada neste mês.'); // aviso discreto role=status
  });

  it('chip do mês abre os DETALHES do compromisso (modal existente)', async () => {
    const h = mountAgenda();
    await settle();
    await tab(h, 'month');
    // o "Abrir" do chip (área ≥44px no mobile) para a propagação → detalhes, não Dia
    await h.w
      .find('[data-testid="chip-open-11111111-1111-4111-8111-111111111111"]')
      .trigger('click');
    await settle();
    // visão continua Mês (detalhes não navegam) e o dialog traz o título + excluir
    expect(h.w.find('[data-testid="month-grid"]').exists()).toBe(true);
    const dialogText = document.body.textContent ?? '';
    expect(dialogText).toContain('Dentista');
    expect(dialogText).toContain('Excluir');
  });
});







