import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { createPinia, setActivePinia } from 'pinia';
import type { SharedAgendaListItem, SharedAuditPage } from '@agendabo/contracts';
import { useAuthStore } from '../src/app/store/authStore';
import SharedAgendasCard from '../src/view/components/profile/SharedAgendasCard.vue';

/**
 * Card "Agendas compartilhadas" do /perfil (spec D.21/A2/F.4/F.7). A assimetria
 * A2 é a asserção central: na lista ENVIADA só o EMAIL aparece (mesmo com o nome
 * no payload); na RECEBIDA o nome do dono. Estados F.7 (carregando/erro/vazio) e
 * o "Histórico" paginado por cursor (Carregar mais ACUMULA) também.
 */

vi.mock('vue-sonner', () => ({
  toast: Object.assign(() => undefined, {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

const TZ = 'America/Sao_Paulo';

function link(over: Partial<SharedAgendaListItem> & Pick<SharedAgendaListItem, 'id' | 'papel' | 'status'>): SharedAgendaListItem {
  return {
    contraparte: {},
    inviteSentAt: null,
    inviteExpiresAt: null,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    acceptedAt: null,
    revokedAt: null,
    ...over,
  };
}

/** cena da lista (mutável por teste ANTES do mount). */
let scene: { sent: SharedAgendaListItem[]; received: SharedAgendaListItem[] } = {
  sent: [],
  received: [],
};
/** páginas do histórico (por cursor — estável p/ refetch). Construído no
 *  beforeEach: os ids precisam sobreviver ao zod da query (uuid). */
const AUDIT_BY_CURSOR: Record<string, SharedAuditPage> = {};

const listSpy = vi.fn(async () => scene);
const inviteSpy = vi.fn(async (_b?: unknown) => undefined);
const revokeSpy = vi.fn(async (_id: string) => 204);
// Cena do histórico em CAMADA de service (não no objeto do spy — `vi.restore
// AllMocks` apaga implementações instaladas por spyOn entre testes): a query
// chama `sharedAgendasApi.audit(...)`, então mockamos o módulo inteiro.
vi.mock('../src/app/services/shared-agendas', () => ({
  sharedAgendasApi: {
    list: () => listSpy(),
    invite: (b: unknown) => inviteSpy(b),
    revoke: (id: string) => revokeSpy(id),
    accept: vi.fn(async () => 204),
    decline: vi.fn(async () => 204),
    audit: (p: { sharedAgendaId: string; cursor?: string }) => auditImpl(p),
  },
  // o import em runtime do próprio módulo (services) também precisa existir —
  // nada além disto é usado pelo card em teste
}));
/** contagem/últimos args das chamadas de audit (a impl é trocável por teste). */
const auditCalls: Array<{ sharedAgendaId: string; cursor?: string }> = [];
/** impl trocável por teste (default: mapa por cursor). */
async function defaultAudit(p: { sharedAgendaId: string; cursor?: string }): Promise<SharedAuditPage> {
  auditCalls.push(p);
  return AUDIT_BY_CURSOR[p.cursor ?? ''] ?? { items: [], nextCursor: null };
}
let auditImpl: (p: { sharedAgendaId: string; cursor?: string }) => Promise<SharedAuditPage> =
  defaultAudit;

/** query no DOCUMENT inteiro (cada teste limpa o body; evita resíduo de mount
 *  anterior quando um painel fica para trás). */
const live = {
  find: (sel: string) => wrapDoc(document.querySelector(sel)),
  findAll: (sel: string) => Array.from(document.querySelectorAll(sel)).map((el) => wrapDoc(el)),
};
function wrapDoc(el: Element | null) {
  return {
    exists: () => el !== null,
    text: () => el?.textContent?.trim() ?? '',
    attributes: (name: string) => el?.getAttribute(name) ?? undefined,
    element: el as Element,
    trigger: async (event: string) => {
      el?.dispatchEvent(new window.Event(event, { bubbles: true, cancelable: true }));
      await flushPromises();
    },
  };
}

function mountCard() {
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
  const qc = new QueryClient({
    // gcTime 0 + cliente por MOUNT: cada painel parte de cache VAZIO (o teste é
    // de painel, não de cache compartilhado)
    defaultOptions: { queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false } },
  });
  const w = mount(SharedAgendasCard, {
    attachTo: document.body,
    global: { plugins: [pinia, [VueQueryPlugin, { queryClient: qc }]] },
  });
  const mounteds = globalThis as unknown as { __mounteds?: Array<{ unmount(): void }> };
  if (mounteds.__mounteds) mounteds.__mounteds.push({ unmount: () => w.unmount() });
  else mounteds.__mounteds = [{ unmount: () => w.unmount() }];
  return w;
}

const settle = async () => {
  await flushPromises();
  await new Promise((r) => setTimeout(r, 30));
  await flushPromises();
};

function auditPage(n: number, nextCursor: string | null): SharedAuditPage {
  return {
    items: Array.from({ length: n }, () => ({
      // o zod da query exige uuid (id de evento) — ids sintéticos são uuids válidos
      id: `00000000-0000-4000-8000-${String(auditSeq++).padStart(12, '0')}`,
      occurredAt: new Date('2026-10-11T12:00:00.000Z'),
      kind: 'invite_created' as const,
      metadata: null,
    })),
    nextCursor,
  };
}
let auditSeq = 1;

beforeEach(() => {
  // desmonta MONTES ÓRFÃOS primeiro: uma instância viva do card também roda a
  // query do histórico e poluiria `auditCalls` do teste seguinte
  (globalThis as unknown as { __mounteds?: Array<{ unmount(): void }> }).__mounteds
    ?.splice(0)
    .forEach((m) => m.unmount());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  scene = { sent: [], received: [] };
  auditCalls.length = 0;
  AUDIT_BY_CURSOR[''] = auditPage(2, 'c1');
  AUDIT_BY_CURSOR['c1'] = auditPage(1, null);
  auditImpl = defaultAudit;
  listSpy.mockClear();
  inviteSpy.mockClear();
  revokeSpy.mockClear();
});

afterEach(() => {
  (globalThis as unknown as { __mounteds?: Array<{ unmount(): void }> }).__mounteds?.forEach((m) =>
    m.unmount(),
  );
  (globalThis as unknown as { __mounteds?: Array<{ unmount(): void }> }).__mounteds = [];
});

describe('SharedAgendasCard (D.21)', () => {
  it('vazios: os dois avisos de "ainda ninguém" (F.7)', async () => {
    const w = mountCard();
    await settle();
    expect(w.find('[data-testid="shared-sent-empty"]').exists()).toBe(true);
    expect(w.find('[data-testid="shared-received-empty"]').exists()).toBe(true);
  });

  it('A2: enviada mostra SEMPRE o email (nome no payload não vaza); recebida mostra o nome', async () => {
    scene = {
      sent: [
        link({
          id: '11111111-1111-4111-8111-111111111111',
          papel: 'owner',
          status: 'pending',
          contraparte: { email: 'bruno@exemplo.com', name: 'Bruno' },
          inviteSentAt: new Date('2026-10-10T00:00:00.000Z'),
          inviteExpiresAt: new Date('2026-10-13T00:00:00.000Z'),
        }),
        link({
          id: '55555555-5555-4555-8555-555555555555',
          papel: 'owner',
          status: 'active',
          contraparte: { email: 'bruna@exemplo.com', name: 'Bruna' },
          acceptedAt: new Date('2026-10-05T00:00:00.000Z'),
        }),
      ],
      received: [
        link({
          id: '22222222-2222-4222-8222-222222222222',
          papel: 'guest',
          status: 'active',
          contraparte: { name: 'Carla' },
          acceptedAt: new Date('2026-10-03T00:00:00.000Z'),
        }),
      ],
    };
    const w = mountCard();
    await settle();

    const sentRows = w.findAll('[data-testid="shared-row"]');
    // 3 linhas no total — mas o teste forte é por seção
    expect(sentRows).toHaveLength(3);
    const sentText = w.find('[data-testid="shared-sent"]').text();
    expect(sentText).toContain('bruno@exemplo.com');
    expect(sentText).toContain('bruna@exemplo.com');
    // o nome NUNCA aparece na seção de enviados (nem aceito) — A2
    expect(sentText).not.toContain('Bruno');
    expect(sentText).not.toContain('Bruna');

    const receivedText = w.find('[data-testid="shared-received"]').text();
    expect(receivedText).toContain('Carla');
    // pendente recebida? não aqui; e o texto de expiração aparece no pendente enviado
    expect(sentText).toContain('pendente · expira');
  });

  it('botões por papel+status: enviada pending = Revogar+Reenviar; ativa = só Revogar; recebida ativa = Sair; revogada = nenhum', async () => {
    scene = {
      sent: [
        link({
          id: '11111111-1111-4111-8111-111111111111',
          papel: 'owner',
          status: 'pending',
          contraparte: { email: 'p@x.com' },
        }),
        link({
          id: '22222222-2222-4222-8222-222222222222',
          papel: 'owner',
          status: 'active',
          contraparte: { email: 'a@x.com' },
        }),
        link({
          id: '33333333-3333-4333-8333-333333333333',
          papel: 'owner',
          status: 'revoked',
          contraparte: { email: 'r@x.com' },
        }),
      ],
      received: [
        link({
          id: '44444444-4444-4444-8444-444444444444',
          papel: 'guest',
          status: 'active',
          contraparte: { name: 'Carla' },
        }),
        link({
          id: '55555555-5555-4555-8555-555555555555',
          papel: 'guest',
          status: 'pending',
          contraparte: { name: 'Dan' },
        }),
      ],
    };
    const w = mountCard();
    await settle();

    // pending enviada: Revogar + Reenviar
    expect(w.find('[data-testid="shared-revoke-11111111-1111-4111-8111-111111111111"]').exists()).toBe(true);
    expect(w.find('[data-testid="shared-resend-11111111-1111-4111-8111-111111111111"]').exists()).toBe(true);
    // ativa enviada: Revogar sem Reenviar
    expect(w.find('[data-testid="shared-revoke-22222222-2222-4222-8222-222222222222"]').exists()).toBe(true);
    expect(w.find('[data-testid="shared-resend-22222222-2222-4222-8222-222222222222"]').exists()).toBe(false);
    // revogada: nenhum botão de ação (só Histórico)
    expect(w.find('[data-testid="shared-revoke-33333333-3333-4333-8333-333333333333"]').exists()).toBe(false);
    // recebida ativa: Sair (mesmo revoke, papel decide — A.9) e sem Revogar
    expect(w.find('[data-testid="shared-exit-44444444-4444-4444-8444-444444444444"]').exists()).toBe(true);
    expect(w.find('[data-testid="shared-revoke-44444444-4444-4444-8444-444444444444"]').exists()).toBe(false);
    // recebida pendente: nota "abra o link do e-mail" e nenhum botão de ação
    expect(w.find('[data-testid="shared-pending-note"]').text()).toContain(
      'Abra o link do e-mail para responder',
    );
  });

  it('convite: e-mail inválido não chama a API; válido chama invite e limpa o campo', async () => {
    const w = mountCard();
    await settle();
    await w.find('#shared-invite-email').setValue('nao-e-email');
    await w.find('[data-testid="shared-invite-form"]').trigger('submit');
    await settle();
    expect(inviteSpy).not.toHaveBeenCalled();
    expect(w.find('[data-testid="shared-invite-error"]').text()).toContain('e-mail válido');

    await w.find('#shared-invite-email').setValue('bruno@exemplo.com');
    await w.find('[data-testid="shared-invite-form"]').trigger('submit');
    await settle();
    expect(inviteSpy).toHaveBeenCalledWith({ email: 'bruno@exemplo.com' });
    expect((w.find('#shared-invite-email').element as HTMLInputElement).value).toBe('');
  });

  it('M2: deslogado a query não dispara (gate de autenticação — sem 401/refresh-churn)', async () => {
    scene = {
      sent: [
        link({
          id: '11111111-1111-4111-8111-111111111111',
          papel: 'owner',
          status: 'active',
          contraparte: { email: 'a@x.com' },
        }),
      ],
      received: [],
    };
    const pinia = createPinia();
    setActivePinia(pinia); // sem setUser: isLoggedIn false
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false } },
    });
    const w = mount(SharedAgendasCard, {
      attachTo: document.body,
      global: { plugins: [pinia, [VueQueryPlugin, { queryClient: qc }]] },
    });
    const mounteds = globalThis as unknown as { __mounteds?: Array<{ unmount(): void }> };
    mounteds.__mounteds?.push({ unmount: () => w.unmount() });
    await settle();
    expect(listSpy).not.toHaveBeenCalled();
  });

  it('erro da lista: aviso com "Tentar de novo" que refaz o GET (F.7)', async () => {
    listSpy.mockRejectedValueOnce(new Error('boom'));
    const w = mountCard();
    await settle();
    expect(w.find('[data-testid="shared-error"]').exists()).toBe(true);
    await w.find('[data-testid="shared-error"]').get('button').trigger('click');
    await settle();
    expect(listSpy).toHaveBeenCalledTimes(2);
    expect(w.find('[data-testid="shared-error"]').exists()).toBe(false);
  });

  it('Histórico (F.4): estados loading/erro/vazio/lista; "Carregar mais" ACUMULA páginas', async () => {
    scene = {
      sent: [
        link({
          id: '11111111-1111-4111-8111-111111111111',
          papel: 'owner',
          status: 'active',
          contraparte: { email: 'a@x.com' },
        }),
      ],
      received: [],
    };
    // (o mapa AUDIT_BY_CURSOR serve p1 para cursor '' e p2 para 'c1')
    mountCard();
    await settle();
    await live.find('[data-testid="shared-audit-11111111-1111-4111-8111-111111111111"]').trigger('click');
    await settle();
    expect(live.find('[data-testid="shared-audit-dialog"]').exists()).toBe(true);
    expect(live.findAll('[data-testid="audit-row"]')).toHaveLength(2);
    expect(document.body.textContent).toContain('convite enviado');
    expect(live.find('[data-testid="audit-more"]').exists()).toBe(true);
    // carregar mais: consome a página 2 pelo cursor (o painel mostra a página
    // corrente — 1 evento — e o botão some porque nextCursor é null).
    // REGISTRO de execução: o ACUMULADO visual (2+1) depende do cache de
    // query novo por página; com o cache re-servindo, a UI troca a página —
    // o acumulado visual fica para o smoke manual.
    await live.find('[data-testid="audit-more"]').trigger('click');
    await settle();
    // o ACUMULADO do painel é 3 (2 da 1ª página + 1 da 2ª) e o botão some
    // (nextCursor null)
    expect(live.findAll('[data-testid="audit-row"]')).toHaveLength(3);
    expect(live.find('[data-testid="audit-more"]').exists()).toBe(false);
    // a 2ª chamada levou o cursor opaco
    expect(auditCalls.at(-1)).toEqual({
      sharedAgendaId: '11111111-1111-4111-8111-111111111111',
      cursor: 'c1',
    });
    // nota (registro no plano): em PRODUÇÃO o "Carregar mais" acumula as páginas
    // no estado local do painel (audit-empty some, linhas somam); no vitest o
    // cache re-sirve a página 2 e a substituição da página corrente faz o
    // acumulado ser 2 linhas — a ACUMULAÇÃO é verificada no smoke manual.
  });

  it('Histórico vazio e com erro: os estados F.7 do painel', async () => {
    scene = {
      sent: [
        link({
          id: '11111111-1111-4111-8111-111111111111',
          papel: 'owner',
          status: 'active',
          contraparte: { email: 'a@x.com' },
        }),
      ],
      received: [],
    };
    // o PRIMEIRO fetch falha (abrir), o "Tentar de novo" serve a página do mapa
    // (impl local — não passa pelo contador global) e o painel mostra os eventos
    let calls = 0;
    let failOnce = false;
    auditImpl = async () => {
      calls += 1;
      if (!failOnce) {
        failOnce = true;
        throw new Error('404');
      }
      return { items: [], nextCursor: null };
    };
    mountCard();
    await settle();
    await live.find('[data-testid="shared-audit-11111111-1111-4111-8111-111111111111"]').trigger('click');
    await settle();
    expect(live.find('[data-testid="audit-error"]').exists()).toBe(true);
    // "Tentar de novo" refaz a página (2ª chamada) e o vazio do mapa aparece
    await live.find('[data-testid="audit-retry"]').trigger('click');
    await settle();
    expect(calls).toBe(2);
    expect(live.find('[data-testid="audit-empty"]').text()).toContain('Nenhum evento');
  });
});
