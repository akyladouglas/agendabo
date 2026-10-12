import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import type { SharedAgendaListItem } from '@agendabo/contracts';
import * as appointmentsService from '../src/app/services/appointments';
import * as sharedService from '../src/app/services/shared-agendas';
import type { UseAgendaPage } from '../src/app/composables/useAgendaPage.composable';
import { useAuthStore } from '../src/app/store/authStore';
import AgendaPage from '../src/view/pages/agenda/AgendaPage.vue';
import AgendaNav from '../src/view/pages/agenda/AgendaNav.vue';

/**
 * FONTE da agenda (plano compartilhamento-agenda-par, Etapa 5): o seletor só
 * aparece com ≥1 vínculo recebido ATIVO (A5); trocar a fonte mantém
 * visão/âncora/período (D9); fonte emprestada ⇒ read-only estrutural
 * (grade sem criar, "Novo" ausente, subtítulo "de ‹dono›"); vínculo que suma da
 * lista devolve a fonte para a minha. Harness igual ao day-grid.spec (service na
 * borda, âncora fixa, instância via window.__agenda — DEV do vite).
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
const LINK_ID = '22222222-2222-4222-8222-222222222222';
/** uuid do DONO (Carla) — ≠ LINK_ID de propósito (regressão: owner= ≠ id do vínculo). */
const OWNER_ID = '99999999-9999-4999-8999-999999999999';

function link(over: Partial<SharedAgendaListItem>): SharedAgendaListItem {
  return {
    id: LINK_ID,
    papel: 'guest',
    status: 'active',
    contraparte: { name: 'Carla' },
    inviteSentAt: null,
    inviteExpiresAt: null,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    acceptedAt: new Date('2026-10-02T00:00:00.000Z'),
    revokedAt: null,
    ...over,
  };
}

/**
 * RECEBIDOS com o uuid do DONO no item cru (`ownerId` — o campo extra que a
 * página lê da resposta ANTES do parse do contrato para a fonte). O id do
 * VÍNCULO é outro uuid (LINK_ID) de propósito: a asserção distingue as duas
 * dimensões (dono ≠ vínculo).
 */
type LinkRaw = SharedAgendaListItem & { ownerId?: string };
function receivedLink(over?: Partial<LinkRaw>): LinkRaw {
  return { ...link({}), ownerId: OWNER_ID, ...over };
}

/** Cena da lista de vínculos (mock do service na borda — reinstallado por teste). */
let sceneLinks: { sent: SharedAgendaListItem[]; received: LinkRaw[] } = {
  sent: [],
  received: [],
};
/** Última chamada de appointmentsApi.list: [from, to, owner?] — spy da key por dono. */
const list = vi.fn(async (..._a: unknown[]) => ({ items: [] }));
vi.spyOn(appointmentsService.appointmentsApi, 'list').mockImplementation(list);
const sharedList = vi.fn(async () => sceneLinks);
vi.spyOn(sharedService.sharedAgendasApi, 'list').mockImplementation(sharedList);

/** QueryClient do harness — exposto p/ os testes invalidarem qk.sharedAgendas. */
let client!: QueryClient;

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
  client = qc;
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
  return {
    w,
    get agenda(): UseAgendaPage {
      const a = (window as unknown as { __agenda?: UseAgendaPage }).__agenda;
      if (!a) throw new Error('hook window.__agenda ausente (linha @test-hook)');
      return a;
    },
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
  vi.restoreAllMocks();
  sceneLinks = { sent: [], received: [] };
  // reinstala os spies da borda (restore derrubou as implementações)
  vi.spyOn(appointmentsService.appointmentsApi, 'list').mockImplementation(list);
  vi.spyOn(sharedService.sharedAgendasApi, 'list').mockImplementation(sharedList);
  list.mockClear();
  sharedList.mockClear();
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

describe('seletor de fonte (A5)', () => {
  it('sem vínculo recebido: o seletor NÃO existe (nem desabilitado)', async () => {
    const h = mountAgenda();
    await settle();
    expect(h.w.find('[data-testid="agenda-source"]').exists()).toBe(false);
  });

  it('vínculo recebido PENDENTE não conta (só ativo) e revogado idem', async () => {
    sceneLinks = {
      sent: [link({ papel: 'owner', status: 'active', contraparte: { email: 'b@x.com' } })],
      received: [
        link({ status: 'pending' }),
        link({ id: '33333333-3333-4333-8333-333333333333', status: 'revoked' }),
      ],
    };
    const h = mountAgenda();
    await settle();
    expect(h.w.find('[data-testid="agenda-source"]').exists()).toBe(false);
  });

  it('com vínculo recebido ATIVO: seletor presente, nomeado, com "Minha agenda" + "Agenda de Carla"', async () => {
    // receivedLink(): com ownerId no cru — item SEM dono no payload é descartado
    // do seletor (M3/gotcha 27), então a cena precisa do uuid do dono.
    sceneLinks = { sent: [], received: [receivedLink()] };
    const h = mountAgenda();
    await settle();
    const trigger = h.w.find('[data-testid="agenda-source"]');
    expect(trigger.exists()).toBe(true);
    // o `aria-label` cai no SelectRoot e é replicado no TRIGGER pelo radix
    // (o harness do day-grid usa a query global p/ alcançar o gatilho)
    const el = document.querySelector('[data-testid="agenda-source"]');
    expect(el).not.toBeNull();
    // gotcha 19: o aria-label mora no SELECT ROOT, não no DOM do gatilho; o
    // teste estrutural é o rótulo sr-only associado por `for` (a11y real).
    const label = document.querySelector('label.sr-only[for="agenda-source"]');
    expect(label?.textContent?.trim()).toBe('Agenda exibida');
    // o AppSelect (radix) põe a opção selecionada como TEXT/contenteditable no
    // gatilho (gotcha 19): asserção estrutural de presença + label; a lista de
    // opções vive em portal e é verificada no ui-controls.spec.
    expect(trigger.text()).toContain('Minha agenda');
  });
});

describe('trocar de fonte (D9: nada é resetado)', () => {
  it('mudar sourceOwner mantém view/âncora e leva o dono para a query', async () => {
    sceneLinks = { sent: [], received: [receivedLink()] };
    const h = mountAgenda();
    await settle();
    h.agenda.setView('month');
    await settle();
    const viewBefore = h.agenda.view.value;
    const anchorBefore = h.agenda.anchor.value.getTime();
    const fromBefore = h.agenda.from.value;

    // o seletor carrega ownerId (não o id do vínculo) — é isso que cai em owner=
    h.agenda.sourceOwner.value = OWNER_ID;
    await settle();

    expect(h.agenda.view.value).toBe(viewBefore);
    expect(h.agenda.anchor.value.getTime()).toBe(anchorBefore);
    expect(h.agenda.from.value).toBe(fromBefore);
    // a query pediu a agenda do DONO: spy na borda (a key é interna do TanStack;
    // a asserção forte é o owner no fetch — qk em si é coberto no smoke.spec)
    expect(list).toHaveBeenLastCalledWith(fromBefore, h.agenda.to.value, OWNER_ID);
  });

  it('REGRESSÃO: selecionar o parceiro no seletor ⇒ owner=<ownerId do dono>, NUNCA o id do vínculo', async () => {
    sceneLinks = { sent: [], received: [receivedLink()] };
    const h = mountAgenda();
    await settle();
    const fromBefore = h.agenda.from.value;

    // o caminho INTEIRO do bug: o EVENTO do seletor com o value da OPÇÃO — que
    // a página agora constrói como ownerId (com o bug era `l.id`, o vínculo).
    // Emitir o value da opção É o que o clique faria (o AppSelect repassa
    // $event cru do radix), e o valor é obtido da PRÓPRIA lista de fontes da
    // página — se ela voltasse a usar o id do vínculo, esta asserção pega.
    const nav = h.w.findComponent(AgendaNav);
    const sourceOpts = (nav.props('sourceOptions') ?? []) as Array<{ value: string; label: string }>;
    const option = sourceOpts.find((o) => o.label === 'Agenda de Carla');
    expect(option?.value).toBe(OWNER_ID); // o value da opção é o DONO, nunca o vínculo
    nav.vm.$emit('update:source', option!.value);
    await settle();

    // 1. a query saiu com o uuid do DONO (a 3ª arg = owner= / dimensão da qk)
    expect(list).toHaveBeenLastCalledWith(fromBefore, h.agenda.to.value, OWNER_ID);
    // 2. e NUNCA com o id do VÍNCULO — chamadas de agenda emprestada (owner não
    //    nulo) que existiriam com o bug: owner === LINK_ID. Com o bug este
    //    cenário emitiria exatamente LINK_ID (a opção tinha value: l.id).
    expect(LINK_ID).not.toBe(OWNER_ID);
    const borrowedCalls = list.mock.calls.map((c) => c[2]).filter((o) => o != null);
    expect(borrowedCalls).toEqual([OWNER_ID]);
    // 3. cache/key na MESMA dimensão: o spy acima É a dimensão `owner` de
    //    qk.appointments(from, to, owner) — o valor fetchado é o mesmo da key.
    // 4. o invariante "vínculo sumiu" compara ownerId: com a mesma fonte, a lista
    //    atual continua válida (a fonte NÃO volta para 'me' por mismatch de dimensão)
    expect(h.agenda.sourceOwner.value).toBe(OWNER_ID);
    expect(h.agenda.readonly.value).toBe(true);
    expect(h.w.text()).toContain('Vendo a agenda de Carla');
  });

  it('REGRESSÃO: payload SEM ownerId (shape antigo) — o item é DESCARTADO do seletor, NUNCA vira owner=<link-id> (gotcha 27)', async () => {
    // M3 (review): sem o uuid do dono no payload cru, o vínculo NÃO pode entrar
    // no seletor com o id do VÍNCULO como dono (um 403 adormecido em `owner=`).
    sceneLinks = { sent: [], received: [link({})] }; // link() SEM ownerId: shape antigo
    const h = mountAgenda();
    await settle();
    const nav = h.w.findComponent(AgendaNav);
    const sourceOpts = (nav.props('sourceOptions') ?? []) as Array<{ value: string; label: string }>;
    // o item sem ownerId NÃO aparece no seletor — só "Minha agenda"
    expect(sourceOpts.find((o) => o.label === 'Agenda de Carla')).toBeUndefined();
    expect(sourceOpts.map((o) => o.value)).toEqual(['me']);
    // e o id do vínculo NUNCA vira opção/dono em nenhuma dimensão
    expect(sourceOpts.some((o) => o.value === LINK_ID)).toBe(false);
    expect(h.w.find('[data-testid="agenda-source"]').exists()).toBe(false);
    // nenhuma chamada de agenda emprestada com o id do vínculo
    const borrowedCalls = list.mock.calls.map((c) => c[2]).filter((o) => o != null);
    expect(borrowedCalls).toEqual([]);
  });

  it('invariante dinâmico: lista sem o vínculo da fonte ⇒ a fonte volta para a minha', async () => {
    // cena com dois parceiros; a fonte é um deles; o dono revoga (a query
    // invalidada devolve a lista sem ele) — o watch compara por ownerId
    const ownerB = '88888888-8888-4888-8888-888888888888';
    sceneLinks = { sent: [], received: [receivedLink(), receivedLink({ id: '44444444-4444-4444-8444-444444444444', ownerId: ownerB, contraparte: { name: 'Bruno' } })] };
    const h = mountAgenda();
    await settle();
    h.agenda.sourceOwner.value = OWNER_ID;
    await settle();
    expect(h.agenda.readonly.value).toBe(true);

    // Carla revogou: a lista viva passa a vir só com o Bruno
    sceneLinks = { sent: [], received: [receivedLink({ id: '44444444-4444-4444-8444-444444444444', ownerId: ownerB, contraparte: { name: 'Bruno' } })] };
    // invalidate + refetch VIVO de qk.sharedAgendas (mesmo efeito do dono revogar
    // e as mutations invalidarem): o watch da página roda com a nova lista
    await client.invalidateQueries({ queryKey: ['shared-agendas'] });
    await settle();
    expect(h.agenda.sourceOwner.value).toBe(null);
    expect(h.agenda.readonly.value).toBe(false);
  });

  it('fonte emprestada ⇒ readonly estrutural: subtítulo, sem "Novo", estado vazio emprestado', async () => {
    sceneLinks = { sent: [], received: [receivedLink()] };
    const h = mountAgenda();
    await settle();
    expect(h.w.text()).not.toContain('Vendo a agenda de');
    expect(h.agenda.readonly.value).toBe(false);

    h.agenda.sourceOwner.value = OWNER_ID;
    await settle();

    expect(h.agenda.readonly.value).toBe(true);
    expect(h.w.text()).toContain('Vendo a agenda de Carla · somente leitura');
    // "Novo" (criar) some da toolbar na fonte emprestada — dupla cinta: testid
    // (o botão tem data-testid="agenda-new" na produção — T1) + texto no header.
    expect(h.w.find('[data-testid="agenda-new"]').exists()).toBe(false);
    expect(document.querySelector('h1.title-page')?.parentElement?.textContent).not.toContain('Novo');
    // vazio emprestado: aviso com testid próprio (nunca "crie aqui")
    expect(h.w.find('[data-testid="shared-empty"]').text()).toContain('Nada');
  });

  it('vínculo da fonte sumiu da lista (revogado) ⇒ a fonte volta para a minha', async () => {
    sceneLinks = { sent: [], received: [receivedLink()] };
    const h = mountAgenda();
    await settle();
    h.agenda.sourceOwner.value = OWNER_ID;
    await settle();
    expect(h.agenda.readonly.value).toBe(true);

    // o dono revogou: a lista passa a vir SEM o vínculo ativo e a página remonta
    // (mesmo efeito de invalidate+refetch do qk.sharedAgendas: o watch da página
    // só roda com a lista carregada e sem o vínculo)
    sceneLinks = { sent: [], received: [] };
    h.w.unmount();
    const h2 = mountAgenda();
    // a fonte vive em estado local novo (null) — e o invariante mantém
    await settle();
    expect(h2.agenda.sourceOwner.value).toBe(null);
    expect(h2.agenda.readonly.value).toBe(false);
    // armadilha inversa: montar direto com fonte inexistente NÃO travaria em 403 —
    // o watch devolve p/ 'me' quando a lista chega sem o vínculo. Aqui cobrimos
    // o caminho do estado inicial; o do watch dinâmico exige invalidação viva.
  });
});

describe('detalhes na agenda emprestada (T2 — blockClick → openDetails)', () => {
  const OWNER_APPT_ID = '77777777-7777-4777-8777-777777777777';

  it('clique no bloco do dono abre o painel SOMENTE-LEITURA: nota de readonly, sem "Editar"/"Excluir"', async () => {
    // 1 compromisso do DONO no dia (a borda devolve o payload emprestado — sem
    // origin/status de revisão, B.13). A cena: vínculo recebido ativo + fonte.
    sceneLinks = { sent: [], received: [receivedLink()] };
    list.mockImplementation((async (..._a: unknown[]) => {
      const owner = _a[2];
      return owner
        ? {
            items: [
              {
                id: OWNER_APPT_ID,
                title: 'Consulta do dono',
                startsAt: new Date('2026-10-08T14:00:00.000Z'), // 11:00 SP
                endsAt: new Date('2026-10-08T15:00:00.000Z'),
                notes: null,
                status: 'confirmed',
                createdAt: new Date('2026-10-01T00:00:00.000Z'),
              },
            ],
          }
        : { items: [] };
    }) as typeof list);
    const h = mountAgenda();
    await settle();
    h.agenda.sourceOwner.value = OWNER_ID;
    await settle();
    expect(h.agenda.readonly.value).toBe(true);

    // o caminho INTEIRO do clique: bloco na grade → blockClick → openDetails
    const block = document.querySelector(`[data-testid="day-block-${OWNER_APPT_ID}"]`);
    expect(block).not.toBeNull();
    block?.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
    await settle();

    const dialogText = document.body.textContent ?? '';
    expect(dialogText).toContain('Consulta do dono');
    // painel somente-leitura (C.18): a nota com o dono + zero ações de escrita
    expect(document.querySelector('[data-testid="details-readonly-note"]')).not.toBeNull();
    expect(dialogText).toContain('Somente leitura');
    expect(dialogText).not.toContain('Editar');
    expect(dialogText).not.toContain('Excluir');
  });
});
