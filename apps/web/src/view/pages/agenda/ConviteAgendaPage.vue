<template>
  <AuthLayout>
    <!-- CARD ÚNICO (A.5/D.22): token ausente/ruim/expirado/para-outro-destinatário
         cai TODOS no mesmo texto, sem estado intermediário e sem distinguir
         sabores. Depois de um erro, os botões somem junto (o card é o estado). -->
    <div
      v-if="invalid"
      class="rounded-lg border border-danger/60 bg-danger/10 px-4 py-3 text-sm text-danger"
      role="alert"
      data-testid="invite-invalid"
    >
      Link de convite inválido ou expirado.
    </div>

    <!-- recusa confirmada: estado terminal (vínculo virou `revoked` — A.8) -->
    <p
      v-else-if="declined"
      class="text-sm text-muted-foreground"
      role="status"
      data-testid="invite-declined"
    >
      Convite recusado.
    </p>

    <template v-else>
      <div class="flex flex-col gap-3">
        <!-- Sem rota de preview no backend (decisão de execução D22-compatível,
             registrada no plano): revelar o dono a partir do token antes de
             autenticar o destino violaria A.7 — o card usa texto fixo genérico. -->
        <p
          class="text-sm text-muted-foreground"
          data-testid="invite-explain"
        >
          Você recebeu um convite para ver a agenda de alguém (somente leitura).
        </p>
        <div class="flex flex-col gap-2">
          <AppButton
            :disabled="busy"
            data-testid="invite-accept"
            @click="acceptInvite"
          >
            {{ accept.isPending.value ? 'Aceitando…' : 'Aceitar' }}
          </AppButton>
          <AppButton
            variant="outline"
            :disabled="busy"
            data-testid="invite-decline"
            @click="declineInvite"
          >
            {{ decline.isPending.value ? 'Recusando…' : 'Recusar' }}
          </AppButton>
        </div>
      </div>
    </template>

    <!-- pós-aceite: link para ver a agenda (decisão de execução D.22: o aceite
         responde 204 sem id — o usuário escolhe a fonte no seletor da Agenda) -->
    <RouterLink
      v-if="accepted"
      to="/agenda"
      class="text-sm font-medium text-primary hover:underline"
      data-testid="invite-go-agenda"
    >
      Ver agenda
    </RouterLink>
  </AuthLayout>
</template>

<script setup lang="ts">
/**
 * Tela de aceite do convite de compartilhamento (spec D.22, decisão D10 do plano):
 * rota `requireAuth` (sem handoff de sessão — quem chega deslogado passa pelo
 * login e volta; mesma política do /redefinir-senha). O `?token=` é a ÚNICA
 * exceção à política "nenhum dado do usuário em query" — token opaco de uso
 * único, TTL 24h, replicando o comentário da exceção do reset em router/index.ts.
 * O token vai SEMPRE no BODY do accept/decline (sharedInviteTokenSchema) e nunca
 * aparece em outro lugar (log/storage/URL nova).
 */
import { computed, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { useSharedAcceptMutation } from '@/app/composables/mutations/useSharedAccept.mutation';
import { useSharedDeclineMutation } from '@/app/composables/mutations/useSharedDecline.mutation';
import AuthLayout from '@/view/layouts/AuthLayout.vue';
import AppButton from '@/view/components/ui/button/Button.vue';

const route = useRoute();

/** Token cru da query (a tela não existe sem ele: card genérico direto). */
const token = typeof route.query.token === 'string' ? route.query.token : '';

const invalid = ref(token === '');
const accepted = ref(false);
const declined = ref(false);

const accept = useSharedAcceptMutation();
const decline = useSharedDeclineMutation();
const busy = computed(() => accept.isPending.value || decline.isPending.value);

/** 410 `shared_invite_invalid` ou QUALQUER falha ⇒ o MESMO card único (A.5). */
function showInvalidCard(): void {
  invalid.value = true;
  accepted.value = false;
  declined.value = false;
}

function acceptInvite(): void {
  accept.mutate(token, {
    onSuccess: () => {
      accepted.value = true;
    },
    onError: showInvalidCard,
  });
}

function declineInvite(): void {
  decline.mutate(token, {
    onSuccess: () => {
      declined.value = true;
    },
    onError: showInvalidCard,
  });
}
</script>
