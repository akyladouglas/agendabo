/**
 * Arquitetura fisica do monolito modular (ADR-000).
 * `pnpm lint:arch` roda depcruise e falha se alguma regra for violada.
 *
 * Nota de caminho: o depcruise cruza `src/` a partir da raiz do app, entao os
 * paths de `from`/`to` internos comecam com `src/`. Com pnpm, pacotes vivem em
 * `../../node_modules/.pnpm/<pkg>@<versao>/node_modules/<pkg>` (e `@scope/pkg`
 * vira `@scope+pkg`), por isso os matchers de terceiros sao regex tolerantes.
 */

/**
 * Grafos permitidos de `modules/X -> modules/Y` (imports diretos entre modulos).
 * Toda aresta nova precisa de justificativa/ADR. Os *.module.ts do composition
 * root (imports para o graph) sao liberados separadamente.
 */
const CROSS_MODULE_EDGES = {
  // auth e infraestrutura de identidade: qualquer modulo consome decorators/guard
  // e o composition root (app.module) liga tudo.
  'modules/auth': ['modules', 'health', 'shared', 'app.module.ts'],
  'modules/appointments': ['modules'],
  'modules/bot': ['modules'],
  'modules/ai': ['modules'],
  'modules/notifications': ['modules'],
  'modules/users': ['modules'],
};

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'ai-sdk-encapsulation',
      comment: 'Somente modules/ai pode importar o SDK da Anthropic.',
      severity: 'error',
      from: { pathNot: '^src/modules/ai/' },
      to: { path: '@anthropic-ai[+/]sdk' },
    },
    {
      name: 'telegram-encapsulation',
      comment: 'Telegraf apenas em shared/telegram e modules/bot.',
      severity: 'error',
      from: { pathNot: '^src/(shared/telegram|modules/bot)/' },
      to: { path: '[.]pnpm/telegraf@|/node_modules/telegraf/' },
    },
    {
      name: 'resend-encapsulation',
      comment: 'Resend apenas via auth/mail.service.',
      severity: 'error',
      from: { pathNot: '^src/modules/auth/' },
      to: { path: '[.]pnpm/resend@|/node_modules/resend/' },
    },
    {
      name: 'no-controller-to-prisma',
      comment: 'Controller nunca fala com Prisma: use service -> repository.',
      severity: 'error',
      from: { path: '\\.controller\\.ts$' },
      to: { path: '^src/shared/prisma/prisma\\.service' },
    },
    {
      name: 'bot-handler-thin',
      comment: 'Nada dentro de modules/ai/ (salvo o provider do SDK) usa Telegraf.',
      severity: 'error',
      from: { path: '^src/modules/ai/' },
      to: { path: '[.]pnpm/telegraf@|/node_modules/telegraf/' },
    },
    {
      name: 'schedule-core-pure',
      comment: 'schedule-core nao e importado de fora, mas se fosse, nunca com Prisma ao redor.',
      severity: 'info',
      from: { path: '@agendabo[+/]schedule-core' },
      to: { path: '@prisma[+/]client' },
    },
    // Regra invertida: em vez de "de X pode importar Y", proibimos "pra Y so de X".
    ...Object.entries(CROSS_MODULE_EDGES).flatMap(([targetModule, allowedSources]) => {
      const allowedRe = `^src/(${allowedSources.map((m) => m.replace('/', '\\/')).join('|')})(/|$)`;
      return [
        {
          name: `only-allowed-sources-for-${targetModule.replace(/\//g, '-')}`,
          comment: `modules/${targetModule.split('/')[1]} so pode ser importado de: ${allowedSources.join(', ') || '(ninguem, so o composition root via .module)'}`,
          severity: 'error',
          from: { path: '^src/', pathNot: `${allowedRe}|^src/${targetModule}/` },
          to: { path: `^src/${targetModule}/(?!.*\\.module\\.ts$)` },
        },
      ];
    }),
    {
      name: 'no-circular',
      comment: 'Sem imports circulares.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    moduleSystems: ['cjs', 'amd', 'es6', 'tsd'],
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['node', 'require'] },
  },
};
