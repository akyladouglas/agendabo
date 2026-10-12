import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('vue-sonner', () => ({
  toast: Object.assign(() => undefined, {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

import * as api from '../src/app/services/api';
import SessionsCard from '../src/view/components/profile/SessionsCard.vue';
import { toast } from 'vue-sonner';

/**
 * Card "Suas sessões ativas" (spec sessao-24h "Web"): lista com "Este
 * dispositivo" no current, label resumida da UA e "desde ... UTC"; o botão
 * "Encerrar todas as outras" so existe com outra sessao e dispara DELETE 1x.
 * O http e mockado na fronteira (padrao admin-page.spec) — axios de verdade
 * jamais.
 */

const UUID_A = '3f2b6c1e-8a4d-4a5b-9c3e-1d2f3a4b5c6d';
const UUID_B = '3f2b6c1e-1111-4a5b-9c3e-1d2f3a4b5c6e';

const CURRENT = {
  id: UUID_A,
  ip: '201.1.2.3',
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  loginAt: '2026-10-10T09:05:00.000Z',
  current: true,
};
const OTHER = {
  id: UUID_B,
  ip: null,
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  loginAt: '2026-10-09T22:00:00.000Z',
  current: false,
};

function mountCard() {
  setActivePinia(createPinia());
  const w = mount(SessionsCard, {
    attachTo: document.body,
    global: { plugins: [VueQueryPlugin] },
  });
  return w;
}

async function settle(w: ReturnType<typeof mountCard>) {
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 50));
    await w.vm.$nextTick();
  }
}

/** so chamadas DELETE (o GET da query nao interessa p/ as assercoes de mutacao) */
function deleteCalls(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map((c) => String(c[0]));
}

describe('SessionsCard (Suas sessões ativas)', () => {
  it('lista sessões com label, IP, "desde" UTC e badge no current', async () => {
    const getSpy = vi.spyOn(api.http, 'get').mockResolvedValue({
      data: { items: [CURRENT, OTHER] },
    });
    const w = mountCard();
    await settle(w);

    expect(getSpy).toHaveBeenCalledWith('/auth/sessions');
    const rows = w.findAll('[data-testid="session-row"]');
    expect(rows).toHaveLength(2);

    // linha 1 (atual): label Windows · Chrome, IP, "desde ... UTC", badge
    expect(rows[0]!.text()).toContain('Windows · Chrome');
    expect(rows[0]!.text()).toContain('201.1.2.3');
    expect(rows[0]!.text()).toContain('desde 10/10 09:05 UTC');
    const badge = w.find('[data-testid="session-current"]');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe('Este dispositivo');
    expect(rows[1]!.text()).toContain('macOS · Safari');
    expect(rows[1]!.text()).toContain('desde 09/10 22:00 UTC');
    // sem IP (null): a linha nao mostra "null" nem "· " sobrando
    expect(rows[1]!.text()).not.toContain('null');
    vi.restoreAllMocks();
  });

  it('"Encerrar todas as outras" → DELETE 1x + toast de sucesso + revalida', async () => {
    const getSpy = vi.spyOn(api.http, 'get').mockResolvedValue({
      data: { items: [CURRENT, OTHER] },
    });
    const delSpy = vi.spyOn(api.http, 'delete').mockResolvedValue({ data: { revoked: 1 } });
    const w = mountCard();
    await settle(w);
    expect(getSpy).toHaveBeenCalledTimes(1);

    // A MUTATION so roda com outra sessao na lista: o DELETE parte de la, nao da
    // query de teste (senao o "1x" depende do retry interno do TanStack Query).
    const btn = w.find('[data-testid="sessions-revoke-others"]');
    expect(btn.attributes('disabled')).toBeUndefined();
    await btn.trigger('click');
    await settle(w);

    expect(deleteCalls(delSpy)).toEqual(['/auth/sessions']);
    expect(toast.success).toHaveBeenCalledWith('Sessões encerradas.');
    // invalidate da qk.sessions → a query refaz o GET (1º fetch + refetch do invalidate)
    expect(getSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    vi.restoreAllMocks();
  });

  it('só a sessão atual: botão desabilitado (nada a encerrar)', async () => {
    vi.spyOn(api.http, 'get').mockResolvedValue({ data: { items: [CURRENT] } });
    const w = mountCard();
    await settle(w);

    expect(w.findAll('[data-testid="session-row"]')).toHaveLength(1);
    expect(w.find('[data-testid="sessions-revoke-others"]').attributes('disabled')).toBeDefined();
    vi.restoreAllMocks();
  });

  it('vazio: "Nenhuma sessão ativa." e botão desabilitado', async () => {
    vi.spyOn(api.http, 'get').mockResolvedValue({ data: { items: [] } });
    const w = mountCard();
    await settle(w);

    expect(w.find('[data-testid="sessions-empty"]').exists()).toBe(true);
    expect(w.text()).toContain('Nenhuma sessão ativa.');
    expect(w.find('[data-testid="sessions-revoke-others"]').attributes('disabled')).toBeDefined();
    vi.restoreAllMocks();
  });

  it('erro: alerta discreto + botão "Tentar de novo" que refaz o GET', async () => {
    // A query de producao herda retry padrao do TanStack (2 tentativas c/ backoff
    // ~1s): o settle de 600ms ainda pegaria a query em PENDING (estado de erro so
    // existe com as tentativas esgotadas). Aqui o retry vai a 0 para a UI de erro
    // ser deterministica — a recuperacao pelo clique ("Tentar de novo") e o que
    // importa no teste.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: 0 } },
    });
    const getSpy = vi
      .spyOn(api.http, 'get')
      .mockRejectedValueOnce(Object.assign(new Error('http'), { response: { status: 500 } }))
      .mockResolvedValue({ data: { items: [CURRENT] } });
    setActivePinia(createPinia());
    const w = mount(SessionsCard, {
      attachTo: document.body,
      global: { plugins: [[VueQueryPlugin, { queryClient }]] },
    });
    await settle(w);

    const alert = w.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain('Não foi possível carregar suas sessões.');

    const retry = alert.findAll('button').find((b) => b.text() === 'Tentar de novo');
    expect(retry).toBeTruthy();
    await retry!.trigger('click');
    await settle(w);

    // retry so tem efeito com erro atual: o GET extra veio do clique (1º clique
    // com erro vigente refaz; depois que recupera o alert some)
    expect(getSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    // recuperado: a lista aparece e o alert desaparece
    expect(w.findAll('[data-testid="session-row"]')).toHaveLength(1);
    expect(w.find('[role="alert"]').exists()).toBe(false);
    vi.restoreAllMocks();
  });
});
