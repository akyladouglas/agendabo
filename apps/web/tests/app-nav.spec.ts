import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { VueQueryPlugin } from '@tanstack/vue-query';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import type { SessionUser } from '../src/app/store/authStore';
import AppLayout from '../src/view/layouts/AppLayout.vue';
import { useAuthStore } from '../src/app/store/authStore';

/**
 * Estrutural do AppLayout (spec B.12): hambúrguer com data-testid (a gaveta é
 * só CSS md:hidden — o botão existe no DOM sempre), e "Nome · e-mail" quando há
 * nome, só e-mail quando não há. Radix/Teleport: stubados (happy-dom anima mal).
 */
const StubRouterLink = defineComponent({
  props: { to: { type: [String, Object], default: '' } },
  setup: (props, { slots }) => () => h('a', { href: String(props.to) }, slots.default?.()),
});

type LayoutUser = Pick<SessionUser, 'name'>;

function mountLayout(user: LayoutUser) {
  const pinia = createPinia();
  setActivePinia(pinia);
  // setUser ANTES do mount: com setUser pós-mount o setter sem argumento não
  // reativa (pinia sem Proxy), e o header renderizaria vazio.
  useAuthStore().setUser({
    id: 'u1',
    email: 'ana@email.com',
    timezone: 'America/Sao_Paulo',
    resumoDiarioHora: '08:00',
    resumoDiarioAtivo: true,
        isAdmin: false,
    name: user.name,
  });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }],
  });

  const wrapper = mount(AppLayout, {
    global: {
      plugins: [pinia, router, VueQueryPlugin],
      stubs: {
        RouterLink: StubRouterLink,
        DialogRoot: { template: '<div><slot /></div>' },
        DialogPortal: { template: '<div><slot /></div>' },
        DialogOverlay: true,
        DialogContent: { template: '<div><slot /></div>' },
      },
    },
  });
  return wrapper;
}

describe('AppLayout (B.12)', () => {
  it('tem botão de menu com data-testid (gaveta <md)', () => {
    const wrapper = mountLayout({ name: null });
    const button = wrapper.find('[data-testid="menu-button"]');
    expect(button.exists()).toBe(true);
    expect(button.attributes('aria-label')).toBeTruthy();
  });

  it('usuário com nome exibe "Nome · e-mail"', () => {
    const wrapper = mountLayout({ name: 'Ana' });
    expect(wrapper.find('[data-testid="header-user"]').text()).toBe('Ana · ana@email.com');
  });

  it('usuário sem nome exibe só o e-mail (decisão 7)', () => {
    const wrapper = mountLayout({ name: null });
    expect(wrapper.find('[data-testid="header-user"]').text()).toBe('ana@email.com');
  });

  it('toggle de tema existe e alterna (decisão 9)', async () => {
    const wrapper = mountLayout({ name: null });
    const themeButtons = wrapper.findAll('button[aria-label*="tema"]');
    expect(themeButtons.length).toBeGreaterThan(0);
    document.documentElement.removeAttribute('data-theme');
    await themeButtons[0]!.trigger('click');
    // escuro -> claro: o store escreve data-theme no <html>
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    vi.restoreAllMocks();
  });
});
