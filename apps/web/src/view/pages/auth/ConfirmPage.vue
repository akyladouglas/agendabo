<template>
  <AuthLayout>
    <AppCard>
      <h1 class="title-page mb-1">
        Confirmar e-mail
      </h1>
      <p class="mb-6 text-sm text-muted-foreground">
        <template v-if="mailFailed">
          Sua conta foi criada, mas não conseguimos enviar o e-mail com o código agora
          (instabilidade do serviço de e-mail). Use
          <strong class="text-foreground">Reenviar código</strong>
          abaixo — o código continua válido por 15 minutos.
        </template>
        <template v-else>
          Enviamos um código de 6 dígitos
          para <strong class="text-foreground">{{ email }}</strong>. Digite-o abaixo para ativar o bot.
        </template>
      </p>

      <form
        class="flex flex-col gap-4"
        novalidate
        @submit.prevent="verify"
      >
        <div class="flex flex-col gap-1.5">
          <span class="text-sm font-medium text-foreground">Código de confirmação</span>
          <div
            class="flex justify-between gap-2"
            role="group"
            aria-label="Código de confirmação de 6 dígitos"
          >
            <input
              v-for="(digit, i) in digits"
              :key="i"
              :ref="(el) => setInputRef(el as Element | null, i)"
              :value="digit"
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="6"
              class="od-move h-12 min-w-0 flex-1 rounded-md border border-border bg-surface-2 text-center text-lg text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring"
              :aria-label="`Dígito ${i + 1}`"
              @input="onInput(i, $event)"
              @keydown="onKeydown(i, $event)"
              @paste="onPaste"
            >
          </div>
        </div>

        <p
          v-if="error"
          class="text-sm text-danger"
          role="alert"
        >
          {{ error }}
        </p>

        <AppButton
          type="submit"
          :disabled="submitting"
        >
          {{ submitting ? 'Confirmando…' : 'Confirmar código' }}
        </AppButton>
        <button
          type="button"
          :disabled="resending"
          class="od-move self-center p-0 text-sm text-muted-foreground underline disabled:opacity-50"
          @click="resend"
        >
          {{ resending ? 'Enviando…' : 'Reenviar código' }}
        </button>
      </form>

      <div class="mt-4 flex flex-col items-center gap-1.5">
        <RouterLink
          :to="{ name: 'signup' }"
          class="text-sm text-muted-foreground underline"
        >
          Voltar para o cadastro
        </RouterLink>
        <RouterLink
          :to="{ name: 'login' }"
          class="text-sm text-muted-foreground underline"
        >
          Voltar para o login
        </RouterLink>
      </div>
    </AppCard>
  </AuthLayout>
</template>

<script setup lang="ts">
/**
 * Confirmação de e-mail (Fase 5): código de 6 dígitos em quadradinhos + reenvio
 * respeitando a quota da API (3 reenvios/30min — decisão do produto em 3.1.1).
 */
import { computed, nextTick, reactive, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { AxiosError } from 'axios';
import { toast } from 'vue-sonner';
import { authApi } from '@/app/services/api';
import { setAuthHandoff, setDraftSignup, takeAuthHandoff } from '@/router';
import AuthLayout from '@/view/layouts/AuthLayout.vue';
import AppButton from '@/view/components/ui/button/Button.vue';
import AppCard from '@/view/components/ui/card/Card.vue';

const router = useRouter();

/**
 * O e-mail vem do cadastro/login por handoff em memória — NUNCA query param
 * (decisão do humano em 2026-10-08: nenhum dado do usuário visível na URL). A
 * confirmação NÃO deixa trocá-lo. Se a rota abriu SEM handoff (forçaram a URL
 * ou F5), o GUARD da rota devolve o usuário para o login — esta página nunca
 * é montada sem e-mail.
 */
const handoff = takeAuthHandoff();
const email = ref(handoff.confirmEmail ?? '');
/** true = o email de confirmação falhou ao enviar (mailDelivered:false). */
const mailFailed = ref(handoff.mailFailed === true);
const digits = reactive(['', '', '', '', '', '']);
const inputs = ref<(HTMLInputElement | null)[]>([]);
const error = ref('');
const submitting = ref(false);
const resending = ref(false);

const code = computed(() => digits.join(''));

function setInputRef(el: Element | null, i: number) {
  inputs.value[i] = el as HTMLInputElement | null;
}

function focusIndex(i: number) {
  const el = inputs.value[Math.min(Math.max(i, 0), 5)];
  el?.focus();
  el?.select();
}

function onInput(i: number, event: Event) {
  const target = event.target as HTMLInputElement;
  const raw = target.value.replace(/\D/g, '');
  error.value = '';
  if (raw.length > 1) {
    // colar o código inteiro em qualquer quadradinho
    const chars = raw.slice(0, 6 - i).split('');
    chars.forEach((c, k) => (digits[i + k] = c));
    focusIndex(i + chars.length);
    return;
  }
  digits[i] = raw;
  if (raw) focusIndex(i + 1);
}

function onKeydown(i: number, event: KeyboardEvent) {
  if (event.key === 'Backspace' && !digits[i] && i > 0) {
    event.preventDefault();
    digits[i - 1] = '';
    focusIndex(i - 1);
  } else if (event.key === 'ArrowLeft' && i > 0) {
    event.preventDefault();
    focusIndex(i - 1);
  } else if (event.key === 'ArrowRight' && i < 5) {
    event.preventDefault();
    focusIndex(i + 1);
  }
}

function onPaste(event: ClipboardEvent) {
  const text = event.clipboardData?.getData('text') ?? '';
  const raw = text.replace(/\D/g, '').slice(0, 6);
  if (raw.length > 0) {
    event.preventDefault();
    for (let i = 0; i < 6; i++) digits[i] = raw[i] ?? '';
    focusIndex(raw.length);
  }
}

async function verify() {
  error.value = '';
  if (!email.value) {
    error.value = 'Esta página chegou sem e-mail — refaça o cadastro.';
    return;
  }
  if (!/^\d{6}$/.test(code.value)) {
    error.value = 'Digite os 6 dígitos do código.';
    return;
  }
  submitting.value = true;
  try {
    await authApi.verifyCode({ email: email.value, code: code.value });
    setDraftSignup(null);
    toast.success('Conta criada e E-mail confirmado com sucesso! Realize o login para entrar na agenda.');
    for (let i = 0; i < 6; i++) digits[i] = '';
    focusIndex(0);
    setAuthHandoff({ loginEmail: email.value });
    router.push({ name: 'login' });
  } catch (err) {
    const ax = err as AxiosError<{ message?: string }>;
    error.value =
      ax.response?.status === 401
        ? 'Código inválido ou expirado. Confira o e-mail e tente de novo.'
        : (ax.response?.data?.message ?? 'Erro inesperado ao confirmar o código.');
  } finally {
    submitting.value = false;
  }
}

async function resend() {
  error.value = '';
  if (!email.value) {
    error.value = 'Esta página chegou sem e-mail — refaça o cadastro.';
    return;
  }
  resending.value = true;
  try {
    const result = (await authApi.resendCode({ email: email.value })) as {
      alreadyConfirmed?: boolean;
      reenviosRestantes?: number;
      mailDelivered?: boolean;
    };
    mailFailed.value = false;
    if (result.alreadyConfirmed) {
      toast.info('Este e-mail já está confirmado — pode fazer login.');
      setAuthHandoff({ loginEmail: email.value });
      await router.push({ name: 'login' });
      return;
    } else if (result.mailDelivered === false) {
      toast.warning(
        'O código foi gerado, mas não conseguimos enviar o e-mail agora. Tente reenviar em instantes.',
      );
    } else {
      const left = result.reenviosRestantes;
      toast.success(
        left === undefined
          ? 'Novo código enviado.'
          : `Novo código enviado. Reenvios restantes: ${left}.`,
      );
    }
  } catch (err) {
    const ax = err as AxiosError<{
      message?: string;
      retryAfterSeconds?: number | null;
      reenviosRestantes?: number;
    }>;
    if (ax.response?.status === 429) {
      const wait = ax.response.data?.retryAfterSeconds;
      error.value = wait
        ? `Limite de reenvios atingido. Tente novamente em ${Math.ceil(wait / 60)} min.`
        : 'Limite de reenvios atingido. Tente novamente mais tarde.';
    } else {
      error.value = ax.response?.data?.message ?? 'Erro inesperado ao reenviar o código.';
    }
  } finally {
    resending.value = false;
  }
}

async function focusFirst() {
  await nextTick();
  inputs.value[0]?.focus();
}
focusFirst();
</script>
