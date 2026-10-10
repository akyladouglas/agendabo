import { useAuthStore } from '../../app/store/authStore';
import type { Middleware } from '../middlewarePipeline';

const requireAuth: Middleware = async (context, nextMiddleware, index) => {
  const auth = useAuthStore();
  if (!auth.isLoggedIn) {
    context.next({ name: 'login' });
    return;
  }
  await nextMiddleware(index + 1);
};

const checkAlreadyLogged: Middleware = async (context, nextMiddleware, index) => {
  const auth = useAuthStore();
  if (auth.isLoggedIn) {
    context.next({ name: 'agenda' });
    return;
  }
  await nextMiddleware(index + 1);
};

/**
 * Observabilidade (página Admin): a GUARDA REAL é do server (`/observabilidade/me`,
 * `/bot-events`, `/llm-usage`); a rota é acessível também ao rollout (ele vê os
 * próprios eventos) — o `isAdmin` do store só evita o flash do estado restrito
 * para quem claramente não tem nada (e nem assim bloqueia: a página se resolve
 * pela API).
 */
export const middlewares: Record<string, Middleware> = { requireAuth, checkAlreadyLogged };
