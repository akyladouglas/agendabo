<template>
  <AuthLayout>
    <!-- Token ausente na URL ou 410: card único, NENHUM campo de senha (spec regra 14) -->
    <AppCard v-if="state === 'invalid'">
      <h1 class="title-page mb-1">
        Redefinir senha
      </h1>
      <p
        class="mb-6 text-sm text-muted-foreground"
        role="alert"
      >
        Link inválido ou expirado. Solicite um novo.
      </p>
      <RouterLink
        to="/esqueci-a-senha"
        class="block text-center text-sm text-muted-foreground underline"
      >
        Solicitar novo link
      </RouterLink>
    </AppCard>

    <AppCard v-else>
      <h1 class="title-page mb-1">
        Nova senha
      </h1>
      <p class="mb-6 text-sm text-muted-foreground">
        Escolha uma senha nova com pelo menos 8 caracteres.
      </p>

      <form
        class="flex flex-col gap-4"
        novalidate
        @submit="onSubmit"
      >
        <AppField>
          <AppLabel for="reset-password">
            Nova senha
          </AppLabel>
          <AppInput
            id="reset-password"
            :model-value="achata(password.value)"
            type="password"
            autocomplete="new-password"
            :aria-invalid="Boolean(achata(password.errorMessage))"
            :class="achata(password.errorMessage) ? 'border-danger' : ''"
            @update:model-value="password.setValue(String($event))"
          />
          <p
            v-if="achata(password.errorMessage)"
            class="text-xs text-danger"
            role="alert"
          >
            {{ achata(password.errorMessage) }}
          </p>
        </AppField>

        <AppField>
          <AppLabel for="reset-confirm">
            Confirmar senha
          </AppLabel>
          <AppInput
            id="reset-confirm"
            :model-value="achata(confirm.value)"
            type="password"
            autocomplete="new-password"
            :aria-invalid="Boolean(achata(confirm.errorMessage))"
            :class="achata(confirm.errorMessage) ? 'border-danger' : ''"
            @update:model-value="confirm.setValue(String($event))"
          />
          <p
            v-if="achata(confirm.errorMessage)"
            class="text-xs text-danger"
            role="alert"
          >
            {{ achata(confirm.errorMessage) }}
          </p>
        </AppField>

        <AppButton
          type="submit"
          :disabled="submitting"
        >
          {{ submitting ? 'Salvando…' : 'Salvar nova senha' }}
        </AppButton>
      </form>
    </AppCard>
  </AuthLayout>
</template>

<script setup lang="ts">
/**
 * Redefinir senha via magic link (spec esqueci-a-senha regras 13/14): rota
 * PÚBLICA que chega de fora da SPA — o token vem SOZINHO na URL (a única
 * exceção documentada à política "nada de dado do usuário em query params":
 * token opaco, uso único, TTL 1h). Sem handoff, sem sessionStorage: o fluxo é
 * deliberadamente stateless. Sem token OU após um 410 => card único "Link
 * inválido ou expirado" SEM mostrar os campos de senha. Sucesso => toast
 * discreto + redirect /login (sem login automático, sem prefill de e-mail).
 *
 * Padrão de form do repo (gotcha 7): useForm({ validate }) + zod dos contracts.
 */
import { computed, ref } from 'vue';
import { resetPasswordInputSchema } from '@agendabo/contracts';
import { useField, useForm } from 'vee-validate';
import { AxiosError } from 'axios';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { toast } from 'vue-sonner';
import { useResetPasswordMutation } from '@/app/composables/mutations/useResetPassword.mutation';
import AuthLayout from '@/view/layouts/AuthLayout.vue';
import AppButton from '@/view/components/ui/button/Button.vue';
import AppCard from '@/view/components/ui/card/Card.vue';
import AppField from '@/view/components/ui/field/Field.vue';
import AppInput from '@/view/components/ui/input/Input.vue';
import AppLabel from '@/view/components/ui/label/Label.vue';

const route = useRoute();
const router = useRouter();

/**
 * Valida o token da URL com o MESMO zod dos contracts (^[0-9a-f]{64}$) antes de
 * mostrar o form: link visivelmente malformado cai no card genérico na hora,
 * sem gastar round-trip na API (M4 do review).
 */
const tokenFromUrl = typeof route.query.token === 'string' ? route.query.token : '';
const tokenIsWellFormed = /^[0-9a-f]{64}$/.test(tokenFromUrl);

/** Único estado aceito: com token utilizável, ou card de link inválido. */
const state = ref<'form' | 'invalid'>(tokenIsWellFormed ? 'form' : 'invalid');

const formOptions = {
  validateOnBlur: false,
  validateOnChange: true,
  validate: (values: Record<string, unknown>) => {
    // a API só conhece `{ token, password }`; "confirmar senha" é validação do form
    const toCheck = { token: values.token, password: values.password };
    const parsed = resetPasswordInputSchema.safeParse(toCheck);
    if (!parsed.success) {
      const out: Record<string, string> = {};
      for (const [k, msgs] of Object.entries(parsed.error.flatten().fieldErrors)) {
        if (msgs?.[0]) out[k] = msgs[0];
      }
      return out;
    }
    if (values.password !== values.confirm) {
      return { confirm: 'As senhas não coincidem.' };
    }
    return {};
  },
};
const { handleSubmit, setFieldError } = useForm({
  ...formOptions,
  initialValues: { token: String(route.query.token ?? '') },
} as never);
const password = useField<string>('password');
const confirm = useField<string>('confirm');

/** Achata Refs aninhados (multi-cópia vee-validate em DEV — gotcha 7; ver LoginPage.vue). */
function achata(v: unknown): string {
  void v;
  let cur = v;
  for (let i = 0; i < 5 && cur != null && typeof cur === 'object' && 'value' in (cur as object); i++) {
    cur = (cur as { value: unknown }).value;
  }
  return typeof cur === 'string' ? cur : '';
}

const reset = useResetPasswordMutation();
const submitting = computed(() => reset.isPending.value === true);

const onSubmit = handleSubmit(async (vals) => {
  const token = typeof route.query.token === 'string' ? route.query.token : '';
  const values = {
    token,
    password: achata((vals as { password?: unknown }).password ?? password.value),
    confirm: achata((vals as { confirm?: unknown }).confirm ?? confirm.value),
  };
  // Rede de segurança com o MESMO zod dos contracts + confirmação do form (LoginPage.vue).
  const parsed = resetPasswordInputSchema.safeParse({ token: values.token, password: values.password });
  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    if (flat.password?.[0]) setFieldError('password', flat.password[0]);
    return;
  }
  if (values.password !== values.confirm) {
    setFieldError('confirm', 'As senhas não coincidem.');
    return;
  }
  try {
    await reset.mutateAsync({ token: values.token, password: values.password });
    toast.success('Senha alterada com sucesso. Faça login para entrar.');
    await router.push({ name: 'login' });
  } catch (err) {
    // 410 = inexistente/usado/expirado — TODOS viram o mesmo card, sem campos de senha
    if ((err as AxiosError).response?.status === 410) state.value = 'invalid';
    else toast.error('Algo deu errado, tente de novo.');
  }
});
</script>
