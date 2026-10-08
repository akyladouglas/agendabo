<template>
  <AppLayout>
    <div class="flex flex-col gap-4">
      <!-- cabeçalho: título + novo -->
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h1 class="title-page">
          Agenda
        </h1>
        <AppButton @click="openForm">
          <Plus
            class="h-4 w-4"
            aria-hidden="true"
          />
          Novo
        </AppButton>
      </div>

      <!-- navegação: abas + ← hoje → (B.13: <md abre no Dia) -->
      <div
        class="flex flex-wrap items-center justify-between gap-3"
        data-testid="agenda-nav"
      >
        <AppTabs
          v-model="view"
          aria-label="Visualização da agenda"
          :options="[
            { value: 'day', label: 'Dia' },
            { value: 'week', label: 'Semana' },
          ]"
          class="max-w-full overflow-x-auto"
        />
        <div class="flex items-center gap-1">
          <AppButton
            variant="ghost"
            size="icon"
            aria-label="Período anterior"
            @click="shift(-1)"
          >
            <ChevronLeft class="h-5 w-5" />
          </AppButton>
          <AppButton
            variant="ghost"
            class="px-3"
            @click="goToday"
          >
            Hoje
          </AppButton>
          <AppButton
            variant="ghost"
            size="icon"
            aria-label="Próximo período"
            @click="shift(1)"
          >
            <ChevronRight class="h-5 w-5" />
          </AppButton>
        </div>
      </div>

      <!-- período atual -->
      <p
        class="text-sm font-medium text-muted-foreground"
        data-testid="agenda-heading"
      >
        <template v-if="view === 'day' && heading">
          {{ heading.isToday ? 'Hoje' : heading.weekday }} — {{ heading.label }}
        </template>
        <template v-else>
          {{ weekHeading }}
        </template>
      </p>

      <!-- erro -->
      <div
        v-if="appointmentsQuery.isError.value"
        class="flex flex-col items-start gap-3 rounded-lg border border-danger/60 bg-danger/10 p-4"
        role="alert"
      >
        <p class="text-sm text-danger">
          Não foi possível carregar sua agenda.
        </p>
        <AppButton
          variant="outline"
          size="sm"
          @click="appointmentsQuery.refetch()"
        >
          Tentar de novo
        </AppButton>
      </div>

      <!-- skeleton -->
      <div
        v-else-if="appointmentsQuery.isPending.value"
        class="flex flex-col gap-2"
      >
        <AppSkeleton class="h-16" />
        <AppSkeleton class="h-16" />
        <AppSkeleton class="h-16" />
      </div>

      <!-- vazio -->
      <div
        v-else-if="isEmpty"
        class="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-12 text-center"
      >
        <Inbox
          class="h-8 w-8 text-muted-foreground"
          aria-hidden="true"
        />
        <p class="text-sm text-muted-foreground">
          {{ view === 'day' ? 'Nada neste dia.' : 'Nada nesta semana.' }}
        </p>
      </div>

      <!-- lista do dia (empilhada) -->
      <ul
        v-else-if="view === 'day'"
        class="flex flex-col gap-2"
      >
        <li
          v-for="item in items"
          :key="item.id"
        >
          <button
            type="button"
            class="od-move flex w-full min-h-11 items-stretch gap-3 rounded-lg border border-border bg-card p-3 text-left hover:border-primary/50"
            :class="isPast(item) ? 'opacity-60' : ''"
            @click="openDetails(item)"
          >
            <span
              class="w-0.5 shrink-0 rounded-full"
              :class="item.status === 'needs_review' ? 'bg-warning' : 'bg-primary/60'"
              aria-hidden="true"
            />
            <span class="w-14 shrink-0 pt-0.5 text-sm font-semibold tabular-nums text-muted-foreground">
              {{ formatRange(item).split('–')[0] }}
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium text-foreground">
                {{ item.title }}
              </span>
              <span class="mt-1 flex flex-wrap items-center gap-1.5">
                <AppBadge
                  v-if="item.status === 'needs_review'"
                  tone="warning"
                >
                  pendente de revisão
                </AppBadge>
                <AppBadge :tone="item.origin === 'bot' ? 'info' : 'success'">
                  via {{ item.origin }}
                </AppBadge>
                <span class="text-xs text-muted-foreground">{{ formatRange(item) }}</span>
              </span>
            </span>
          </button>
        </li>
      </ul>

      <!-- semana: colunas com scroll CONTIDO na grade (B.13) -->
      <div
        v-else
        class="-mx-1 overflow-x-auto px-1 pb-1"
      >
        <div class="grid grid-flow-col grid-cols-[repeat(7,minmax(96px,1fr))] gap-2">
          <section
            v-for="day in weekDays"
            :key="day.key"
            class="flex min-w-[96px] flex-col gap-2"
            :aria-label="`${day.heading.weekday} ${day.heading.label}`"
          >
            <h3
              class="text-center text-xs font-semibold"
              :class="day.heading.isToday ? 'text-primary' : 'text-muted-foreground'"
            >
              {{ day.heading.isToday ? 'Hoje' : day.heading.weekday }}
              <span class="block text-sm text-foreground">{{ day.heading.label }}</span>
            </h3>
            <button
              v-for="item in day.items"
              :key="item.id"
              type="button"
              class="od-move flex min-h-11 w-full flex-col gap-1 rounded-md border border-border bg-card p-2 text-left hover:border-primary/50"
              :class="[
                item.status === 'needs_review' ? 'border-l-2 border-l-warning' : '',
                isPast(item) ? 'opacity-60' : '',
              ]"
              @click="openDetails(item)"
            >
              <span class="text-xs font-semibold tabular-nums text-muted-foreground">
                {{ formatRange(item).split('–')[0] }}
              </span>
              <span class="line-clamp-2 text-xs font-medium text-foreground">
                {{ item.title }}
              </span>
              <span class="flex items-center gap-1">
                <CalendarDays
                  v-if="item.status === 'needs_review'"
                  class="h-3 w-3 text-warning"
                  aria-label="conferindo"
                />
                <AppBadge
                  :tone="item.origin === 'bot' ? 'info' : 'success'"
                  class="h-5 px-1.5 text-[10px]"
                >
                  {{ item.origin }}
                </AppBadge>
              </span>
            </button>
            <p
              v-if="day.items.length === 0"
              class="py-2 text-center text-xs text-muted-foreground"
            >
              —
            </p>
          </section>
        </div>
      </div>
    </div>

    <!-- modal único criar/editar (D4) -->
    <AppointmentModal
      v-if="formOpen"
      v-model:open="formOpen"
      :mode="formMode"
      :appointment="editing"
      @saved="appointmentsQuery.refetch()"
    />

    <!-- detalhes + excluir em 2 passos (A.6/A.7) -->
    <AppDialog
      :open="detailsItem !== null"
      :title="confirmDelete ? 'Excluir compromisso?' : (detailsItem?.title ?? '')"
      @update:open="detailsItem = $event ? detailsItem : null"
    >
      <template v-if="detailsItem && !confirmDelete">
        <dl class="flex flex-col gap-3 text-sm">
          <div>
            <dt class="text-muted-foreground">
              Quando
            </dt>
            <dd class="font-medium text-foreground">
              {{ formatRange(detailsItem) }}
            </dd>
          </div>
          <div v-if="detailsItem.notes">
            <dt class="text-muted-foreground">
              Notas
            </dt>
            <dd class="text-foreground">
              {{ detailsItem.notes }}
            </dd>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <AppBadge
              v-if="detailsItem.status === 'needs_review'"
              tone="warning"
            >
              pendente de revisão
            </AppBadge>
            <AppBadge :tone="detailsItem.origin === 'bot' ? 'info' : 'success'">
              via {{ detailsItem.origin }}
            </AppBadge>
          </div>
        </dl>
      </template>
      <p
        v-else-if="detailsItem"
        class="text-sm text-foreground"
      >
        Excluir “{{ detailsItem.title }}”? Os lembretes dele somem junto.
      </p>

      <template #footer>
        <div
          v-if="!confirmDelete"
          class="flex flex-wrap justify-end gap-2"
        >
          <AppButton
            variant="outline"
            @click="closeDetails"
          >
            Fechar
          </AppButton>
          <AppButton
            variant="destructive"
            @click="confirmDelete = true"
          >
            Excluir
          </AppButton>
          <AppButton @click="editFromDetails">
            Editar
          </AppButton>
        </div>
        <div
          v-else
          class="flex justify-end gap-2"
        >
          <AppButton
            variant="outline"
            @click="confirmDelete = false"
          >
            Cancelar
          </AppButton>
          <AppButton
            variant="destructive"
            :disabled="deleting.isPending.value"
            @click="doDelete"
          >
            Excluir de verdade
          </AppButton>
        </div>
      </template>
    </AppDialog>
  </AppLayout>
</template>

<script setup lang="ts">
/**
 * Agenda (Fase 5, spec A.1/A.2/A.3 + B.13): abas Dia | Semana no fuso do usuário,

 * `shiftDayRange`, `userWeekRange`, `shiftWeekRange` — zero regra de data aqui);
 * componentes só formatam (vue.md #7). Modal de criar/editar entra na etapa 8.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { CalendarDays, ChevronLeft, ChevronRight, Inbox, Plus } from 'lucide-vue-next';
import { shiftDayRange, shiftWeekRange } from '@agendabo/schedule-core';
import type { AppointmentDto } from '@agendabo/contracts';
import { useAuthStore } from '@/app/store/authStore';
import { useAppointmentsQuery } from '@/app/composables/queries/useAppointments.query';
import {
  formatDayHeading,
  formatRangeInTz,
  formatWeekHeading,
  measureTzOffset,
} from '@/app/utils/tz';
import { toast } from 'vue-sonner';
import { sortAppointmentsByStart } from '@/app/utils/sorting';
import { useDeleteAppointmentMutation } from '@/app/composables/mutations/useDeleteAppointment.mutation';
import AppointmentModal from '@/view/components/appointment/AppointmentModal.vue';
import AppDialog from '@/view/components/ui/dialog/Dialog.vue';
import AppBadge from '@/view/components/ui/badge/Badge.vue';
import AppLayout from '@/view/layouts/AppLayout.vue';
import AppButton from '@/view/components/ui/button/Button.vue';
import AppSkeleton from '@/view/components/ui/skeleton/Skeleton.vue';
import AppTabs from '@/view/components/ui/tabs/Tabs.vue';

/**
 * Âncora da navegação: instante localizado no fuso do usuário (dias locais do
 * schedule-core). Voltar "hoje" = novo `new Date()` (a regra de período continua
 * sendo do schedule-core; aqui só se move a âncora).
 */
const anchor = ref(new Date());

const auth = useAuthStore();
const timezone = computed(() => auth.user?.timezone ?? 'UTC');
const offset = computed(() => measureTzOffset(timezone.value, anchor.value));

  // B.13: <md abre no Dia, ≥md na Semana (SSR/teste-safe)
function defaultView(): 'day' | 'week' {
  return typeof window !== 'undefined' && window.matchMedia?.('(min-width: 768px)').matches
    ? 'week'
    : 'day';
}
const view = ref<'day' | 'week'>(defaultView());

const range = computed(() =>
  view.value === 'day'
    ? shiftDayRange(anchor.value, offset.value, 0)
    : shiftWeekRange(anchor.value, offset.value, 0),
);

const from = computed(() => range.value.start.toISOString());
const to = computed(() => range.value.end.toISOString());
const appointmentsQuery = useAppointmentsQuery(from, to);

const items = computed(() => sortAppointmentsByStart(appointmentsQuery.data.value?.items ?? []));

const heading = computed(() =>
  view.value === 'day'
    ? formatDayHeading(range.value.start, timezone.value, new Date())
    : null,
);
const weekHeading = computed(() =>
  view.value === 'week' ? formatWeekHeading(range.value.start, range.value.end, timezone.value) : '',
);

/** Semana atual = 7 colunas derivadas do `start` da semana (dias locais). */
const weekDays = computed(() =>
  Array.from({ length: 7 }, (_, i) => {
    const start = new Date(range.value.start.getTime() + i * 86_400_000);
    const end = new Date(start.getTime() + 86_400_000);
    return {
      key: start.toISOString(),
      heading: formatDayHeading(start, timezone.value, new Date()),
      items: items.value.filter(
        (a) => a.startsAt >= start && a.startsAt < end,
      ),
    };
  }),
);

const isEmpty = computed(() => !appointmentsQuery.isFetching.value && items.value.length === 0);

// instantâneo de "agora" p/ esmaecer passados (A.3); re-tira ao voltar p/ hoje
const now = ref(new Date());
let tick: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  tick = setInterval(() => (now.value = new Date()), 60_000);
});
onUnmounted(() => clearInterval(tick));

function isPast(item: AppointmentDto): boolean {
  return item.endsAt < now.value;
}

function shift(days: number): void {
  const DAY = 86_400_000;
  // desloca a âncora em dias/semanas locais e re-deriva o período no schedule-core
  anchor.value = new Date(
    anchor.value.getTime() + (view.value === 'day' ? days : days * 7) * DAY,
  );
  now.value = new Date();
}

function goToday(): void {
  anchor.value = new Date();
  now.value = new Date();
}

  // --- etapa 8: modal único (criar/editar) + detalhes + excluir 2-passos ---
const formOpen = ref(false);
const formMode = ref<'create' | 'edit'>('create');
const editing = ref<AppointmentDto | undefined>(undefined);

const detailsItem = ref<AppointmentDto | null>(null);
const confirmDelete = ref(false);
const deleting = useDeleteAppointmentMutation();

function openForm(): void {
  formMode.value = 'create';
  editing.value = undefined;
  formOpen.value = true;
}

function openDetails(item: AppointmentDto): void {
  detailsItem.value = item;
  confirmDelete.value = false;
}

function closeDetails(): void {
  detailsItem.value = null;
  confirmDelete.value = false;
}

function editFromDetails(): void {
  if (!detailsItem.value) return;
  formMode.value = 'edit';
  editing.value = detailsItem.value;
  formOpen.value = true;
  closeDetails();
}

async function doDelete(): Promise<void> {
  if (!detailsItem.value) return;
  await deleting.mutateAsync(detailsItem.value.id);
    toast.success('Compromisso excluído — os lembretes foram junto.');
  closeDetails();
}

function formatRange(item: AppointmentDto): string {
  return formatRangeInTz(item.startsAt, item.endsAt, timezone.value);
}
</script>
