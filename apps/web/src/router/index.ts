import { createRouter, createWebHistory } from 'vue-router';
import { middlewarePipeline } from './middlewarePipeline';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/agenda' },
    // contas (fase 6)
    { path: '/login', name: 'login', component: () => import('../view/pages/auth/LoginPage.vue'), meta: { middleware: ['checkAlreadyLogged'] } },
    { path: '/cadastro', name: 'signup', component: () => import('../view/pages/auth/SignupPage.vue'), meta: { middleware: ['checkAlreadyLogged'] } },
    { path: '/confirmar', name: 'confirm', component: () => import('../view/pages/auth/ConfirmPage.vue'), meta: { middleware: ['checkAlreadyLogged'] } },
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
  ],
});

router.beforeEach(async (to, from, next) => {
  const middlewares = (to.meta.middleware as string[] | undefined) ?? [];
  const context = { to, from, next };
  await middlewarePipeline(context, middlewares, 0);
});
