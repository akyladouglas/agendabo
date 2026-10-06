# Regra — Vue (apps/web)

**Escopo:** `apps/web`. Stack: Vue 3.5 + `<script setup>` + TS estrito, Vite 6,
Tailwind v4 (sem tailwind.config — `@theme` em `styles/main.css`), radix-vue,
TanStack Vue Query 5, pinia, vee-validate/zod, vue-sonner.

## Estrutura (padrão financas)

- `src/app/` = lógica: `config/` (env, queryKeys), `store/` (pinia composition-style),
  `services/` (1 chamada por arquivo), `composables/queries|mutations/`, `utils/`,
  `domain/`.
- `src/view/` = UI: `layouts/`, `pages/<feature>/XPage.vue` (+ `useXPage.composable.ts`
  quando a página passa de ~150 linhas), `components/ui/<primitivo>/` (wrappers finos de
  radix-vue).

## Regras

1. **Composição sempre**: `<script setup lang="ts">`, sem Options API, sem `defineComponent`.
2. **Estado de servidor só no TanStack Query**: componentes nunca chamam axios direto;
   use o composable de query/mutation correspondente em `app/composables/`. Invalidação
   sempre via chaves de `app/config/queryKeys.ts` (`qk`).
3. **Estado de cliente no pinia** (authStore/uiStore): stores composition-style; access
   token só em memória, nunca localStorage.
4. Formulário: **vee-validate + zod** com schema importado de `@agendabo/contracts`
   (nunca schema duplicado no front).
5. Tipos de API vêm de `@agendabo/contracts` (via alias de fonte — não importe `dist/`).
6. Componentes `ui/` são **burros**: props/emits tipados, zero regra de negócio, zero
   query dentro.
7. Datas para exibição: converter UTC→timezone do usuário com helpers de
   `@agendabo/schedule-core` (ou `Intl` local); formattar na borda, nunca armazenar
   string local.
8. Feedback: `vue-sonner` (`toast.success/error`) para mutações; loading/erro de query
   tratados explicitamente (sem tela em branco).
9. Rota autenticada exige `meta.middleware: ['requireAuth']`; bootstrap de sessão roda
   **antes** de `app.use(router)` (gotcha herdado).
