import { describe, expect, it, vi } from 'vitest';
import { VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
// useRoute() injeta por routeLocationKey; useRouter() por routerKey (symbols do vue-router)
import { routeLocationKey, routerKey } from 'vue-router';
import { toast } from 'vue-sonner';

vi.mock('vue-sonner', () => ({
  toast: Object.assign(() => undefined, {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  }),
}));

import * as api from '../src/app/services/api';
import ForgotPasswordPage from '../src/view/pages/auth/ForgotPasswordPage.vue';
import ResetPasswordPage from '../src/view/pages/auth/ResetPasswordPage.vue';

/**
 * Telas do "Esqueci a senha" (spec esqueci-a-senha, critérios Web): texto neutro
 * único, estados do link e nada de estado de sessão. Padrão de mount do repo
 * (login-page.spec.ts): router injetado por provides + RouterLink stub.
 */

const StubRouterLink = defineComponent({
  props: { to: { type: [String, Object], default: '' } },
  setup: (props, { slots }) => () => h('a', { href: String(props.to) }, slots.default?.()),
});

function makeRouter(push = vi.fn().mockResolvedValue(undefined), query: Record<string, string> = {}) {
  return { push, currentRoute: { value: { fullPath: '/redefinir-senha', query } } };
}

function mountPage(component: typeof ForgotPasswordPage, query: Record<string, string> = {}) {
  const router = makeRouter(vi.fn().mockResolvedValue(undefined), query);
  const w = mount(component, {
    attachTo: document.body,
    global: {
      // as páginas usam mutations do TanStack Query — o plugin precisa estar no app
      plugins: [VueQueryPlugin],
      stubs: { RouterLink: StubRouterLink },
      provide: {
        [routerKey as unknown as symbol]: router,
        // useRoute() injeta a rota pela routeLocationKey (o stub só tem currentRoute)
        [routeLocationKey as unknown as symbol]: { query, path: '/redefinir-senha' },
      },
    },
  });
  return { w, router };
}

async function submit(w: ReturnType<typeof mountPage>['w']) {
  const form = w.find('form').element as HTMLFormElement;
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 400));
}

describe('ForgotPasswordPage', () => {
  it('tem o campo único de e-mail e link de volta para o login', () => {
    const { w } = mountPage(ForgotPasswordPage);
    expect(w.find('#forgot-email').exists()).toBe(true);
    expect(w.findAll('a').map((a) => a.attributes('href'))).toContain('/login');
    vi.restoreAllMocks();
  });

  it('submit com e-mail válido chama a API e mostra o estado neutro fixo citando 1 hora (qualquer que seja o e-mail)', async () => {
    const spy = vi.spyOn(api.authApi, 'forgotPassword').mockResolvedValue(202);
    const { w } = mountPage(ForgotPasswordPage);
    await w.find('#forgot-email').setValue('qualquer@exemplo.com');
    await submit(w);
    expect(spy).toHaveBeenCalledWith({ email: 'qualquer@exemplo.com' });
    const status = w.find('[role="status"]').text();
    expect(status).toContain('Se existir uma conta com esse e-mail');
    expect(status).toContain('1 hora');
    expect(status).toContain('spam');
    // nenhuma variação por e-mail: o form sumiu (estado único pós-submit)
    expect(w.find('form').exists()).toBe(false);
    vi.restoreAllMocks();
  });

  it('até em erro de rede o texto é o mesmo neutro (a resposta nunca revela o e-mail)', async () => {
    vi.spyOn(api.authApi, 'forgotPassword').mockRejectedValue(new Error('network'));
    const { w } = mountPage(ForgotPasswordPage);
    await w.find('#forgot-email').setValue('x@y.com');
    await submit(w);
    expect(w.find('[role="status"]').text()).toContain('Se existir uma conta com esse e-mail');
    expect(toast.error).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('e-mail inválido não chama a API e mostra erro de validação', async () => {
    const spy = vi.spyOn(api.authApi, 'forgotPassword').mockResolvedValue(202);
    const { w } = mountPage(ForgotPasswordPage);
    await w.find('#forgot-email').setValue('nao-e-email');
    await submit(w);
    expect(spy).not.toHaveBeenCalled();
    expect(w.findAll('[role="alert"]').map((a) => a.text())).toHaveLength(1);
    vi.restoreAllMocks();
  });
});

describe('ResetPasswordPage', () => {
  it('aberta SEM token na URL: card "Link inválido ou expirado" sem campos de senha', () => {
    const { w } = mountPage(ResetPasswordPage);
    expect(w.find('[role="alert"]').text()).toContain('Link inválido ou expirado. Solicite um novo.');
    expect(w.find('#reset-password').exists()).toBe(false);
    expect(w.findAll('a').map((a) => a.attributes('href'))).toContain('/esqueci-a-senha');
    vi.restoreAllMocks();
  });

  it('com token na URL: abre o form de nova senha (sem handoff, nada de e-mail)', async () => {
    const { w } = mountPage(ResetPasswordPage, { token: 'ab'.repeat(32) });
    expect(w.find('#reset-password').exists()).toBe(true);
    expect(w.find('#reset-confirm').exists()).toBe(true);
    // o fluxo de reset é stateless: nada em sessionStorage
    expect(sessionStorage.length).toBe(0);
    vi.restoreAllMocks();
  });

  it('senhas que não coincidem mostram erro no form e não chamam a API', async () => {
    const spy = vi.spyOn(api.authApi, 'resetPassword').mockResolvedValue(204);
    const { w } = mountPage(ResetPasswordPage, { token: 'ab'.repeat(32) });
    await w.find('#reset-password').setValue('senha-nova-123');
    await w.find('#reset-confirm').setValue('outra-senha-123');
    await submit(w);
    expect(spy).not.toHaveBeenCalled();
    expect(w.findAll('[role="alert"]').map((a) => a.text())).toContain('As senhas não coincidem.');
    vi.restoreAllMocks();
  });

  it('sucesso (204): toast discreto + redirect /login, sem sessão criada', async () => {
    const spy = vi.spyOn(api.authApi, 'resetPassword').mockResolvedValue(204);
    const { w, router } = mountPage(ResetPasswordPage, { token: 'ab'.repeat(32) });
    await w.find('#reset-password').setValue('senha-nova-123');
    await w.find('#reset-confirm').setValue('senha-nova-123');
    await submit(w);
    expect(spy).toHaveBeenCalledWith({ token: 'ab'.repeat(32), password: 'senha-nova-123' });
    expect(toast.success).toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 50));
    expect(router.push).toHaveBeenCalledWith({ name: 'login' });
    vi.restoreAllMocks();
  });

  it('410 da API: os campos de senha somem e o card "Link inválido ou expirado" aparece', async () => {
    vi.spyOn(api.authApi, 'resetPassword').mockRejectedValue(
      Object.assign(new Error('gone'), {
        response: { status: 410, data: { message: 'Link inválido ou expirado. Solicite um novo.', code: 'reset_token_invalid' } },
      }),
    );
    const { w } = mountPage(ResetPasswordPage, { token: 'ab'.repeat(32) });
    await w.find('#reset-password').setValue('senha-nova-123');
    await w.find('#reset-confirm').setValue('senha-nova-123');
    await submit(w);
    expect(w.find('#reset-password').exists()).toBe(false);
    expect(w.find('[role="alert"]').text()).toContain('Link inválido ou expirado. Solicite um novo.');
    vi.restoreAllMocks();
  });
});
