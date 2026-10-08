<template>
  <AuthLayout>
    <AppCard>
      <h1 class="title-page mb-1">
        Esqueci a senha
      </h1>

      <!-- Estado de sucesso neutro FIXO (único texto possível, spec regra 12).
           v-if/v-else sobre dois <div> (não template+form): a troca de um form
           nu para fragmento quebrava o patch do Vue em happy-dom. -->
      <div v-if="sent">
        <p
          class="mb-6 text-sm text-muted-foreground"
          role="status"
        >
          Se existir uma conta com esse e-mail, enviaremos um link de redefinição (válido por 1
          hora). Confira a caixa de entrada e o spam.
        </p>
        <RouterLink
          to="/login"
          class="block text-center text-sm text-muted-foreground underline"
        >
          Voltar para o login
        </RouterLink>
      </div>

      <div v-else>
        <p class="mb-6 text-sm text-muted-foreground">
          Informe seu e-mail e enviaremos um link para você definir uma senha nova.
        </p>

        <form
          class="flex flex-col gap-4"
          novalidate
          @submit="onSubmit"
        >
          <AppField>
            <AppLabel for="forgot-email">
              E-mail
            </AppLabel>
            <AppInput
              id="forgot-email"
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

          <AppButton
            type="submit"
            :disabled="forgot.isPending.value"
          >
            {{ forgot.isPending.value ? 'Enviando…' : 'Enviar link' }}
          </AppButton>
        </form>

        <RouterLink
          to="/login"
          class="mt-4 block text-center text-sm text-muted-foreground underline"
        >
          Voltar para o login
        </RouterLink>
      </div>
    </AppCard>
  </AuthLayout>
</template>

<script setup lang="ts">
/**
 * "Esqueci a senha" (spec esqueci-a-senha regra 12): card com só o e-mail +
 * botão "Enviar link". O submit chama a API independentemente do resultado e a
 * tela SEMPRE mostra o mesmo estado neutro (a resposta 202 é uniforme — não há
 * variação de texto por e-mail, nem contador de quota: reenviar é apertar de novo).
 *
 * Padrão de form do repo (gotcha 7): useForm({ validate }) com zod dos
 * contracts, achata() p/ Refs aninhados, :model-value + @update:model-value.
 */
import { ref } from 'vue';
import { forgotPasswordInputSchema } from '@agendabo/contracts';
import { useField, useForm } from 'vee-validate';
import { RouterLink } from 'vue-router';
import { useForgotPasswordMutation } from '@/app/composables/mutations/useForgotPassword.mutation';
import AuthLayout from '@/view/layouts/AuthLayout.vue';
import AppButton from '@/view/components/ui/button/Button.vue';
import AppCard from '@/view/components/ui/card/Card.vue';
import AppField from '@/view/components/ui/field/Field.vue';
import AppInput from '@/view/components/ui/input/Input.vue';
import AppLabel from '@/view/components/ui/label/Label.vue';

const formOptions = {
  validateOnBlur: false,
  validateOnChange: true,
  validate: (values: Record<string, unknown>) => {
    const parsed = forgotPasswordInputSchema.safeParse(values);
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

/** Achata Refs aninhados (multi-cópia vee-validate em DEV — gotcha 7; ver LoginPage.vue). */
function achata(v: unknown): string {
  void v;
  let cur = v;
  for (let i = 0; i < 5 && cur != null && typeof cur === 'object' && 'value' in (cur as object); i++) {
    cur = (cur as { value: unknown }).value;
  }
  return typeof cur === 'string' ? cur : '';
}

const forgot = useForgotPasswordMutation();
const sent = ref(false);

const onSubmit = handleSubmit(async (vals) => {
  const values = { email: achata((vals as { email?: unknown }).email ?? email.value) };
  // Rede de segurança: revalidar com o MESMO zod dos contracts no submit (LoginPage.vue).
  const parsed = forgotPasswordInputSchema.safeParse(values);
  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    if (flat.email?.[0]) setFieldError('email', flat.email[0]);
    return;
  }
  // Anti-enumeration: QUALQUER desfecho (202, erro de rede, 500) mostra o mesmo
  // estado neutro — a API nunca revela se o e-mail existe (spec regras 2/12).
  try {
    await forgot.mutateAsync(values);
  } catch {
    /* silencioso por decisão de produto: o texto fixo cobre todos os casos */
  }
  sent.value = true;
});
</script>
