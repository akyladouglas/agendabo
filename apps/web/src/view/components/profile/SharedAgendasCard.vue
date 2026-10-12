<template>
  <AppCard
    class="flex flex-col gap-4"
    data-testid="profile-shared-agendas"
  >
    <div>
      <h2 class="text-sm font-semibold text-foreground">
        Agendas compartilhadas
      </h2>
      <p class="mt-1 text-xs text-muted-foreground">
        Quem vê a sua agenda (somente leitura) e as agendas que você vê.
      </p>
    </div>

    <!-- erro da LISTA (F.7): visível + recuperável -->
    <div
      v-if="sharedQuery.isError.value"
      class="flex items-center justify-between gap-3 rounded-md border border-danger/60 bg-danger/10 px-3 py-2"
      role="alert"
      data-testid="shared-error"
    >
      <p class="text-sm text-danger">
        Não foi possível carregar seus compartilhamentos.
      </p>
      <AppButton
        variant="outline"
        size="sm"
        class="min-h-11"
        :disabled="sharedQuery.isFetching.value"
        @click="sharedQuery.refetch()"
      >
        Tentar de novo
      </AppButton>
    </div>

    <!-- carregando (F.7) -->
    <div
      v-else-if="sharedQuery.isPending.value"
      class="flex flex-col gap-2"
      data-testid="shared-loading"
    >
      <AppSkeleton class="h-12" />
      <AppSkeleton class="h-12" />
    </div>

    <template v-else>
      <!-- convidar (A.2): e-mail do convidado → convite por e-mail. A resposta é
           202 uniforme SEMPRE (anti-enumeration): nenhum erro de "email não
           existe" aparece nunca — o toast da mutation é o texto neutro fixo. -->
      <form
        class="flex flex-wrap items-start gap-2"
        data-testid="shared-invite-form"
        @submit.prevent="sendInvite"
      >
        <AppField class="min-w-52 flex-1">
          <AppLabel for="shared-invite-email">
            Convidar por e-mail
          </AppLabel>
          <AppInput
            id="shared-invite-email"
            v-model="inviteEmail"
            type="email"
            autocomplete="email"
            placeholder="email-do-convite@exemplo.com"
          />
          <p
            v-if="inviteError"
            class="mt-1 text-xs text-danger"
            role="alert"
            data-testid="shared-invite-error"
          >
            {{ inviteError }}
          </p>
        </AppField>
        <AppButton
          type="submit"
          class="mt-6 min-h-11 shrink-0"
          :disabled="invite.isPending.value"
          data-testid="shared-invite-submit"
        >
          {{ invite.isPending.value ? 'Enviando…' : 'Convidar' }}
        </AppButton>
      </form>

      <!-- Que eu compartilho (enviados — A2: SEMPRE o email do convidado) -->
      <section data-testid="shared-sent">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Que eu compartilho
        </h3>
        <p
          v-if="sent.length === 0"
          class="mt-2 text-sm text-muted-foreground"
          data-testid="shared-sent-empty"
        >
          Você ainda não compartilhou sua agenda com ninguém.
        </p>
        <ul
          v-else
          class="mt-1 flex flex-col divide-y divide-border"
          data-testid="shared-sent-list"
        >
          <SharedAgendaRow
            v-for="item in sent"
            :key="item.id"
            :item="item"
            papel="owner"
            :timezone="timezone"
            :resend-busy="invite.isPending.value"
            @history="openHistory"
            @revoke="revoke.mutate($event.id)"
            @resend="invite.mutate({ email: $event.contraparte.email })"
          />
        </ul>
      </section>

      <!-- Compartilhadas comigo (recebidos — nome do dono; pendente com o texto
           "abra o link do e-mail"; ativo com Sair — D.21) -->
      <section data-testid="shared-received">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Compartilhadas comigo
        </h3>
        <p
          v-if="received.length === 0"
          class="mt-2 text-sm text-muted-foreground"
          data-testid="shared-received-empty"
        >
          Ninguém compartilhou agenda com você ainda.
        </p>
        <ul
          v-else
          class="mt-1 flex flex-col divide-y divide-border"
          data-testid="shared-received-list"
        >
          <SharedAgendaRow
            v-for="item in received"
            :key="item.id"
            :item="item"
            papel="guest"
            :timezone="timezone"
            @history="openHistory"
            @revoke="revoke.mutate($event.id)"
          />
        </ul>
      </section>
    </template>

    <!-- "Histórico" paginado por vínculo (F.4/F.7) -->
    <SharedAgendaAuditDialog
      v-model:open="historyOpen"
      :link="historyLink"
      :timezone="timezone"
    />
  </AppCard>
</template>

<script setup lang="ts">
/**
 * Card "Agendas compartilhadas" do /perfil (spec D.21, ao lado do SessionsCard):
 * lista os vínculos enviados ("Que eu compartilho" — A2: só o EMAIL do convidado,
 * nunca o nome) e recebidos ("Compartilhadas comigo" — nome do dono), com o
 * formulário de convite (202 uniforme, UI neutra de quota — sem contador) e as
 * ações por status (Revogar / Reenviar / Sair) + "Histórico" (auditoria F.4).
 * Componente magro de página: a exibição é do SharedAgendaRow burro e dos
 * utilitários puros (`sharedAgendas.ts`); os dados vêm das queries/mutations.
 */
import { computed, ref } from 'vue';
import { sharedInviteInputSchema, type SharedAgendaListItem } from '@agendabo/contracts';
import { useAuthStore } from '@/app/store/authStore';
import { useSharedAgendasQuery } from '@/app/composables/queries/useSharedAgendas.query';
import { useSharedInviteMutation } from '@/app/composables/mutations/useSharedInvite.mutation';
import { useSharedRevokeMutation } from '@/app/composables/mutations/useSharedRevoke.mutation';
import AppCard from '@/view/components/ui/card/Card.vue';
import AppButton from '@/view/components/ui/button/Button.vue';
import AppField from '@/view/components/ui/field/Field.vue';
import AppInput from '@/view/components/ui/input/Input.vue';
import AppLabel from '@/view/components/ui/label/Label.vue';
import AppSkeleton from '@/view/components/ui/skeleton/Skeleton.vue';
import SharedAgendaRow from './SharedAgendaRow.vue';
import SharedAgendaAuditDialog from './SharedAgendaAuditDialog.vue';

const auth = useAuthStore();
const timezone = computed(() => auth.user?.timezone ?? 'UTC');

const sharedQuery = useSharedAgendasQuery();
const invite = useSharedInviteMutation();
const revoke = useSharedRevokeMutation();

const sent = computed(() => sharedQuery.data.value?.sent ?? []);
const received = computed(() => sharedQuery.data.value?.received ?? []);

// ---- convite (A.2): zod dos contracts valida o e-mail ANTES de chamar a API ----
const inviteEmail = ref('');
const inviteError = ref<string | null>(null);

function sendInvite(): void {
  inviteError.value = null;
  const parsed = sharedInviteInputSchema.safeParse({ email: inviteEmail.value.trim() });
  if (!parsed.success) {
    inviteError.value = 'Informe um e-mail válido.';
    return;
  }
  invite.mutate(parsed.data, {
    onSuccess: () => {
      // estado neutro (F.1): mesmo caminho para qualquer e-mail — limpa o campo
      inviteEmail.value = '';
    },
  });
}

// ---- "Histórico" por vínculo (F.4) ----
const historyOpen = ref(false);
const historyLink = ref<SharedAgendaListItem | null>(null);

function openHistory(item: SharedAgendaListItem): void {
  historyLink.value = item;
  historyOpen.value = true;
}
</script>
