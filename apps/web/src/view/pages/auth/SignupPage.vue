<template>
  <AuthLayout>
    <AppCard>
      <h1 class="title-page mb-1">
        Criar conta
      </h1>
      <p class="mb-6 text-sm text-muted-foreground">
        Depois de criar a conta, confirme o código que enviamos por e-mail para liberar o bot.
      </p>

      <form
        class="flex flex-col gap-4"
        novalidate
        @submit="onSubmit"
      >
        <AppField>
          <AppLabel for="signup-name">
            Como o bot deve te chamar
          </AppLabel>
          <AppInput
            id="signup-name"
            :model-value="achata(name.value)"
            :initial="draftInitial?.name"
            type="text"
            autocomplete="given-name"
            placeholder="Ex.: Ana"
            :aria-invalid="Boolean(achata(name.errorMessage))"
            :class="achata(name.errorMessage) ? 'border-danger' : ''"
            @update:model-value="name.setValue(String($event))"
          />
          <p
            v-if="achata(name.errorMessage)"
            class="text-xs text-danger"
            role="alert"
          >
            {{ achata(name.errorMessage) }}
          </p>
          <p class="text-xs text-muted-foreground">
            Opcional — aparece nas boas-vindas do bot.
          </p>
        </AppField>

        <AppField>
          <AppLabel for="signup-email">
            E-mail
          </AppLabel>
          <AppInput
            id="signup-email"
            :model-value="achata(email.value)"
            :initial="draftInitial?.email"
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
          <AppLabel for="signup-telegram">
            Telegram ID
          </AppLabel>
          <AppInput
            id="signup-telegram"
            :model-value="achata(telegramId.value)"
            :initial="draftInitial?.telegramId"
            inputmode="numeric"
            autocomplete="off"
            placeholder="Ex.: 123456789"
            :aria-invalid="Boolean(achata(telegramId.errorMessage))"
            :class="achata(telegramId.errorMessage) ? 'border-danger' : ''"
            @update:model-value="telegramId.setValue(String($event))"
          />
          <p
            v-if="achata(telegramId.errorMessage)"
            class="text-xs text-danger"
            role="alert"
          >
            {{ achata(telegramId.errorMessage) }}
          </p>
          <p class="text-xs leading-relaxed text-muted-foreground">
            Não sabe o seu ID?
            <button
              type="button"
              class="font-medium text-primary underline"
              :aria-expanded="showTgHelp"
              aria-controls="tg-help"
              @click="showTgHelp = !showTgHelp"
            >
              Como obter o Telegram ID
            </button>
          </p>
          <div
            v-if="showTgHelp"
            id="tg-help"
            class="rounded-md border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground"
          >
            <ol class="list-decimal space-y-1 pl-4">
              <li>Abra o Telegram e procure o bot <code class="rounded bg-muted px-1">@userinfobot</code>.</li>
              <li>Mande qualquer mensagem pra ele (ex.: <code class="rounded bg-muted px-1">oi</code>).</li>
              <li>
                Ele responde com seu <em>Id</em> numérico (ex.:
                <code class="rounded bg-muted px-1">123456789</code>) — copie só esse número e cole
                no campo acima.
              </li>
            </ol>
          </div>
        </AppField>

        <AppField>
          <AppLabel for="signup-password">
            Senha
          </AppLabel>
          <AppInput
            id="signup-password"
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
          <p
            v-else
            class="text-xs text-muted-foreground"
          >
            Mínimo de 8 caracteres.
          </p>
        </AppField>

        <AppField>
          <AppLabel for="signup-confirm">
            Confirmar senha
          </AppLabel>
          <AppInput
            id="signup-confirm"
            :model-value="achata(confirmPassword.value)"
            type="password"
            autocomplete="new-password"
            :aria-invalid="Boolean(achata(confirmPassword.errorMessage))"
            :class="achata(confirmPassword.errorMessage) ? 'border-danger' : ''"
            @update:model-value="confirmPassword.setValue(String($event))"
          />
          <p
            v-if="achata(confirmPassword.errorMessage)"
            class="text-xs text-danger"
            role="alert"
          >
            {{ achata(confirmPassword.errorMessage) }}
          </p>
        </AppField>

        <p
          v-if="serverError"
          class="rounded-md border border-danger bg-danger/10 px-3 py-2 text-sm text-danger"
          role="alert"
        >
          {{ serverError }}
        </p>

        <AppButton
          type="submit"
          :disabled="submitting"
        >
          {{ submitting ? 'Criando conta…' : 'Criar conta' }}
        </AppButton>
      </form>

      <RouterLink
        to="/login"
        class="mt-4 block text-center text-sm text-muted-foreground underline"
      >
        Já tem conta? Entrar
      </RouterLink>
    </AppCard>
  </AuthLayout>
</template>

<script setup lang="ts">
/**
 * Cadastro (Fase 5, spec web R-auth): nome opcional, telegramId com tutorial do
 * @userinfobot, senha + confirmação. Zod vem dos contracts (vue.md #4) — aqui só
 * estendo com `confirmPassword`, sem duplicar o schema base.
 *
 * Ajuda de UI: `AppInput` é só o <input> (sem slot) — hints/erros ficam no
 * `AppField`, DEPOIS do input. O tutorial do Telegram ID é sempre visível
 * (botão "Como obter o Telegram ID" abre o passo a passo), independente de erro.
 */
import { signupInputSchema } from '@agendabo/contracts';
import { AxiosError } from 'axios';
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useField, useForm } from 'vee-validate';
import { z } from 'zod';
import { authApi } from '@/app/services/api';
import { getDraftSignup, setAuthHandoff, setDraftSignup } from '@/router';
import AuthLayout from '@/view/layouts/AuthLayout.vue';
import AppButton from '@/view/components/ui/button/Button.vue';
import AppCard from '@/view/components/ui/card/Card.vue';
import AppField from '@/view/components/ui/field/Field.vue';
import AppInput from '@/view/components/ui/input/Input.vue';
import AppLabel from '@/view/components/ui/label/Label.vue';

const router = useRouter();

/** Tutorial "Como obter o Telegram ID" (expansível — spec web decisão 8). */
const showTgHelp = ref(false);

const zodSchema = signupInputSchema
  .extend({ confirmPassword: z.string().min(1, 'Confirme a senha.') })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'As senhas não conferem.',
    // NOTE: com .refine o zod 3.25 perde o narrowing de discriminação do
    // safeParse no vue-tsc (parsed.error vira "possivelmente undefined" mesmo
    // com if). Sem consequência em runtime; cast documentado no onSubmit.
  });

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
    const parsed = zodSchema.safeParse(values);
    if (parsed.success) return {};
    const out: Record<string, string> = {};
    for (const [k, msgs] of Object.entries(parsed.error.flatten().fieldErrors)) {
      if (msgs?.[0]) out[k] = msgs[0];
    }
    return out;
  },
};
const { handleSubmit, setFieldError } = useForm(formOptions as never);

/** Achata Refs aninhados (gotcha 7 — multi-cópia do vee-validate em dev). */
function achata<T>(v: unknown): T {
  void v;
  let cur = v;
  for (let i = 0; i < 5 && cur != null && typeof cur === 'object' && 'value' in (cur as object); i++) {
    cur = (cur as { value: unknown }).value;
  }
  return cur as T;
}

const submitting = ref(false);
const serverError = ref('');

const name = useField<string>('name');
const email = useField<string>('email');
const telegramId = useField<string>('telegramId');
const password = useField<string>('password');
const confirmPassword = useField<string>('confirmPassword');

// Voltou do /confirmar ("Voltar para o cadastro")? Repreenche o que ele digitou
// (senha NUNCA — decisão do humano em 2026-10-08). Em DEV as multi-cópias do
// vee-validate engolem `setValue()` antes da montagem, então o caminho confiável
// é o prop `initial` do AppInput (semente `local` dele) + setValue no form para a
// validação/submit. `draftInitial` é reativo: se o rascunho chegar depois da
// montagem (guard de rota ainda não rodou), o watch aplica na hora.
const draftInitial = ref(getDraftSignup());
function applyDraft(d: NonNullable<ReturnType<typeof getDraftSignup>>) {
  name.setValue(d.name);
  email.setValue(d.email);
  telegramId.setValue(d.telegramId);
}
if (draftInitial.value) applyDraft(draftInitial.value);
onMounted(() => {
  const d = getDraftSignup();
  if (d) {
    draftInitial.value = d;
    applyDraft(d);
  }
});

const onSubmit = handleSubmit(async (vals) => {
  // Rede de segurança (gotcha 7): revalidar com o MESMO zod dos contracts
  // garante que a API nunca receba valores inválidos (spec R-validação).
  const values = {
    name: achata<string>((vals as { name?: unknown }).name ?? name.value),
    email: achata<string>((vals as { email?: unknown }).email ?? email.value),
    telegramId: achata<string>((vals as { telegramId?: unknown }).telegramId ?? telegramId.value),
    password: achata<string>((vals as { password?: unknown }).password ?? password.value),
    confirmPassword: achata<string>(
      (vals as { confirmPassword?: unknown }).confirmPassword ?? confirmPassword.value,
    ),
  };
  const parsed = zodSchema.safeParse(values) as
    | { success: true; data: typeof values }
    | { success: false; error: z.ZodError };
  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    for (const field of ['name', 'email', 'telegramId', 'password', 'confirmPassword'] as const) {
      const msg = flat[field]?.[0];
      if (msg) setFieldError(field, msg);
    }
    serverError.value = parsed.error.issues[0]?.message ?? 'Confira os campos destacados.';
    return;
  }
  submitting.value = true;
  try {
    const result = (await authApi.signup({
      name: values.name || undefined,
      email: values.email,
      password: values.password,
      telegramId: values.telegramId,
    })) as { mailDelivered?: boolean; pendingResumed?: boolean };
    // Guarda o rascunho p/ o caso "voltar para o cadastro" (sem senha).
    setDraftSignup({ name: values.name ?? '', email: values.email, telegramId: values.telegramId });
    // E-mail via handoff em memória — NUNCA query param (decisão 2026-10-08).
    setAuthHandoff({ confirmEmail: values.email, mailFailed: result.mailDelivered === false });
    await router.push({ name: 'confirm' });
  } catch (err) {
    const ax = err as AxiosError<{ message?: string; code?: string }>;
    const code = ax.response?.data?.code;
    const msg = ax.response?.data?.message;
    if (ax.response?.status === 409 && code === 'email_taken') {
      setFieldError('email', 'Este e-mail já está cadastrado.');
    } else if (ax.response?.status === 409 && code === 'telegram_taken') {
      setFieldError('telegramId', 'Este telegramId já está cadastrado.');
    } else {
      serverError.value = msg ?? 'Erro inesperado ao criar conta.';
    }
  } finally {
    submitting.value = false;
  }
});
</script>
