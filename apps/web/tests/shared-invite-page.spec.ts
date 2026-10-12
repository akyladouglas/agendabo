import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { VueQueryPlugin } from '@tanstack/vue-query';
import { defineComponent, h } from 'vue';
import { routeLocationKey, routerKey } from 'vue-router';
import { toast } from 'vue-sonner';
import * as sharedService from '../src/app/services/shared-agendas';
import ConviteAgendaPage from '../src/view/pages/agenda/ConviteAgendaPage.vue';

/**
 * Tela /convite-agenda (spec D.22, decisão D10): card genérico fixo, token só no
 * BODY, e TODOS os sabores de convite ruim (ausente/expirado/para-outro) caem no
 * MESMO card único (A.5 — a página nunca distingue sabores). Padrão de mount do
 * password-reset-pages.spec (rota injetada por provides, sem backend).
 */

vi.mock('vue-sonner', () => ({
  toast: Object.assign(() => undefined, {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  }),
}));

const TOKEN = 'to'.repeat(24);

const StubRouterLink = defineComponent({
  props: { to: { type: [String, Object], default: '' } },
  setup: (props, { slots }) => () => h('a', { href: String(props.to) }, slots.default?.()),
});

const mounteds: Array<{ unmount(): void }> = [];

function mountInvite(query: Record<string, string> = {}) {
  const router = { push: vi.fn().mockResolvedValue(undefined) };
  const w = mount(ConviteAgendaPage, {
    attachTo: document.body,
    global: {
      plugins: [VueQueryPlugin],
      stubs: { RouterLink: StubRouterLink },
      provide: {
        [routerKey as unknown as symbol]: router,
        [routeLocationKey as unknown as symbol]: { query, path: '/convite-agenda' },
      },
    },
  });
  mounteds.push(w);
  return { w, router };
}

const settle = async () => {
  await flushPromises();
  await new Promise((r) => setTimeout(r, 20));
  await flushPromises();
};

const gone = () =>
  Object.assign(new Error('gone'), {
    response: { status: 410, data: { code: 'shared_invite_invalid' } },
  });

afterEach(() => {
  mounteds.forEach((m) => m.unmount());
  mounteds.length = 0;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('ConviteAgendaPage (D.22/A.5)', () => {
  it('SEM token na URL: card único "inválido ou expirado" e NENHUM botão', () => {
    const { w } = mountInvite();
    expect(w.find('[data-testid="invite-invalid"]').text()).toContain(
      'Link de convite inválido ou expirado.',
    );
    expect(w.find('[data-testid="invite-accept"]').exists()).toBe(false);
    expect(w.find('[data-testid="invite-decline"]').exists()).toBe(false);
  });

  it('com token: card genérico (nome do dono NÃO aparece — sem rota de preview) + Aceitar/Recusar', () => {
    const { w } = mountInvite({ token: TOKEN });
    expect(w.find('[data-testid="invite-explain"]').text()).toContain(
      'convite para ver a agenda de alguém (somente leitura)',
    );
    expect(w.find('[data-testid="invite-invalid"]').exists()).toBe(false);
    expect(w.find('[data-testid="invite-accept"]').exists()).toBe(true);
    expect(w.find('[data-testid="invite-decline"]').exists()).toBe(true);
  });

  it('Aceitar: o token vai no BODY do accept (nunca em URL) — 204 mostra o link "Ver agenda"', async () => {
    const accept = vi.spyOn(sharedService.sharedAgendasApi, 'accept').mockResolvedValue(204);
    const { w } = mountInvite({ token: TOKEN });
    await w.find('[data-testid="invite-accept"]').trigger('click');
    await settle();
    expect(accept).toHaveBeenCalledWith({ token: TOKEN });
    expect(w.find('[data-testid="invite-go-agenda"]').attributes('href')).toBe('/agenda');
    expect(toast.success).toHaveBeenCalled();
  });

  it('aceite com convite ruim (410): o MESMO card único, sem botão, sem sabor de erro', async () => {
    vi.spyOn(sharedService.sharedAgendasApi, 'accept').mockRejectedValue(gone());
    const { w } = mountInvite({ token: TOKEN });
    await w.find('[data-testid="invite-accept"]').trigger('click');
    await settle();
    expect(w.find('[data-testid="invite-invalid"]').exists()).toBe(true);
    expect(w.find('[data-testid="invite-accept"]').exists()).toBe(false);
    expect(toast.error).not.toHaveBeenCalled(); // o card É o erro (A.5)
  });

  it('Recusar: token no body do decline; 204 mostra o estado terminal "Convite recusado."', async () => {
    const decline = vi.spyOn(sharedService.sharedAgendasApi, 'decline').mockResolvedValue(204);
    const { w } = mountInvite({ token: TOKEN });
    await w.find('[data-testid="invite-decline"]').trigger('click');
    await settle();
    expect(decline).toHaveBeenCalledWith({ token: TOKEN });
    expect(w.find('[data-testid="invite-declined"]').text()).toContain('Convite recusado.');
  });

  it('recusa com convite ruim (410): mesmo card único do aceite', async () => {
    vi.spyOn(sharedService.sharedAgendasApi, 'decline').mockRejectedValue(gone());
    const { w } = mountInvite({ token: TOKEN });
    await w.find('[data-testid="invite-decline"]').trigger('click');
    await settle();
    expect(w.find('[data-testid="invite-invalid"]').exists()).toBe(true);
    expect(w.find('[data-testid="invite-declined"]').exists()).toBe(false);
  });
});
