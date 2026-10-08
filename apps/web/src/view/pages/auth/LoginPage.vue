<template>
  <AuthLayout>
    <AppCard>
      <h1 class="title-page mb-1">
        Entrar
      </h1>
      <p class="mb-6 text-sm text-muted-foreground">
        Acesse sua agenda inteligente.
      </p>

      <form
        class="flex flex-col gap-4"
        novalidate
        @submit="onSubmit"
      >
        <AppField>
          <AppLabel for="login-email">
            E-mail
          </AppLabel>
          <AppInput
            id="login-email"
            :model-value="achata(email.value)"
            type="email"
            autocomplete="email"
            placeholder="voce@exemplo.com"
            :aria-invalid="Boolean(achata(email.errorMessage))"
            :class="achata(email.errorMessage) ? 'border-danger' : ''"
            @update:model-value="email.setValue(String($event))"
          />
          <p
            v-if="achata(email.errorMessage)"
            class="text-xs text-danger"
            role="alert"
          >
            {{ achata(email.errorMessage) }}
          </p>
        </AppField>

        <AppField>
          <AppLabel for="login-password">
            Senha
          </AppLabel>
          <AppInput
            id="login-password"
            :model-value="achata(password.value)"
            type="password"
            autocomplete="current-password"
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

        <AppButton
          type="submit"
          :disabled="submitting"
        >
          {{ submitting ? 'Entrando…' : 'Entrar' }}
        </AppButton>
      </form>

      <RouterLink
        to="/cadastro"
        class="mt-4 block text-center text-sm text-muted-foreground underline"
      >
        Não tem conta? Criar conta
      </RouterLink>
      <RouterLink
        to="/esqueci-a-senha"
        class="mt-2 block text-center text-sm text-muted-foreground underline"
      >
        Esqueci a senha?
      </RouterLink>
    </AppCard>
  </AuthLayout>
</template>

<script setup lang="ts">
/**
 * Página de login (Fase 5, spec web): vee-validate + zod dos contracts (vue.md #4 —
 * nenhum schema duplicado no front). Visual do protótipo OpenDesign.
 */
import { loginInputSchema } from '@agendabo/contracts';
import { useField, useForm } from 'vee-validate';
import { AxiosError } from 'axios';
import { ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { toast } from 'vue-sonner';
import { setAuthHandoff, setDraftSignup, takeAuthHandoff } from '@/router';
import { useAuthStore } from '@/app/store/authStore';
import AuthLayout from '@/view/layouts/AuthLayout.vue';
import AppButton from '@/view/components/ui/button/Button.vue';
import AppCard from '@/view/components/ui/card/Card.vue';
import AppField from '@/view/components/ui/field/Field.vue';
import AppInput from '@/view/components/ui/input/Input.vue';
import AppLabel from '@/view/components/ui/label/Label.vue';

const auth = useAuthStore();
const router = useRouter();

// Em DEV, cópias diferentes de vee-validate (esta página vs @vee-validate/zod)
// fazem o `validationSchema` validar um form sem registro e devolver {} — o
// validador função abaixo é a fonte de verdade e sempre vê o objeto real.
// `validateOnBlur: false`: com submit-only, o validador do form não roda no
// submit com essas cópias; com revalidação a cada tecla o erro aparece imediato
// (rede de segurança no onSubmit cobre o resto).
// (fora do tipo público do useForm no vee-validate 4.15, daí o cast)
const formOptions = {
  validateOnBlur: false,
  validateOnChange: true,
  validate: (values: Record<string, unknown>) => {
    const parsed = loginInputSchema.safeParse(values);
    if (parsed.success) return {};
    const out: Record<string, string> = {};
    for (const [k, msgs] of Object.entries(parsed.error.flatten().fieldErrors)) {
      if (msgs?.[0]) out[k] = msgs[0];
    }
    return out;
  },
};
const { handleSubmit, setFieldError } = useForm(formOptions as never);
const email = useField<string>('email');
const password = useField<string>('password');
// Pré-preenche o e-mail vindo de rota interna POS-ACAO (confirmação acabou de
// confirmar / 403 e-mail pendente) via handoff em memória — NUNCA query param
// (decisão do humano em 2026-10-08). É só conveniência de UX: o login real exige
// a senha e a API valida tudo; nada aqui autentica.
const handoff = takeAuthHandoff();
if (handoff.loginEmail) email.setValue(handoff.loginEmail);

const submitting = ref(false);

/**
 * Achata Refs aninhados. Em DEV o vite pode servir cópias diferentes de
 * vee-validate (a importada pela página ≠ a usada internamente), e aí
 * `field.value` devolve um Ref em vez do escalar. Em build é cópia única,
 * o achata vira no-op.
 * `void v` força o Vue a depender do `.value` interno (unwrapping no template).
 */
function achata(v: unknown): string {
  void v;
  let cur = v;
  for (let i = 0; i < 5 && cur != null && typeof cur === 'object' && 'value' in (cur as object); i++) {
    cur = (cur as { value: unknown }).value;
  }
  return typeof cur === 'string' ? cur : '';
}

const onSubmit = handleSubmit(async (vals) => {
  const values = {
    email: achata((vals as { email?: unknown }).email ?? email.value),
    password: achata((vals as { password?: unknown }).password ?? password.value),
  };
  // Rede de segurança: com cópias duplicadas de vee-validate em dev, o
  // validador às vezes não roda; revalidar aqui com o MESMO zod dos contracts
  // garante que a API nunca receba valores inválidos (spec R-validação).
  const parsed = loginInputSchema.safeParse(values);
  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    if (flat.email?.[0]) setFieldError('email', flat.email[0]);
    if (flat.password?.[0]) setFieldError('password', flat.password[0]);
    return;
  }
  submitting.value = true;
  try {
    await auth.login(values.email, values.password);
    await router.push({ name: 'agenda' });
  } catch (err) {
    const ax = err as AxiosError<{ message?: string }>;
    // 403 = conta criada porem ainda nao confirmada: em vez de so avisar, mandamos
    // o usuario retomar a confirmacao com o e-mail que ele acabou de digitar
    // (handoff em memoria — nada de e-mail na URL).
    if (ax.response?.status === 403) {
      setDraftSignup({ name: '', email: values.email, telegramId: '' });
      setAuthHandoff({ confirmEmail: values.email });
      await router.push({ name: 'confirm' });
      return;
    }
    toast.error(ax.response?.data?.message ?? 'E-mail ou senha inválidos.');
  } finally {
    submitting.value = false;
  }
});
</script>
