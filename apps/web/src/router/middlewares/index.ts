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

export const middlewares: Record<string, Middleware> = { requireAuth, checkAlreadyLogged };
