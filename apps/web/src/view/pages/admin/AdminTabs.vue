<template>
  <!-- eslint-disable vue/no-mutating-props -- o objeto `vm` É o estado vivo
       da página (Refs/mutations do composable), não um dado por valor: a UI
       escreve filtros/página/aba por contrato — ver comentário no script. -->
  <AppTabs
    :model-value="vm.effectiveTab.value"
    aria-label="Seções da observabilidade"
    :options="tabOptions"
    class="max-w-full overflow-x-auto"
    @update:model-value="vm.tab.value = $event as AdminTab"
  />

  <!-- ============================== EVENTOS ============================== -->
  <template v-if="vm.effectiveTab.value === 'eventos'">
    <p class="text-sm text-muted-foreground">
      {{ vm.isAdmin.value
        ? 'Interações do bot registradas para auditoria (nunca contêm falas do usuário).'
        : 'Suas interações com o bot, liberadas pelo administrador para você acompanhar.' }}
    </p>

    <!-- filtros (admin: usuário + tipo + período; rollout: tipo + período) -->
    <div class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
      <AppField v-if="vm.showUserFilter.value">
        <AppLabel for="admin-user-filter">
          Usuário
        </AppLabel>
        <AppSelect
          id="admin-user-filter"
          v-model="vm.filters.userId"
          :options="vm.userFilterOptions.value"
          test-id="admin-user-filter"
        />
      </AppField>
      <AppField>
        <AppLabel for="admin-type-filter">
          Tipo de evento
        </AppLabel>
        <AppSelect
          id="admin-type-filter"
          v-model="vm.filters.type"
          :options="vm.typeOptions"
          test-id="admin-type-filter"
        />
      </AppField>
      <AppField>
        <AppLabel for="admin-from">
          De
        </AppLabel>
        <AppInput
          id="admin-from"
          v-model="vm.filters.from"
          type="date"
        />
      </AppField>
      <AppField>
        <AppLabel for="admin-to">
          Até
        </AppLabel>
        <AppInput
          id="admin-to"
          v-model="vm.filters.to"
          type="date"
        />
      </AppField>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <AppButton
        variant="soft"
        size="sm"
        @click="vm.applyPreset(7)"
      >
        7 dias
      </AppButton>
      <AppButton
        variant="soft"
        size="sm"
        @click="vm.applyPreset(30)"
      >
        30 dias
      </AppButton>
      <AppButton
        variant="soft"
        size="sm"
        @click="vm.applyPreset(90)"
      >
        90 dias
      </AppButton>
      <AppButton
        variant="ghost"
        size="sm"
        @click="vm.clearDates()"
      >
        Limpar datas
      </AppButton>
      <span
        class="ml-auto text-xs text-muted-foreground"
        data-testid="events-total"
      >
        {{ vm.total.value }} evento{{ vm.total.value === 1 ? '' : 's' }}
      </span>
    </div>

    <!-- erro -->
    <div
      v-if="vm.eventsQuery.isError.value"
      class="flex flex-col items-start gap-3 rounded-lg border border-danger/60 bg-danger/10 p-4"
      role="alert"
    >
      <p class="text-sm text-danger">
        Não foi possível carregar os eventos.
      </p>
      <AppButton
        variant="outline"
        size="sm"
        @click="vm.eventsQuery.refetch()"
      >
        Tentar de novo
      </AppButton>
    </div>

    <!-- skeleton -->
    <div
      v-else-if="vm.eventsQuery.isPending.value"
      class="flex flex-col gap-3"
    >
      <AppSkeleton class="h-24" />
      <AppSkeleton class="h-24" />
      <AppSkeleton class="h-24" />
    </div>

    <!-- vazio -->
    <div
      v-else-if="events.length === 0"
      class="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-14 text-center"
      data-testid="events-empty"
    >
      <Activity
        class="h-9 w-9 text-primary"
        aria-hidden="true"
      />
      <p class="text-sm font-medium text-foreground">
        Nenhum evento neste recorte
      </p>
      <p class="text-xs text-muted-foreground">
        Ajuste os filtros — ou converse com o bot e volte aqui.
      </p>
    </div>

    <!-- lista -->
    <template v-else>
      <ul class="flex flex-col gap-2">
        <li
          v-for="ev in events"
          :key="ev.id"
          class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-card px-4 py-3"
        >
          <AppBadge :tone="outcomeTone(ev.outcome)">
            {{ ev.type }}
          </AppBadge>
          <span
            v-if="ev.stage"
            class="font-mono text-xs text-muted-foreground"
          >{{ ev.stage }}</span>
          <span class="text-xs text-muted-foreground">
            {{ when(ev.createdAt) }}
          </span>
          <span
            v-if="vm.isAdmin.value && ev.userId"
            class="text-xs text-muted-foreground"
            data-testid="event-user"
          >
            {{ vm.userLabel(ev.userId) }}
          </span>
          <EventMetadata
            v-if="ev.metadata !== null && ev.metadata !== undefined"
            :metadata="ev.metadata"
          />
        </li>
      </ul>
      <EventsPager
        :page="vm.page.value"
        :total-pages="vm.totalPages.value"
        @update:page="vm.page.value = $event"
      />
    </template>
  </template>

  <!-- ================================ CUSTO ================================ -->
  <template v-else-if="vm.effectiveTab.value === 'custo'">
    <p class="text-sm text-muted-foreground">
      Estimativa de custo do LLM (preço × tokens; ADR-0017). Visível só para
      administradores. Sem período definido, os últimos 90 dias.
    </p>
    <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
      <AppField>
        <AppLabel for="cost-group">
          Agrupar por
        </AppLabel>
        <AppSelect
          id="cost-group"
          v-model="vm.cost.groupBy"
          :options="[
            { value: 'purpose', label: 'Finalidade' },
            { value: 'user', label: 'Usuário' },
          ]"
        />
      </AppField>
      <AppField>
        <AppLabel for="cost-from">
          De
        </AppLabel>
        <AppInput
          id="cost-from"
          v-model="vm.cost.from"
          type="date"
        />
      </AppField>
      <AppField>
        <AppLabel for="cost-to">
          Até
        </AppLabel>
        <AppInput
          id="cost-to"
          v-model="vm.cost.to"
          type="date"
        />
      </AppField>
    </div>

    <div
      v-if="vm.usageQuery.isError.value"
      class="flex flex-col items-start gap-3 rounded-lg border border-danger/60 bg-danger/10 p-4"
      role="alert"
    >
      <p class="text-sm text-danger">
        Não foi possível carregar o custo.
      </p>
      <AppButton
        variant="outline"
        size="sm"
        @click="vm.usageQuery.refetch()"
      >
        Tentar de novo
      </AppButton>
    </div>

    <AppSkeleton
      v-else-if="vm.usageQuery.isPending.value"
      class="h-48"
    />

    <div
      v-else-if="buckets.length === 0"
      class="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-14 text-center"
      data-testid="cost-empty"
    >
      <p class="text-sm font-medium text-foreground">
        Sem chamadas de LLM neste período
      </p>
    </div>

    <template v-else>
      <AppCard class="flex flex-col gap-1 !p-4">
        <p
          class="text-sm font-semibold text-foreground"
          data-testid="cost-total"
        >
          Total: {{ formatUsd(totalCostMicros) }}
          <span class="font-normal text-muted-foreground">
            · {{ totalCalls }} chamada{{ totalCalls === 1 ? '' : 's' }}
          </span>
        </p>
      </AppCard>
      <div class="overflow-x-auto rounded-lg border border-border">
        <table class="w-full text-sm">
          <caption class="sr-only">
            Custo de LLM por {{ vm.cost.groupBy === 'user' ? 'usuário' : 'finalidade' }}
          </caption>
          <thead>
            <tr class="border-b border-border text-left text-xs text-muted-foreground">
              <th class="px-4 py-2 font-medium">
                {{ vm.cost.groupBy === 'user' ? 'Usuário' : 'Finalidade' }}
              </th>
              <th class="px-4 py-2 text-right font-medium">
                Chamadas
              </th>
              <th class="px-4 py-2 text-right font-medium">
                Tokens (ent/saída)
              </th>
              <th class="px-4 py-2 text-right font-medium">
                Custo estimado
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="b in buckets"
              :key="b.key"
              class="border-b border-border/60 last:border-0"
            >
              <td class="px-4 py-2">
                {{ vm.cost.groupBy === 'user' ? vm.userLabel(b.key) : b.key }}
                <span
                  v-if="b.callsWithoutUsage > 0"
                  class="ml-2 text-xs text-warning"
                  :title="`${b.callsWithoutUsage} chamada(s) sem tokens reportados — custo parcial`"
                >
                  ({{ b.callsWithoutUsage }} sem usage)
                </span>
              </td>
              <td class="px-4 py-2 text-right tabular-nums">
                {{ b.calls }}
              </td>
              <td class="px-4 py-2 text-right tabular-nums">
                {{ b.inputTokens }} / {{ b.outputTokens }}
              </td>
              <td class="px-4 py-2 text-right font-medium tabular-nums">
                {{ formatUsd(b.costUsdMicros) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </template>

  <!-- =============================== USUÁRIOS ============================== -->
  <template v-else>
    <p class="text-sm text-muted-foreground">
      O rollout libera ao usuário comum ver os próprios eventos do bot
      nesta página. O custo de LLM nunca é liberado (decisão do produto).
    </p>

    <div
      v-if="vm.usersQuery.isError.value"
      class="flex flex-col items-start gap-3 rounded-lg border border-danger/60 bg-danger/10 p-4"
      role="alert"
    >
      <p class="text-sm text-danger">
        Não foi possível carregar os usuários.
      </p>
      <AppButton
        variant="outline"
        size="sm"
        @click="vm.usersQuery.refetch()"
      >
        Tentar de novo
      </AppButton>
    </div>

    <div
      v-else-if="vm.usersQuery.isPending.value"
      class="flex flex-col gap-3"
    >
      <AppSkeleton class="h-16" />
      <AppSkeleton class="h-16" />
    </div>

    <ul
      v-else
      class="flex flex-col gap-2"
    >
      <li
        v-for="u in users"
        :key="u.id"
        class="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
      >
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-foreground">
            {{ u.name?.trim() || u.email }}
          </p>
          <p class="truncate text-xs text-muted-foreground">
            {{ u.email }}
          </p>
        </div>
        <AppBadge
          v-if="u.isAdmin"
          tone="info"
        >
          admin
        </AppBadge>
        <AppSwitch
          :model-value="u.observabilidadeEventosAtivo"
          :disabled="vm.rolloutMutation.isPending.value"
          :aria-label="`Ligar ou desligar o rollout de ${u.name || u.email}`"
          @update:model-value="vm.rolloutMutation.mutate({ id: u.id, ativo: Boolean($event) })"
        />
      </li>
    </ul>
  </template>
</template>

<script setup lang="ts">
/**
 * As três abas da página Admin (eventos / custo / usuários). Recebe o ESTADO
 * vivo do composable (`useAdminPage`) como objeto — filtros, data e página
 * são escritos via v-model/ação diretamente nele; espalhar em props primitivas
 * quebraria o reuso do composable. O controle de acesso é do server; aqui só
 * se decide o que renderizar.
 */
import { computed } from 'vue';
import { Activity } from 'lucide-vue-next';
import type { BotEventOutcomeValue } from '@agendabo/contracts';
import type { AdminTab, useAdminPage } from '@/app/composables/useAdminPage.composable';
import { formatUsd } from '@/app/utils/money';
import { formatDateTimeInTz } from '@/app/utils/tz';
import AppBadge from '@/view/components/ui/badge/Badge.vue';
import AppButton from '@/view/components/ui/button/Button.vue';
import AppCard from '@/view/components/ui/card/Card.vue';
import AppField from '@/view/components/ui/field/Field.vue';
import AppInput from '@/view/components/ui/input/Input.vue';
import AppLabel from '@/view/components/ui/label/Label.vue';
import AppSelect from '@/view/components/ui/select/Select.vue';
import AppSkeleton from '@/view/components/ui/skeleton/Skeleton.vue';
import AppSwitch from '@/view/components/ui/switch/Switch.vue';
import AppTabs from '@/view/components/ui/tabs/Tabs.vue';
import EventMetadata from './EventMetadata.vue';
import EventsPager from './EventsPager.vue';

const props = defineProps<{ vm: ReturnType<typeof useAdminPage> }>();

// o template usa `vm` cru (proxy reactivo das props). A regra de "mutating
// props" existe para primitivos passados por valor; aqui o objeto É o estado
// da página (Refs/mutations) — escrevê-lo pela UI é o contrato da view
// (desativada no topo do template).

const tabOptions = computed(() =>
  props.vm.isAdmin.value
    ? [
        { value: 'eventos', label: 'Eventos do bot' },
        { value: 'custo', label: 'Custo do LLM' },
        { value: 'usuarios', label: 'Usuários' },
      ]
    : [{ value: 'eventos', label: 'Meus eventos' }],
);

const events = computed(() => props.vm.eventsQuery.data.value?.items ?? []);
const buckets = computed(() => props.vm.usageQuery.data.value?.buckets ?? []);
const users = computed(() => props.vm.usersQuery.data.value?.items ?? []);
const totalCostMicros = computed(() =>
  buckets.value.reduce((sum, b) => sum + b.costUsdMicros, 0),
);
const totalCalls = computed(() => buckets.value.reduce((sum, b) => sum + b.calls, 0));

function when(d: Date): string {
  return formatDateTimeInTz(d, props.vm.timezone.value);
}

function outcomeTone(outcome: BotEventOutcomeValue): 'success' | 'warning' | 'danger' | 'muted' {
  if (outcome === 'ok') return 'success';
  if (outcome === 'error' || outcome === 'parse_fail') return 'danger';
  if (outcome === 'conflict' || outcome === 'needs_review' || outcome === 'low_confidence') {
    return 'warning';
  }
  return 'muted';
}
</script>
