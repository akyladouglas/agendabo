import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { routerKey } from 'vue-router';
import { toast } from 'vue-sonner';

vi.mock('vue-sonner', () => ({
  toast: Object.assign(() => undefined, {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  }),
}));

import * as api from '../src/app/services/api';
import * as authStoreModule from '../src/app/store/authStore';
import LoginPage from '../src/view/pages/auth/LoginPage.vue';

const StubRouterLink = defineComponent({
  props: { to: { type: [String, Object], default: '' } },
  setup: (props, { slots }) => () => h('a', { href: String(props.to) }, slots.default?.()),
});

function mountLogin() {
  const push = vi.fn().mockResolvedValue(undefined);
  const router = { push, currentRoute: { value: { fullPath: '/' } } };
  const w = mount(LoginPage, {
    attachTo: document.body,
    global: {
      stubs: { RouterLink: StubRouterLink },
      // useRouter() fora do app com router instalado → injeta via provides
      // (a chave é o Symbol real do vue-router: useRouter usa inject de symbol)
      provide: { [routerKey as unknown as symbol]: router },
    },
  });
  return { w, push };
}

async function submit(w: ReturnType<typeof mountLogin>['w']) {
  const form = w.find('form').element as HTMLFormElement;
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  // a cadeia submit → validação async → login/toast passa por várias microtasks
  await new Promise((r) => setTimeout(r, 400));
}

function mockStore(login: ReturnType<typeof vi.fn>) {
  vi.spyOn(authStoreModule, 'useAuthStore').mockImplementation((() => ({ login })) as never);
}

describe('LoginPage', () => {
  it('submete com valores preenchidos', async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    mockStore(login);
    const { w, push } = mountLogin();
    await w.find('#login-email').setValue('a@b.com');
    await w.find('#login-password').setValue('SenhaForte123!');
    await submit(w);
    expect(login).toHaveBeenCalledWith('a@b.com', 'SenhaForte123!');
    // aguarda o await router.push() resolver no encadeamento da página
    await new Promise((r) => setTimeout(r, 50));
    expect(push).toHaveBeenCalledWith({ name: 'agenda' });
    const alerts = w.findAll('[role="alert"]').map((a) => a.text());
    expect(alerts).toEqual([]); // sem erros de validação com campos válidos
    vi.restoreAllMocks();
  });

  it('campos vazios mostram erros de validação e não chamam a API', async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    mockStore(login);
    const spy = vi.spyOn(api.authApi, 'login').mockResolvedValue(undefined as never);
    const { w } = mountLogin();
    await submit(w);
    expect(login).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
    expect(w.findAll('[role="alert"]').map((a) => a.text())).toHaveLength(2);
    vi.restoreAllMocks();
  });

  it('credenciais inválidas mostram toast de erro da API', async () => {
    mockStore(vi.fn().mockRejectedValue(
      Object.assign(new Error('unauthorized'), {
        response: { data: { message: 'Email ou senha invalidos' }, status: 401 },
      }),
    ));
    const { w } = mountLogin();
    await w.find('#login-email').setValue('a@b.com');
    await w.find('#login-password').setValue('errada1234');
    await submit(w);
    expect(toast.error).toHaveBeenCalledWith('Email ou senha invalidos');
    vi.restoreAllMocks();
  });
});
