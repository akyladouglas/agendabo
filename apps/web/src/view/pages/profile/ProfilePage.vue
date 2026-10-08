<template>
  <AppLayout>
    <div class="mx-auto flex w-full max-w-xl flex-col gap-4">
      <h1 class="title-page">
        Perfil
      </h1>
      <p
        class="text-sm text-muted-foreground"
        data-testid="profile-email"
      >
        Conectado com <strong class="text-foreground">{{ user?.email }}</strong>
      </p>

      <form
        class="flex flex-col gap-5"
        @submit.prevent="save"
      >
        <AppCard class="flex flex-col gap-5">
          <AppField>
            <AppLabel for="profile-name">
              Nome
            </AppLabel>
            <AppInput
              id="profile-name"
              v-model="form.name"
              type="text"
              maxlength="80"
              autocomplete="name"
              placeholder="Como o bot deve te chamar"
            />
          </AppField>

          <AppField>
            <AppLabel for="profile-tz">
              Fuso horário
            </AppLabel>
            <AppSelect
              id="profile-tz"
              v-model="form.timezone"
              :options="tzOptions"
              placeholder="Selecione o fuso"
            />
          </AppField>

          <div class="flex items-center justify-between gap-3">
            <div>
              <AppLabel for="profile-resumo">
                Resumo diário no Telegram
              </AppLabel>
              <p class="mt-1 text-xs text-muted-foreground">
                {{ form.resumoDiarioAtivo
                  ? 'Você recebe o resumo do dia todos os dias.'
                  : 'Nenhum resumo será agendado.' }}
              </p>
            </div>
            <AppSwitch
              id="profile-resumo"
              v-model="form.resumoDiarioAtivo"
              aria-label="Ligar ou desligar o resumo diário"
            />
          </div>

          <!-- hora SÓ aparece com o resumo ligado (protótipo) -->
          <AppField v-if="form.resumoDiarioAtivo">
            <AppLabel for="profile-hour">
              Hora do resumo
            </AppLabel>
            <AppSelect
              id="profile-hour"
              v-model="form.resumoDiarioHora"
              :options="hourOptions"
            />
          </AppField>

          <p
            v-if="serverError"
            class="rounded-md border border-danger/60 bg-danger/10 px-3 py-2 text-sm text-danger"
            role="alert"
          >
            {{ serverError }}
          </p>

          <AppButton
            type="submit"
            :disabled="saving || !dirty"
          >
            {{ saving ? 'Salvando…' : 'Salvar alterações' }}
          </AppButton>
        </AppCard>
      </form>

      <AppCard class="flex items-center justify-between gap-3">
        <div>
          <h2 class="text-sm font-semibold text-foreground">
            Aparência
          </h2>
          <p class="mt-1 text-xs text-muted-foreground">
            Tema {{ theme.theme === 'dark' ? 'escuro' : 'claro' }} — sua escolha
            fica neste navegador.
          </p>
        </div>
        <AppButton
          variant="outline"
          data-testid="profile-theme-toggle"
          @click="theme.toggle()"
        >
          <Sun
            v-if="theme.theme === 'dark'"
            class="h-4 w-4"
            aria-hidden="true"
          />
          <Moon
            v-else
            class="h-4 w-4"
            aria-hidden="true"
          />
          {{ theme.theme === 'dark' ? 'Tema claro' : 'Tema escuro' }}
        </AppButton>
      </AppCard>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
/**
 * Perfil (Fase 5, spec A.8): "Conectado com …", Nome, fuso IANA, resumo diário
 * (switch + hora SÓ com o resumo ligado). Salvar = `updateProfile` (composable),
 * que valida a resposta com zod dos contracts e atualiza o authStore na hora.
 * Nenhum zod duplicado aqui; a API ainda revalida o fuso (nome IANA real → 409).
 */
import { computed, reactive, ref } from 'vue';
import { Moon, Sun } from 'lucide-vue-next';
import { toast } from 'vue-sonner';
import { AxiosError } from 'axios';
import type { UpdateProfileInput } from '@agendabo/contracts';
import { useAuthStore } from '@/app/store/authStore';
import { updateProfile } from '@/app/composables/useUpdateProfile.composable';
import { useThemeStore } from '@/app/store/themeStore';
import AppLayout from '@/view/layouts/AppLayout.vue';
import AppCard from '@/view/components/ui/card/Card.vue';
import AppButton from '@/view/components/ui/button/Button.vue';
import AppField from '@/view/components/ui/field/Field.vue';
import AppInput from '@/view/components/ui/input/Input.vue';
import AppLabel from '@/view/components/ui/label/Label.vue';
import AppSelect from '@/view/components/ui/select/Select.vue';
import AppSwitch from '@/view/components/ui/switch/Switch.vue';

const auth = useAuthStore();
const theme = useThemeStore();

/** Fusos comuns PT-BR + UTC (spec: "lista de IANA comuns"; a API é o gate final). */
const TIMEZONES = [
  'America/Sao_Paulo',
  'America/Manaus',
  'America/Cuiaba',
  'America/Fortaleza',
  'America/Belem',
  'America/Porto_Velho',
  'America/Boa_Vista',
  'America/Rio_Branco',
  'America/Argentina/Buenos_Aires',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/Lisbon',
  'Europe/Madrid',
  'UTC',
] as const;

const tzOptions = TIMEZONES.map((value) => ({
  value,
  label: value.replaceAll('_', ' '),
}));

const hourOptions = Array.from({ length: 24 }, (_, h) => {
  const value = `${String(h).padStart(2, '0')}:00`;
  return { value, label: value };
});

const user = computed(() => auth.user);

const form = reactive({
  name: user.value?.name ?? '',
  timezone: user.value?.timezone ?? 'America/Sao_Paulo',
  resumoDiarioAtivo: user.value?.resumoDiarioAtivo ?? true,
  resumoDiarioHora: user.value?.resumoDiarioHora ?? '08:00',
});

const saving = ref(false);
const serverError = ref<string | null>(null);

const dirty = computed(() => {
  const u = user.value;
  if (!u) return false;
  return (
    form.name.trim() !== (u.name ?? '') ||
    form.timezone !== u.timezone ||
    form.resumoDiarioAtivo !== u.resumoDiarioAtivo ||
    (form.resumoDiarioAtivo && form.resumoDiarioHora !== u.resumoDiarioHora)
  );
});

async function save(): Promise<void> {
  serverError.value = null;
  const patch: UpdateProfileInput = {
    name: form.name.trim() || undefined,
    timezone: form.timezone,
    resumoDiarioAtivo: form.resumoDiarioAtivo,
    ...(form.resumoDiarioAtivo ? { resumoDiarioHora: form.resumoDiarioHora } : {}),
  };
  saving.value = true;
  try {
    await updateProfile(patch);
    toast.success('Perfil atualizado.');
  } catch (err) {
    const ax = err as AxiosError<{ message?: string }>;
    if (ax.response?.status === 409) {
      serverError.value = 'Fuso horário inválido — escolha um fuso da lista.';
    } else {
      serverError.value = ax.response?.data?.message ?? 'Erro ao salvar, tente de novo.';
    }
  } finally {
    saving.value = false;
  }
}
</script>
