import { createRouter, createWebHistory } from 'vue-router';
import { middlewarePipeline } from './middlewarePipeline';

/** Rascunho do signup via sessionStorage (Fase 5): sobrevive a navegação SPA e
 * F5, mas NÃO guarda senha nunca (decisão do humano em 2026-10-08). */
export interface DraftSignup {
  name: string;
  email: string;
  telegramId: string;
}
const DRAFT_KEY = 'agendabo.signup.draft';
export function setDraftSignup(d: DraftSignup | null): void {
  try {
    if (d) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* storage indisponível (privado/SSR): rascunho é só conveniência */
  }
}
export function getDraftSignup(): DraftSignup | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as DraftSignup) : null;
  } catch {
    return null;
  }
}

/**
 * Passo-a-passo do fluxo de auth SEM query params (decisão do humano em
 * 2026-10-08: dados do usuário nunca visíveis na URL — histórico/compartilhamento/
 * shoulder-surfing). É memória da SPA: sobrevive à navegação entre rotas e some no
 * F5. Cada tela consome e limpa; abrir a rota direto sem passar pelo fluxo mostra
 * estado claro "recomece", sem dados na barra de endereço.
 */
export interface AuthHandoff {
  /** E-mail da conta que acabou de ser criada / aguarda confirmação. */
  confirmEmail?: string;
  /** true = o email de confirmação falhou ao enviar (UI orienta "Reenviar código"). */
  mailFailed?: boolean;
  /** E-mail para pré-preencher o login (pós-confirmação ou 403 e-mail pendente). */
  loginEmail?: string;
}
let handoff: AuthHandoff = {};
export function setAuthHandoff(h: AuthHandoff): void {
  handoff = { ...h };
}
/** Lê e LIMPA (consumo único) — evita vazar o mesmo e-mail para uma segunda tela. */
export function takeAuthHandoff(): AuthHandoff {
  const h = handoff;
  handoff = {};
  return h;
}
/** Só olha (sem consumir) — usado pela guarda de rota do /confirmar. */
export function peekAuthHandoff(): AuthHandoff {
  return handoff;
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/agenda' },
    // contas (fase 6)
    { path: '/login', name: 'login', component: () => import('../view/pages/auth/LoginPage.vue'), meta: { middleware: ['checkAlreadyLogged'] } },
    { path: '/cadastro', name: 'signup', component: () => import('../view/pages/auth/SignupPage.vue'), meta: { middleware: ['checkAlreadyLogged'] } },
    { path: '/confirmar', name: 'confirm', component: () => import('../view/pages/auth/ConfirmPage.vue'), meta: { middleware: ['checkAlreadyLogged'] } },
    // "Esqueci a senha" (spec esqueci-a-senha): as duas rotas são PÚBLICAS e sem
    // middleware de propósito — /redefinir-senha funciona logada ou não (o reset
    // pode partir de qualquer estado) e o fluxo é stateless: NENHUM dado do reset
    // entra em handoff/sessionStorage. `/redefinir-senha?token=` é a ÚNICA
    // exceção documentada à política "nenhum dado do usuário em query params"
    // (decisão D4: token opaco, uso único, TTL 1h — não carrega dado do usuário).
    { path: '/esqueci-a-senha', name: 'forgot-password', component: () => import('../view/pages/auth/ForgotPasswordPage.vue') },
    { path: '/redefinir-senha', name: 'reset-password', component: () => import('../view/pages/auth/ResetPasswordPage.vue') },
    // agenda (fase 7)
    {
      path: '/agenda',
      name: 'agenda',
      component: () => import('../view/pages/agenda/AgendaPage.vue'),
      meta: { middleware: ['requireAuth'] },
    },
    {
      path: '/revisao',
      name: 'review',
      component: () => import('../view/pages/review/ReviewPage.vue'),
      meta: { middleware: ['requireAuth'] },
    },
    {
      path: '/perfil',
      name: 'profile',
      component: () => import('../view/pages/profile/ProfilePage.vue'),
      meta: { middleware: ['requireAuth'] },
    },
    // observabilidade (Fase 9): admin vê tudo; rollout vê os próprios eventos;
    // o resto vê "Acesso restrito" (a guarda de verdade é a API).
    {
      path: '/admin',
      name: 'admin',
      component: () => import('../view/pages/admin/AdminPage.vue'),
      meta: { middleware: ['requireAuth'] },
    },
  ],
});

router.beforeEach(async (to, from, next) => {
  // Guarda do fluxo de confirmacao: /confirmar SEM e-mail em memoria (URL forcada,
  // link direto ou F5 — o handoff e memoria da SPA) NAO e uma tela utilizavel:
  // manda o usuario direto para o login, sem aviso (decisao do humano em 2026-10-08).
  // Navegacao interna apos cadastro/login-403 sempre traz o handoff e passa.
  if (to.name === 'confirm' && !peekAuthHandoff().confirmEmail) {
    next({ name: 'login' });
    return;
  }
  const middlewares = (to.meta.middleware as string[] | undefined) ?? [];
  const context = { to, from, next };
  await middlewarePipeline(context, middlewares, 0);
});

export { router };
