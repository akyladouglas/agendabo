import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { VueQueryPlugin } from '@tanstack/vue-query';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, h } from 'vue';
import { routerKey, routeLocationKey } from 'vue-router';

vi.mock('vue-sonner', () => ({
  toast: Object.assign(() => undefined, {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  }),
}));

import * as api from '../src/app/services/api';
import { useAuthStore } from '../src/app/store/authStore';
import AdminPage from '../src/view/pages/admin/AdminPage.vue';

/**
 * Página de observabilidade (Fase 9): o papel vem SEMPRE da API
 * (`/observabilidade/me`). O que este spec não negocia:
 *  - 404/403 (sem rollout, não-admin) => "Acesso restrito" e nenhuma query de
 *    dados dispara (nada de /bot-events, /llm-usage ou /admin/users);
 *  - rollout => vê os próprios eventos, SEM o filtro de usuário e sem
 *    /admin/users ou /llm-usage;
 *  - admin => /admin/users entra, eventos mostram o dono por linha.
 */

const StubRouterLink = defineComponent({
  props: { to: { type: [String, Object], default: '' } },
  setup: (props, { slots }) => () => h('a', { href: String(props.to) }, slots.default?.()),
});

function httpError(status: number) {
  return Object.assign(new Error('http'), { response: { status } });
}

const EVENT = {
  id: '3f0f1e2c-1111-4aaa-8bbb-ccccdddd0001',
  type: 'flow_completed',
  stage: 'flow.criado',
  outcome: 'ok',
  metadata: { appointmentId: '3f0f1e2c-2222-4aaa-8bbb-ccccdddd0002' },
  createdAt: new Date('2026-10-09T15:00:00Z'),
};
/** uuid de verdade: a leitura é validada pelo zod dos contracts (id ≠ apelido). */
const OWNER_ID = '3f0f1e2c-9999-4aaa-8bbb-ccccdddd9999';

/** O badge de Revisão do AppLayout chama /review em toda montagem — neutro aqui. */
async function routeMock(url: string, role: 'admin' | 'rollout' | 'denied') {
  if (url === '/review') return { data: { items: [] } };
  if (url === '/observabilidade/me') {
    if (role === 'denied') throw httpError(404);
    return { data: { isAdmin: role === 'admin', observabilidadeEventosAtivo: true } };
  }
  if (url === '/bot-events') return { data: { items: [EVENT], total: 1 } };
  if (url === '/admin/users') {
    return {
      data: {
        items: [
          {
            id: OWNER_ID,
            email: 'bruno@example.com',
            name: 'Bruno',
            isAdmin: false,
            observabilidadeEventosAtivo: false,
            createdAt: new Date('2026-10-01T00:00:00Z'),
          },
        ],
      },
    };
  }
  throw httpError(404);
}

function mountPage() {
  const router = { push: vi.fn(), currentRoute: { value: { fullPath: '/admin', query: {} } } };
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().setUser({
    id: 'u1',
    email: 'ana@email.com',
    name: 'Ana',
    timezone: 'UTC',
    resumoDiarioHora: '08:00',
    resumoDiarioAtivo: true,
    isAdmin: false,
  });
  const w = mount(AdminPage, {
    attachTo: document.body,
    global: {
      plugins: [pinia, VueQueryPlugin],
      stubs: { RouterLink: StubRouterLink },
      provide: {
        [routerKey as unknown as symbol]: router,
        [routeLocationKey as unknown as symbol]: { path: '/admin', query: {} },
      },
    },
  });
  return { w };
}

/** drena a cadeia /me → isAdmin reativo → enabled() → fetch → render. */
async function settle(w: ReturnType<typeof mountPage>['w']) {
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 50));
    await w.vm.$nextTick();
  }
}

/** só as chamadas relevantes p/ o teste (o badge do layout chama /review) */
function dataUrls(
  spy: { mock: { calls: unknown[][] } },
): string[] {
  return spy.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u !== '/review');
}

describe('AdminPage (observabilidade)', () => {
  it('sem rollout/não-admin (404 no /me): "Acesso restrito" e nenhuma query de dados dispara', async () => {
    const spy = vi
      .spyOn(api.http, 'get')
      .mockImplementation((url: string) => routeMock(url, 'denied') as never);
    const { w } = mountPage();
    await settle(w);
    expect(w.find('[data-testid="admin-denied"]').exists()).toBe(true);
    expect(w.text()).toContain('Acesso restrito');
    expect(dataUrls(spy)).toEqual(['/observabilidade/me']);
    vi.restoreAllMocks();
  });

  it('rollout (200 sem isAdmin): vê os próprios eventos, SEM filtro de usuário', async () => {
    const spy = vi
      .spyOn(api.http, 'get')
      .mockImplementation((url: string) => routeMock(url, 'rollout') as never);
    const { w } = mountPage();
    await settle(w);
    expect(w.find('[data-testid="admin-denied"]').exists()).toBe(false);
    expect(w.text()).toContain('flow_completed');
    // rollout: nem o select de usuário, nem /admin/users, nem /llm-usage
    expect(w.find('#admin-user-filter').exists()).toBe(false);
    const urls = dataUrls(spy);
    expect(urls).toContain('/bot-events');
    expect(urls).not.toContain('/admin/users');
    expect(urls).not.toContain('/llm-usage');
    vi.restoreAllMocks();
  });

  it('admin: /admin/users entra e eventos mostram o dono por linha', async () => {
    const EVENT_OK = {
      id: '3f0f1e2c-1111-4aaa-8bbb-ccccdddd0001',
      type: 'flow_completed',
      stage: 'flow.criado',
      outcome: 'ok',
      metadata: { appointmentId: '3f0f1e2c-2222-4aaa-8bbb-ccccdddd0002' },
      createdAt: new Date('2026-10-09T15:00:00Z'),
      userId: OWNER_ID,
    };
    const spy = vi
      .spyOn(api.http, 'get')
      .mockImplementation(async (url: string) => {
        if (url === '/bot-events') return { data: { items: [EVENT_OK], total: 1 } };
        return routeMock(url, 'admin');
      });
    const { w } = mountPage();
    await settle(w);
    const urls = dataUrls(spy);
    expect(urls).toContain('/admin/users');
    const eventsCalls = spy.mock.calls.filter((c) => String(c[0]) === '/bot-events');
    expect(eventsCalls.length).toBeGreaterThan(0);
    const userChip = w.find('[data-testid="event-user"]');
    expect(userChip.exists()).toBe(true);
    expect(userChip.text()).toBe('Bruno');
    // o filtro de usuário (radix renderiza o trigger com id) existe p/ admin
    expect(w.find('#admin-user-filter').exists()).toBe(true);
    vi.restoreAllMocks();
  });
});
