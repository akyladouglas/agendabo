import type { NavigationGuardNext, RouteLocationNormalized } from 'vue-router';

export interface MiddlewareContext {
  to: RouteLocationNormalized;
  from: RouteLocationNormalized;
  next: NavigationGuardNext;
}

export type Middleware = (
  context: MiddlewareContext,
  nextMiddleware: (index: number) => Promise<void>,
  index: number,
) => Promise<void>;

/** Executa a cadeia de middlewares do `meta.middleware` em ordem. */
export async function middlewarePipeline(
  context: MiddlewareContext,
  middlewares: string[],
  index: number,
): Promise<void> {
  if (index >= middlewares.length) {
    context.next();
    return;
  }
  const name = middlewares[index]!;
  const { middlewares: registry } = await import('./middlewares');
  const mw = registry[name];
  if (!mw) {
    context.next();
    return;
  }
  await mw(context, (i) => middlewarePipeline(context, middlewares, i), index);
}
