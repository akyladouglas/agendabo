<template>
  <li
    class="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
    data-testid="shared-row"
  >
    <div class="min-w-0">
      <p
        class="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground"
        :class="item.status === 'revoked' ? 'text-muted-foreground' : ''"
      >
        {{ counterpartLabel }}
        <AppBadge
          :tone="item.status === 'active' ? 'success' : item.status === 'pending' ? 'warning' : 'info'"
          :class="item.status === 'revoked' ? 'opacity-70' : ''"
        >
          {{ statusLine }}
        </AppBadge>
      </p>
      <!-- convite pendente RECEBIDO (decisão de execução D.21, registrada no plano):
           o aceite só funciona com o token do e-mail (a API não tem rota de preview —
           revelar o dono por token sem autenticar o destino violaria A.7), então o
           card pendente NÃO tem botão "ver convite": só o texto explicativo. -->
      <p
        v-if="showPendingNote"
        class="mt-0.5 text-xs text-muted-foreground"
        data-testid="shared-pending-note"
      >
        Abra o link do e-mail para responder
      </p>
    </div>

    <div class="flex shrink-0 flex-wrap items-center gap-2">
      <AppButton
        variant="outline"
        size="sm"
        class="min-h-11"
        :data-testid="`shared-audit-${item.id}`"
        @click="emit('history', item)"
      >
        Histórico
      </AppButton>
      <!-- enviados: Revogar (dono cancela pending/ativo) · Reenviar (pendente,
           UI neutra de quota — D.21) -->
      <AppButton
        v-if="papel === 'owner' && item.status !== 'revoked'"
        variant="outline"
        size="sm"
        class="min-h-11"
        :data-testid="`shared-revoke-${item.id}`"
        @click="emit('revoke', item)"
      >
        Revogar
      </AppButton>
      <AppButton
        v-if="papel === 'owner' && item.status === 'pending'"
        variant="outline"
        size="sm"
        class="min-h-11"
        :disabled="resendBusy"
        :data-testid="`shared-resend-${item.id}`"
        @click="emit('resend', item)"
      >
        Reenviar convite
      </AppButton>
      <!-- recebidos ativos: Sair (mesmo endpoint do revoke, papel decide — A.9) -->
      <AppButton
        v-if="papel === 'guest' && item.status === 'active'"
        variant="outline"
        size="sm"
        class="min-h-11"
        :data-testid="`shared-exit-${item.id}`"
        @click="emit('revoke', item)"
      >
        Sair
      </AppButton>
    </div>
  </li>
</template>

<script setup lang="ts">
/**
 * Linha de um vínculo compartilhado (spec D.21). Burra: o card pai decide o que
 * cada botão faz e traz a identificação da contraparte JÁ RESOLVIDA pela regra
 * A2 (`counterpartLabel`: enviado ⇒ SEMPRE o email; recebido ⇒ o nome) — a UI
 * não tem como vazar o nome de um convidado pendente. Revogado é discreto
 * (texto esmaecido, sem botão de ação). Alvos ≥44px (F.7).
 */
import { computed } from 'vue';
import type { SharedAgendaListItem } from '@agendabo/contracts';
import { sharedCounterpartLabel, sharedStatusLine } from '@/app/utils/sharedAgendas';
import AppButton from '@/view/components/ui/button/Button.vue';
import AppBadge from '@/view/components/ui/badge/Badge.vue';

const props = defineProps<{
  item: SharedAgendaListItem;
  /** 'owner' = lista "Que eu compartilho"; 'guest' = "Compartilhadas comigo". */
  papel: 'owner' | 'guest';
  /** Fuso do visualizador (o "expira ‹data/hora›" do pendente). */
  timezone: string;
  /** Botão "Reenviar" em voo (a mutation do pai está pendente). */
  resendBusy?: boolean;
}>();

const emit = defineEmits<{
  history: [item: SharedAgendaListItem];
  revoke: [item: SharedAgendaListItem];
  resend: [item: SharedAgendaListItem];
}>();

const counterpartLabel = computed(() => sharedCounterpartLabel(props.item));
const statusLine = computed(() => sharedStatusLine(props.item, props.timezone));
const showPendingNote = computed(
  () => props.papel === 'guest' && props.item.status === 'pending',
);
</script>
