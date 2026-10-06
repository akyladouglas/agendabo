import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Dominio puro: nenhuma dependencia de infra e permitida aqui.
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            'fs',
            'path',
            'http',
            'https',
            'net',
            'child_process',
            { name: '@prisma/client', message: 'schedule-core e dominio puro: sem Prisma.' },
            { name: '@nestjs/common', message: 'schedule-core e dominio puro: sem Nest.' },
            { name: 'bullmq', message: 'schedule-core e dominio puro: sem filas.' },
            {
              name: '@agendabo/contracts',
              message: 'schedule-core nao depende de contracts (dominio independente).',
            },
          ],
        },
      ],
    },
  },
  {
    ignores: ['dist/**', 'src/**/*.spec.ts'],
  },
);
