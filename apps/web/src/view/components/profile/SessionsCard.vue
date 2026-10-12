<template>
  <AppCard
    class="flex flex-col gap-4"
    data-testid="profile-sessions"
  >
    <div class="flex items-center justify-between gap-3">
      <div>
        <h2 class="text-sm font-semibold text-foreground">
          Suas sessões ativas
        </h2>
        <p class="mt-1 text-xs text-muted-foreground">
          Dispositivos conectados à sua conta. Horários em UTC.
        </p>
      </div>
      <AppButton
        variant="outline"
        size="sm"
        data-testid="sessions-revoke-others"
        :disabled="!hasOthers || revokeMutation.isPending.value"
        @click="revokeMutation.mutate()"
      >
        {{ revokeMutation.isPending.value ? 'Encerrando…' : 'Encerrar todas as outras' }}
      </AppButton>
    </div>

    <!-- erro -->
    <div
      v-if="sessionsQuery.isError.value"
      class="flex items-center justify-between gap-3 rounded-md border border-danger/60 bg-danger/10 px-3 py-2"
      role="alert"
    >
      <p class="text-sm text-danger">
        Não foi possível carregar suas sessões.
      </p>
      <AppButton
        variant="outline"
        size="sm"
        :disabled="sessionsQuery.isRefetching.value"
        @click="sessionsQuery.refetch()"
      >
        Tentar de novo
      </AppButton>
    </div>

    <!-- skeleton -->
    <div
      v-else-if="sessionsQuery.isPending.value"
      class="flex flex-col gap-2"
    >
      <AppSkeleton class="h-12" />
      <AppSkeleton class="h-12" />
      <AppSkeleton class="h-12" />
    </div>

    <!-- vazio -->
    <p
      v-else-if="items.length === 0"
      class="text-sm text-muted-foreground"
      data-testid="sessions-empty"
    >
      Nenhuma sessão ativa.
    </p>

    <!-- lista -->
    <ul
      v-else
      class="flex flex-col divide-y divide-border"
      data-testid="sessions-list"
    >
      <li
        v-for="item in items"
        :key="item.id"
        class="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
        data-testid="session-row"
      >
        <div class="min-w-0">
          <p class="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
            {{ deviceLabel(item.userAgent) }}
            <AppBadge
              v-if="item.current"
              tone="success"
              data-testid="session-current"
            >
              Este dispositivo
            </AppBadge>
          </p>
          <p class="mt-0.5 text-xs text-muted-foreground">
            <span v-if="item.ip">{{ item.ip }} · </span>desde
            {{ formatSessionDate(item.loginAt) }} UTC
          </p>
        </div>
      </li>
    </ul>
  </AppCard>
</template>

<script setup lang="ts">
/**
 * Card "Suas sessões ativas" (spec sessao-24h "Web"): lista GET /auth/sessions
 * com label de dispositivo, IP e login (UTC); "Encerrar todas as outras" roda o
 * DELETE e a query revalida sozinha (invalidate no onSuccess da mutation).
 * Componente magro de página: a regra de exibição mora em utils/deviceLabel (pura).
 */
import { computed } from 'vue';
import { useSessionsQuery } from '@/app/composables/queries/useSessions.query';
import { useRevokeOtherSessionsMutation } from '@/app/composables/mutations/useRevokeOtherSessions.mutation';
import { deviceLabel, formatSessionDate } from '@/app/utils/deviceLabel';
import AppCard from '@/view/components/ui/card/Card.vue';
import AppButton from '@/view/components/ui/button/Button.vue';
import AppBadge from '@/view/components/ui/badge/Badge.vue';
import AppSkeleton from '@/view/components/ui/skeleton/Skeleton.vue';

const sessionsQuery = useSessionsQuery();
const revokeMutation = useRevokeOtherSessionsMutation();

const items = computed(() => sessionsQuery.data.value?.items ?? []);
const hasOthers = computed(() => items.value.some((s) => !s.current));
</script>
