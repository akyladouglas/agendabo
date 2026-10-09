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

      <!-- navegação: abas (Dia|Semana|Mês|Ano) + ← hoje → + ir-para (A.1–A.5) -->
      <AgendaNav
        :view="agenda.view.value"
        :year="agenda.year.value"
        :month-index="agenda.monthIndex.value"
        :year-options="yearOptions"
        :month-options="monthOptions"
        @update:view="agenda.setView($event)"
        @shift="agenda.shift($event)"
        @today="agenda.goToday()"
        @jump-year="agenda.goToYear($event)"
        @jump-month="agenda.goToMonth($event)"
      />

      <!-- período atual. UMA saída interpolada (sem `v-if` de templates irmãos
           aqui): templates filhos em branco colapsam para um ÚNICO comentário e,
           no happy-dom, essa troca de nós na hora do patch do bloco quebrava o
           patchKeyedFragment (nextSibling null) e abortava o update inteiro. -->
      <p
        class="text-sm font-medium text-muted-foreground"
        data-testid="agenda-heading"
      >
        {{ headingText }}
      </p>

      <!-- CORPO da página: UM branch por estado. Todo ramo tem ELEMENTO próprio +
           `key` estável — nada de `v-if` de texto/template VAZIO entre irmãos: o
           comentário-âncora desse vazio órfão de uma remontagem a mais e o update
           seguinte morria em removeFragment (gotcha happy-dom, Fase 7). -->
      <div
        v-if="bodyKind === 'error'"
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

      <!-- skeleton próprio por visão (D.15) -->
      <div
        v-else-if="bodyKind === 'skeleton-month'"
        class="grid grid-cols-7 gap-1"
        data-testid="skeleton-month"
      >
        <AppSkeleton
          v-for="i in 42"
          :key="i"
          class="h-10"
        />
      </div>
      <div
        v-else-if="bodyKind === 'skeleton-year'"
        class="grid grid-cols-2 gap-3 md:grid-cols-3"
        data-testid="skeleton-year"
      >
        <AppSkeleton
          v-for="i in 12"
          :key="i"
          class="h-28"
        />
      </div>
      <div
        v-else-if="bodyKind === 'skeleton'"
        class="flex flex-col gap-2"
      >
        <AppSkeleton class="h-16" />
        <AppSkeleton class="h-16" />
        <AppSkeleton class="h-16" />
      </div>

      <div
        v-else-if="bodyKind === 'empty'"
        class="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-12 text-center"
      >
        <Inbox
          class="h-8 w-8 text-muted-foreground"
          aria-hidden="true"
        />
        <p class="text-sm text-muted-foreground">
          {{ emptyText }}
        </p>
      </div>

      <!-- visão Dia: a lista vigente (intocada — spec C.11 + chip de conflito) -->
      <ul
        v-else-if="bodyKind === 'day'"
        class="flex flex-col gap-2"
      >
        <li
          v-for="item in items"
          :key="item.id"
        >
          <button
            type="button"
            class="od-move flex w-full min-h-11 items-stretch gap-3 rounded-lg border border-border bg-card p-3 text-left hover:border-primary/50"
            :class="[
              isPast(item) ? 'opacity-60' : '',
              conflictTitle(item) ? 'border-danger/70' : '',
            ]"
            :title="conflictTitle(item) ?? undefined"
            :data-conflicted="conflictTitle(item) ? 'true' : undefined"
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
                <AppBadge
                  v-if="conflictTitle(item)"
                  tone="danger"
                >
                  ⚠ {{ conflictTitle(item) }}
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

      <!-- visão Semana: cards-colunas dom..sáb com agrupamento por dia civil -->
      <div v-else-if="bodyKind === 'week'">
        <WeekGrid
          :days="weekDays"
          @day-click="openDayFrom"
          @item-click="openDetails"
        />
      </div>

      <!-- visão Mês: grade 42 células (bolinhas no mobile) -->
      <div v-else-if="bodyKind === 'month'">
        <!-- R.15 (ajuste do smoke): o vazio em Mês é um aviso DISCRETO acima da
             grade — a grade nunca some (é o alvo de clique p/ criar, B.7) -->
        <p
          v-if="isEmpty"
          class="mb-3 text-sm text-muted-foreground"
          role="status"
        >
          {{ emptyText }}
        </p>
        <MonthGrid
          :cells="monthCellsView"
          :month-name="agenda.monthLabel.value.name"
          :anchor-key="anchorKey"
          @day-click="onMonthDayClick"
          @item-click="openDetails"
        />
      </div>

      <!-- visão Ano: 12 mini-meses / 12 linhas mobile -->
      <div v-else>
        <p
          v-if="isEmpty"
          class="mb-3 text-sm text-muted-foreground"
          role="status"
        >
          {{ emptyText }}
        </p>
        <YearGrid
          :minis="yearMinis"
          :year="agenda.year.value"
          @month-click="agenda.openMonth"
          @day-click="openDayFrom"
        />
      </div>
    </div>

    <!-- modal único criar/editar (D4); prestartDate = data da célula (D.16, hora
         09:00). `:key` por (sessão, modo, id): recria o form a cada abertura — o
         form é `reactive` e montaria com a data do PRESET anterior se o
         componente fosse reaproveitado. -->
    <AppointmentModal
      v-if="formOpen"
      :key="modalKey"
      v-model:open="formOpen"
      :mode="formMode"
      :appointment="editing"
      :preset-date="prestartDate"
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
 * Agenda (Fase 5 + Fase 7): página ORQUESTRADORA. Visões Dia | Semana | Mês | Ano com
 * navegação ‹ hoje › e menu ir-para; todo estado/derivado de calendário mora em
 * `useAgendaPage` (que só chama o schedule-core), e as grades `.vue` são burras —
 * ZERO cálculo de data/conflito neste arquivo (spec calendario-visoes E.4/E.5).
 * Dia = lista vigente (C.11); Revisão intocada.
 */
import { computed, ref } from 'vue';
import { Inbox, Plus } from 'lucide-vue-next';
import { conflictedIds, firstConflictLabel, type CalendarDay } from '@agendabo/schedule-core';
import type { AppointmentDto } from '@agendabo/contracts';
import { useAgendaPage } from '@/app/composables/useAgendaPage.composable';
import { useDeleteAppointmentMutation } from '@/app/composables/mutations/useDeleteAppointment.mutation';
import {
  formatDayHeading,
  formatRangeInTz,
  formatWeekHeading,
  measureTzOffset,
  monthName,
  toLocalDateString,
  toLocalTimeString,
} from '@/app/utils/tz';
import { toast } from 'vue-sonner';
import AppointmentModal from '@/view/components/appointment/AppointmentModal.vue';
import AppDialog from '@/view/components/ui/dialog/Dialog.vue';
import AppBadge from '@/view/components/ui/badge/Badge.vue';
import AppLayout from '@/view/layouts/AppLayout.vue';
import AppButton from '@/view/components/ui/button/Button.vue';
import AppSkeleton from '@/view/components/ui/skeleton/Skeleton.vue';
import AgendaNav from './AgendaNav.vue';
import MonthGrid, { type MonthCellView, type MonthChip } from './MonthGrid.vue';
import WeekGrid, { type WeekCardView, type WeekDayView } from './WeekGrid.vue';
import YearGrid, { type YearDayView, type YearMiniView } from './YearGrid.vue';

const agenda = useAgendaPage();
// @test-hook: expõe a instância p/ harness de calendar-views.spec (nada de lógica aqui)
(window as unknown as { __agenda?: typeof agenda }).__agenda = agenda;
const timezone = agenda.timezone;
const appointmentsQuery = agenda.appointmentsQuery;
const items = agenda.items;

/** Âncora como dateKey local (p/ aria-selected e comparação com as células). */
const anchorKey = computed(() => toLocalDateString(agenda.anchor.value, timezone.value));

// ---- conflito VISÍVEL (C.12): par determinístico sobre os itens do período ----
// `conflictedIds`/`firstConflictLabel` são schedule-core (regra zero). Limitação
// declarada: a contenção da API pode esconder um par que termina fora do período;
// o badge é informativo — a checagem que vale é check-conflict/409 do form.
const conflictIds = computed(() => conflictedIds(items.value));

function conflictTitle(item: AppointmentDto): string | null {
  if (!conflictIds.value.has(item.id)) return null;
  return firstConflictLabel(item, items.value, (s, e) => formatRangeInTz(s, e, timezone.value));
}

// ---- derivados de exibição por visão (formatação apenas — tz.ts) ----
function startHour(item: AppointmentDto): string {
  return toLocalTimeString(item.startsAt, timezone.value);
}

function isPast(item: AppointmentDto): boolean {
  return item.endsAt < agenda.now.value;
}

const heading = computed(() =>
  agenda.view.value === 'day'
    ? formatDayHeading(agenda.range.value.start, timezone.value, agenda.now.value)
    : null,
);
const weekHeading = computed(() =>
  agenda.view.value === 'week'
    ? formatWeekHeading(agenda.range.value.start, agenda.range.value.end, timezone.value)
    : '',
);
const headingText = computed(() => {
  switch (agenda.view.value) {
    case 'day':
      return heading.value ? `${heading.value.isToday ? 'Hoje' : heading.value.weekday} — ${heading.value.label}` : '';
    case 'week':
      return weekHeading.value;
    case 'month':
      return `${agenda.monthLabel.value.name} ${agenda.year.value}`;
    default:
      return String(agenda.year.value);
  }
});

/** Chip B.9: "↦" quando COMEÇOU antes deste dia, "↤" quando TERMINA depois dele. */
function chipTime(item: AppointmentDto, day: CalendarDay): string {
  const t = startHour(item);
  if (item.startsAt < day.start) return `↦ ${t}`;
  if (item.endsAt > day.end) return `${t} ↤`;
  return t;
}

// ---- Semana: linhas dom..sáb (weekRows) + agrupamento por dia civil (groupByLocalDay) ----
const weekDays = computed<WeekDayView[]>(() =>
  agenda.rows.value.map((row) => {
    const dayItems = agenda.byDay.value.get(row.date) ?? [];
    const cards: WeekCardView[] = dayItems.map((item) => ({
      item,
      time: chipTime(item, row),
      review: item.status === 'needs_review',
      past: isPast(item),
      conflictTitle: conflictTitle(item),
      class: [
        item.status === 'needs_review' ? 'border-l-2 border-l-warning' : 'border-border',
        conflictTitle(item) ? 'border-danger/70' : '',
        isPast(item) ? 'opacity-60' : '',
      ].join(' '),
    }));
    return {
      date: row.date,
      key: row.start.toISOString(),
      heading: formatDayHeading(row.start, timezone.value, agenda.now.value),
      cards,
    };
  }),
);

// ---- Mês: 42 células prontas p/ o MonthGrid burro (B.6–B.9) ----
const monthCellsView = computed<MonthCellView[]>(() =>
  agenda.cells.value.map((cell) => {
    const dayItems = agenda.byDay.value.get(cell.date) ?? [];
    const chips: MonthChip[] = dayItems.slice(0, 3).map((item) => ({
      item,
      time: chipTime(item, cell),
      review: item.status === 'needs_review',
      conflictTitle: conflictTitle(item),
      class: [
        'border-border',
        conflictTitle(item) ? 'border-danger/70 bg-danger/5' : 'hover:border-primary/50',
      ].join(' '),
    }));
    const dots = dayItems.slice(0, 8).map((item) => ({
      id: item.id,
      kind: conflictTitle(item)
        ? ('conflict' as const)
        : item.status === 'needs_review'
          ? ('review' as const)
          : ('normal' as const),
    }));
    const hasConflict = dayItems.some((item) => conflictTitle(item) !== null);
    return {
      day: cell,
      date: cell.date,
      chips,
      overflow: Math.max(0, dayItems.length - 3),
      dots,
      hasConflict,
      class: [
        cell.inMonth ? '' : 'opacity-50',
        cell.isToday ? 'ring-1 ring-inset ring-primary' : '',
        hasConflict ? 'border-danger/40' : '',
      ].join(' '),
    };
  }),
);

/**
 * Clique na célula do Mês (B.7/D.16): vazia → criar com a data da célula;
 * com compromissos → visão Dia daquele dia (o "+N" também cai aqui).
 */
function onMonthDayClick(cell: MonthCellView): void {
  if (cell.chips.length === 0 && cell.overflow === 0 && cell.dots.length === 0) {
    openCreateOn(cell.date);
    return;
  }
  openDayFrom(cell.date);
}

// ---- Ano: 12 mini-meses com densidade por DIA (C.13, dayDensity) ----
const yearMinis = computed<YearMiniView[]>(() => {
  const minis: YearMiniView[] = [];
  const year = agenda.year.value;
  for (let m = 1; m <= 12; m++) {
  // grade do mini-mês: a grade do Ano que tem o mês m como mês PRINCIPAL (dia do meio
  // — índice 21, mesma definição de `monthCells`). Procurar por QUALQUER célula
  // inMonth achava o trailing de m na grade de m−1 e dava leading errado.
  const own = agenda.yearMonthCells.value.find(
    (g) => Number(g[21]!.date.slice(5, 7)) === m,
  );
    const inMonth = own?.filter((c) => c.inMonth) ?? [];
    const lead = own ? own.indexOf(inMonth[0]!) : 0;
    const dens = agenda.density.value.get(m);
    const daySet = new Set(dens?.dayKeys ?? []);
    const orderedKeys = [...daySet].sort();
    const days: YearDayView[] = [];
    for (let i = 0; i < lead; i++) days.push({ index: i, hasAppointment: false, isToday: false, dimmed: false });
    inMonth.forEach((c, idx) => {
      const has = daySet.has(c.date);
      days.push({
        index: lead + idx,
        date: c.date,
        dayNumber: Number(c.date.slice(8, 10)),
        hasAppointment: has,
        isToday: c.isToday === true,
        dimmed: has && orderedKeys.indexOf(c.date) >= 7, // esmaecimento além da 7ª bolinha
      });
    });
    minis.push({
      month: m,
      name: monthName(new Date(Date.UTC(year, m - 1, 15)), timezone.value, 'short'),
      isCurrent: m === agenda.monthIndex.value,
      daysWithAppointments: dens?.daysWithAppointments ?? 0,
      days,
    });
  }
  return minis;
});

// ---- menus ir-para (A.5) ----
const yearOptions = computed(() => {
  const y = agenda.year.value;
  return Array.from({ length: 11 }, (_, i) => String(y - 5 + i)).map((v) => ({ value: v, label: v }));
});
const monthOptions = computed(() =>
  Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1),
    label: monthName(new Date(Date.UTC(2024, i, 15)), timezone.value, 'long'),
  })),
);

// ---- estados ----
const isEmpty = computed(() => !appointmentsQuery.isFetching.value && items.value.length === 0);

/**
 * Ramo do corpo da página. O corpo é UMA cadeia v-if/v-else-if de ELEMENTOS com
 * `key` implícito estável por posição (e branches vazios viram elementos, nunca
 * comment-fragment): uma cadeia com `v-if` de template/texto vazio + happy-dom
 * deixava um irmão órfão do âncora do fragmento ao trocar de branch, e o update
 * seguinte morria em removeFragment (nextSibling null) — gotcha da Fase 7.
 */
const bodyKind = computed<'error' | 'skeleton-month' | 'skeleton-year' | 'skeleton' | 'empty' | 'day' | 'week' | 'month' | 'year'>(() => {
  if (appointmentsQuery.isError.value) return 'error';
  if (appointmentsQuery.isPending.value) {
    if (agenda.view.value === 'month') return 'skeleton-month';
    if (agenda.view.value === 'year') return 'skeleton-year';
    return 'skeleton';
  }
  // VAZIO só faz sentido em Dia/Semana. Mês/Ano SEMPRE renderizam a grade: a grade
  // é o alvo de clique para CRIAR compromisso (B.7) — engoli-la num mês/ano vazio
  // quebraria exatamente o caso "quero marcar algo num dia livre".
  if (isEmpty.value && agenda.view.value !== 'month' && agenda.view.value !== 'year') return 'empty';
  return agenda.view.value;});
const emptyText = computed(() => {
  switch (agenda.view.value) {
    case 'day':
      return 'Nada neste dia.';
    case 'week':
      return 'Nada nesta semana.';
    case 'month':
      return 'Nada neste mês.';
    default:
      return 'Nada neste ano.';
  }
});

function formatRange(item: AppointmentDto): string {
  return formatRangeInTz(item.startsAt, item.endsAt, timezone.value);
}

// ---- navegação por clique (âncora + troca de visão; a âncora preserva o contexto) ----
function openDayFrom(dateKey: string): void {
  agenda.setDate(dateKey);
  agenda.setView('day');
}

// ---- modal único (criar/editar) + detalhes + excluir 2-passos (vigente) ----
const formOpen = ref(false);
const formMode = ref<'create' | 'edit'>('create');
const editing = ref<AppointmentDto | undefined>(undefined);
const prestartDate = ref<Date | undefined>(undefined);

const detailsItem = ref<AppointmentDto | null>(null);
const confirmDelete = ref(false);
const deleting = useDeleteAppointmentMutation();

/** Contador de abertura do modal: entra no `:key` e força MONTAGEM NOVA por abertura. */
const formSession = ref(0);
const modalKey = computed(() => `${formSession.value}-${formMode.value}-${editing.value?.id ?? 'new'}`);

function openForm(): void {
  formMode.value = 'create';
  editing.value = undefined;
  prestartDate.value = undefined;
  formSession.value += 1;
  formOpen.value = true;
}

/** Criar a partir do calendário (D.16): data da célula, hora default 09:00 no form. */
function openCreateOn(dateKey: string): void {
  formMode.value = 'create';
  editing.value = undefined;
  // O PRESET é o dia da célula clicada — não a âncora (a âncora move o calendário
  // inteiro e pegaria "hoje" na primeira célula clicada sem navegação).
  const noon = new Date(`${dateKey}T12:00:00Z`);
  const off = measureTzOffset(timezone.value, noon);
  prestartDate.value = new Date(Date.parse(`${dateKey}T00:00:00Z`) - off * 60_000);
  formSession.value += 1;
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
  prestartDate.value = undefined;
  formSession.value += 1;
  formOpen.value = true;
  closeDetails();
}

async function doDelete(): Promise<void> {
  if (!detailsItem.value) return;
  await deleting.mutateAsync(detailsItem.value.id);
  toast.success('Compromisso excluído — os lembretes foram junto.');
  closeDetails();
}
</script>

