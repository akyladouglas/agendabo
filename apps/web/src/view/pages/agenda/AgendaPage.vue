<template>
  <AppLayout>
    <div class="flex flex-col gap-4">
      <!-- cabeçalho: título + subtítulo da fonte + novo -->
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="min-w-0">
          <h1 class="title-page">
            Agenda
          </h1>
          <!-- F.7/C.18: indicador TEXTUAL da fonte emprestada (nunca só cor) -->
          <p
            v-if="agenda.readonly.value"
            class="text-sm text-muted-foreground"
            data-testid="agenda-source-subtitle"
          >
            Vendo a agenda de {{ agendaOwnerLabel }} · somente leitura
          </p>
        </div>
        <!-- C.18: na emprestada o "Novo" NÃO existe (read-only estrutural) -->
        <AppButton
          v-if="!agenda.readonly.value"
          data-testid="agenda-new"
          @click="openForm"
        >
          <Plus
            class="h-4 w-4"
            aria-hidden="true"
          />
          Novo
        </AppButton>
      </div>

      <!-- navegação: abas (Dia|Semana|Mês|Ano) + ← hoje → + ir-para (A.1–A.5) +
           seletor de FONTE (só com vínculo recebido ativo — A5) -->
      <AgendaNav
        :view="agenda.view.value"
        :year="agenda.year.value"
        :month-index="agenda.monthIndex.value"
        :year-options="yearOptions"
        :month-options="monthOptions"
        :is-today="anchorKey === agenda.todayKey.value"
        :source="sourceValue"
        :source-options="sourceOptions"
        :show-source="showSourceSelector"
        @update:view="agenda.setView($event)"
        @update:source="onSourceChange"
        @shift="agenda.shift($event)"
        @today="agenda.goToday()"
        @jump-year="agenda.goToYear($event)"
        @jump-month="agenda.goToMonth($event)"
      />

      <!-- período atual: live region (R7/a11y): navegar com ← → /Hoje/ir-para
           precisa ser ANUNCIADO ao leitor de tela. NÃO é <h2> de propósito: um h2
           vivo deixaria o h1 "Agenda" sem filho na outline (marcação inválida); o
           sr-only "Calendário" acima é o heading da região da grade. UMA saída
           interpolada (sem `v-if` de templates irmãos aqui): templates filhos em
           branco colapsam para um ÚNICO comentário e, no happy-dom, essa troca de
           nós na hora do patch do bloco quebrava o patchKeyedFragment
           (nextSibling null) e abortava o update inteiro. -->
      <h2 class="sr-only">
        Calendário
      </h2>
      <p
        class="text-sm font-medium text-muted-foreground"
        aria-live="polite"
        data-testid="agenda-heading"
      >
        {{ headingText }}
      </p>

      <!-- prévia do destino durante o arrasto (2.1) + anúncio acessível pós-drop
           (2.4). Elementos ÚNICOS sempre presentes (sem v-if de irmãos — gotcha 10) -->
      <p
        v-show="agendaDrag.previewLabel.value"
        class="text-xs tabular-nums text-muted-foreground"
        data-testid="drop-preview"
      >
        {{ agendaDrag.previewLabel.value }}
      </p>
      <p
        class="sr-only"
        aria-live="polite"
        aria-atomic="true"
        data-testid="drop-live"
      >
        {{ agendaDrag.dropAnnouncement.value }}
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

      <!-- visão Dia (Etapa 1.3): GRADE de horas (clicável → criar dia+hora) + a
           LISTA do dia ABAIXO (notações/anexos legíveis — a grade não os substitui).
           Vazio: a grade continua (é o alvo de criar) com aviso discreto (R.15). -->
      <div
        v-else-if="bodyKind === 'day'"
        class="flex flex-col gap-4"
        data-testid="day-body"
      >
        <!-- F.7/C.18: estado vazio da agenda emprestada (nunca "crie aqui") -->
        <p
          v-if="isEmpty"
          class="text-sm text-muted-foreground"
          role="status"
          data-testid="shared-empty"
        >
          {{ emptyText }}
        </p>
        <DayGrid
          :slots="daySlots"
          :blocks="dayBlocksView"
          :day-label="headingText"
          :drag="agenda.readonly.value ? null : agendaDrag.drag"
          :read-only="agenda.readonly.value"
          @slot-click="onDaySlotClick"
          @block-click="openDetails"
        />
        <ul
          v-if="dayListItems.length > 0"
          class="flex flex-col gap-2"
          data-testid="day-list"
        >
          <li
            v-for="item in dayListItems"
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
              :data-conflicted="ownAgenda && conflictTitle(item) ? 'true' : undefined"
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
                  <!-- A2/C.20: na emprestada o marcador é TEXTUAL ("de ‹dono›");
                       os badges de revisão/conflito só pintam na agenda própria
                       (ownAgenda fecha o tipo: item emprestado nem TEM `origin`) -->
                  <AppBadge
                    v-if="!ownAgenda"
                    tone="info"
                  >
                    de {{ agendaOwnerLabel }}
                  </AppBadge>
                  <template v-if="ownAgenda">
                    <AppBadge
                      v-if="asOwn(item).status === 'needs_review'"
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
                    <AppBadge :tone="asOwn(item).origin === 'bot' ? 'info' : 'success'">
                      via {{ asOwn(item).origin }}
                    </AppBadge>
                  </template>
                  <span class="text-xs text-muted-foreground">{{ formatRange(item) }}</span>
                </span>
              </span>
            </button>
          </li>
        </ul>
      </div>

      <!-- visão Semana: cards-colunas dom..sáb com agrupamento por dia civil.
           Vazio: aviso discreto ACIMA das colunas — os 7 dias continuam lá
           (navegáveis/criáveis, mesma regra Mês/Dia — R.15/B.7). -->
      <div v-else-if="bodyKind === 'week'">
        <p
          v-if="isEmpty"
          class="mb-3 text-sm text-muted-foreground"
          role="status"
        >
          {{ emptyText }}
        </p>
        <WeekGrid
          :days="weekDays"
          :drag="agenda.readonly.value ? null : agendaDrag.drag"
          :read-only="agenda.readonly.value"
          @day-click="openDayFrom"
          @cell-click="onWeekCellClick"
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
          :drag="agenda.readonly.value ? null : agendaDrag.drag"
          :read-only="agenda.readonly.value"
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
      :preset="preset"
      :auto-relocate="Boolean(preset?.autoRelocate)"
      @saved="onModalSaved"
    />

    <!-- detalhes + excluir em 2 passos (A.6/A.7); na emprestada o painel é
         SOMENTE-LEITURA (C.18): sem Excluir/Editar, com marcador textual do dono -->
    <AppDialog
      :open="detailsItem !== null"
      :title="
        confirmDelete
          ? 'Excluir compromisso?'
          : (detailsItem ? detailsTitle(detailsItem) : '')
      "
      @update:open="detailsItem = $event ? detailsItem : null"
    >
      <template v-if="detailsItem && !confirmDelete">
        <dl class="flex flex-col gap-3 text-sm">
          <!-- C.20: quem é o dono do que se vê (marcação textual, não só cor) -->
          <div v-if="!ownAgenda">
            <dt class="text-muted-foreground">
              Dono
            </dt>
            <dd
              class="font-medium text-foreground"
              data-testid="details-owner"
            >
              de {{ agendaOwnerLabel }}
            </dd>
          </div>
          <div>
            <dt class="text-muted-foreground">
              Quando
            </dt>
            <!-- C2 da spec: rótulo com o FIM completo (dia+hora) — "23:00–seg
                 12/10 17:00" vira "qui 08/10 14:00 → seg 12/10 17:00" (formato do
                 bug: o usuário precisa LER "termina segunda 17:00"). -->
            <dd class="font-medium text-foreground">
              {{ formatDateTimeInTz(detailsStart(detailsItem), timezone) }} →
              {{ formatDateTimeInTz(detailsEnd(detailsItem), timezone) }}
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
          <div
            v-if="ownAgenda"
            class="flex flex-wrap gap-1.5"
          >
            <AppBadge
              v-if="detailsOwn(detailsItem).status === 'needs_review'"
              tone="warning"
            >
              pendente de revisão
            </AppBadge>
            <AppBadge :tone="detailsOwn(detailsItem).origin === 'bot' ? 'info' : 'success'">
              via {{ detailsOwn(detailsItem).origin }}
            </AppBadge>
          </div>
          <p
            v-else
            class="text-xs text-muted-foreground"
            data-testid="details-readonly-note"
          >
            Somente leitura — esta agenda pertence a {{ agendaOwnerLabel }}.
          </p>
        </dl>
      </template>
      <p
        v-else-if="detailsItem && ownAgenda"
        class="text-sm text-foreground"
      >
        Excluir “{{ detailsOwn(detailsItem).title }}”? Os lembretes dele somem junto.
      </p>

      <template #footer>
        <!-- emprestada: painel somente-leitura — só "Fechar" (C.18) -->
        <div
          v-if="agenda.readonly.value"
          class="flex flex-wrap justify-end gap-2"
        >
          <AppButton
            variant="outline"
            @click="closeDetails"
          >
            Fechar
          </AppButton>
        </div>
        <div
          v-else-if="!confirmDelete"
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
            Excluir
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
import { computed, ref, watch } from 'vue';
import { Plus } from 'lucide-vue-next';
import {
  conflictedIds,
  firstConflictLabel,
  layoutDayTimeline,
  type CalendarDay,
  type DaySlice,
} from '@agendabo/schedule-core';
import type { AppointmentDto, SharedAgendaListItem } from '@agendabo/contracts';
import {
  useAgendaPage,
  type AgendaItem,
  type SliceTimelineBlock,
  type SliceTimelineItem,
} from '@/app/composables/useAgendaPage.composable';
import { useAgendaDrag, dropOriginKey } from '@/app/composables/useAgendaDrag.composable';
import { useDeleteAppointmentMutation } from '@/app/composables/mutations/useDeleteAppointment.mutation';
import { useSharedAgendasQuery } from '@/app/composables/queries/useSharedAgendas.query';
import { sharedOwnerName } from '@/app/utils/sharedAgendas';
import {
  formatDateTimeInTz,
  formatDayHeading,
  formatRangeInTz,
  formatWeekHeading,
  localMidnightUtc,
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
import DayGrid, { type DayBlockView, type DaySlotView } from './DayGrid.vue';
import MonthGrid, { type MonthCellView, type MonthChip } from './MonthGrid.vue';
import WeekGrid, { type WeekDayView } from './WeekGrid.vue';
import YearGrid, { type YearDayView, type YearMiniView } from './YearGrid.vue';

const agenda = useAgendaPage();
// @test-hook: expõe a instância p/ harness de calendar-views.spec (nada de lógica
// aqui). R5/seg (review 2026-10-09): só em DEV — em produção isso entregaria a
// agenda inteira do usuário a qualquer XSS/extensão no DOM. O harness do vitest
// roda com DEV=true do vite, então os testes seguem funcionando.
if (import.meta.env.DEV) {
  (window as unknown as { __agenda?: typeof agenda }).__agenda = agenda;
}
const timezone = agenda.timezone;
const appointmentsQuery = agenda.appointmentsQuery;
const items = agenda.items;

// ---- FONTE da agenda (spec C.17–C.20, decisão D9) ----
/**
 * Vínculos (enviados+recebidos) — a query é a mesma do card do perfil. Ela é
 * ATIVADA só quando há um `owner` na URL (aceite recém-chegado vindo de
 * /convite-agenda): assim a agenda própria não paga um GET extra a cada visita
 * (requisito de regressão zero), e o invariante de fonte abaixo só roda quando
 * precisa validar um dono emprestado.
 */
const sharedAgendasQuery = useSharedAgendasQuery();
/**
 * RECEBIDOS com `ownerId` = uuid do DONO da agenda. BUG corrigido: o seletor
 * carregava o `id` do VÍNCULO como valor e a query saía `owner=<id do vínculo>`
 * — mas a API espera o **ownerId** em `owner=` (spec B.12:
 * `activeLinkBetween(owner, sessão)`) ⇒ a leitura emprestada daria 403 sempre.
 * Fonte do uuid: `ownerId` no item CRU da resposta (`rawData`, mesmo fetch,
 * antes do strip do contrato). Item SEM `ownerId` no payload cru é DESCARTADO do
 * seletor — nunca usar o id do vínculo como owner (gotcha 27). `sourceOwner`, o
 * valor do seletor, o `owner=` da query e a dimensão da chave
 * `qk.appointments(from, to, owner)` passam a ser a MESMA coisa: o dono.
 */
type ReceivedLinkRaw = SharedAgendaListItem & { ownerId?: string };
const incomingActive = computed<Array<SharedAgendaListItem & { ownerId: string }>>(() => {
  // rawData: o payload cru ANTES do strip do contrato (fonte do uuid do dono);
  // data.value (validado) manda na lista/estados. Cast de leitura só.
  const raw = sharedAgendasQuery.rawData.value as { received?: ReceivedLinkRaw[] } | undefined;
  const rawById = new Map((raw?.received ?? []).map((l) => [l.id, l]));
  return (sharedAgendasQuery.data.value?.received ?? [])
    .filter((l) => l.status === 'active')
    .map((l) => ({ ...l, rawOwnerId: rawById.get(l.id)?.ownerId }))
    // sem ownerId não pode virar fonte — nunca usar id do vínculo como owner,
    // gotcha 27 (o fallback id do vínculo era um 403 adormecido em `owner=`).
    .filter((l) => l.rawOwnerId !== undefined)
    .map((l) => ({ ...l, ownerId: l.rawOwnerId as string }));
});
/** A5: sem vínculo recebido ativo o seletor NÃO aparece (nem desabilitado). */
const showSourceSelector = computed(() => incomingActive.value.length > 0);
const sourceOptions = computed(() => [
  { value: 'me', label: 'Minha agenda' },
  // VALUE = ownerId do dono (NUNCA o id do vínculo) — cai direto em `owner=`
  ...incomingActive.value.map((l) => ({
    value: l.ownerId,
    label: `Agenda de ${sharedOwnerName(l)}`,
  })),
]);
/** ownerId da fonte atual ('me' quando própria) — o valor do AppSelect. */
const sourceValue = computed(() => agenda.sourceOwner.value ?? 'me');
/** Nome do dono da fonte (vazio na própria) — subtítulo e marcadores textuais. */
const agendaOwnerLabel = computed(() => {
  const link = incomingActive.value.find((l) => l.ownerId === agenda.sourceOwner.value);
  return link ? sharedOwnerName(link) : '';
});
/** Estreita tipada da FONTE (nunca cast): própria ⇒ `origin`/badges existem. */
const ownAgenda = computed(() => !agenda.readonly.value);
function asOwn(item: AgendaItem): AppointmentDto {
  return item as AppointmentDto;
}
const detailsTitle = (item: AgendaItem): string => item.title;
const detailsStart = (item: AgendaItem): Date => item.startsAt;
const detailsEnd = (item: AgendaItem): Date => item.endsAt;
const detailsOwn = (item: AgendaItem): AppointmentDto => asOwn(item);

/** Troca de fonte (D9): só muda `sourceOwner` — visão/âncora/período intactos. */
function onSourceChange(value: string): void {
  agenda.sourceOwner.value = value === 'me' ? null : value;
}

/**
 * Invariante de fonte: se o vínculo ativo da fonte sumiu da lista (revogado pelo
 * dono, saí, reconvite), a fonte volta para a MINHA — evita deixar o usuário
 * olhando um 403 `shared_access_invalid`. Só roda com a lista carregada.
 */
watch(incomingActive, (links) => {
  const owner = agenda.sourceOwner.value;
  if (owner && !links.some((l) => l.ownerId === owner)) agenda.sourceOwner.value = null;
});

/**
 * Lista da visão Dia (D.4): só os itens que TOCAM o dia focado, exibidos com o
 * período INTEGRAL. Na Semana/Mês a CARGA cobre um período maior — listar a carga
 * inteira mostraria na quinta um compromisso só de segunda. `daySlices` já é o
 * recorte (um item por slice); o clique/aria usam o `slice.item` integral. */
const dayListItems = computed<AgendaItem[]>(() =>
  agenda.view.value === 'day'
    ? agenda.daySlices.value.map((s) => s.item)
    : items.value,
);

/** Âncora como dateKey local (p/ aria-selected e comparação com as células). */
const anchorKey = computed(() => toLocalDateString(agenda.anchor.value, timezone.value));

// ---- conflito VISÍVEL (C.12): par determinístico sobre os itens do período ----
// `conflictedIds`/`firstConflictLabel` são schedule-core (regra zero). Limitação
// declarada: a contenção da API pode esconder um par que termina fora do período;
// o badge é informativo — a checagem que vale é check-conflict/409 do form.
// A4/B.14: na agenda EMPRESTADA o conflito não existe (a query só devolve
// `confirmed` crua do dono e o marcador fica restrito à agenda própria — o
// `ownAgenda` fecha a porta EM TODOS os pintores: chips, blocos, bolinhas,
// dia-lista e a própria fonte de ids fica vazia).
const conflictIds = computed(() =>
  ownAgenda.value ? conflictedIds(items.value.map(asOwn)) : new Set<string>(),
);

function conflictTitle(item: AgendaItem): string | null {
  if (!ownAgenda.value) return null;
  if (!conflictIds.value.has(item.id)) return null;
  return firstConflictLabel(asOwn(item), items.value.map(asOwn), (s, e) => formatRangeInTz(s, e, timezone.value));
}

// ---- derivados de exibição por visão (formatação apenas — tz.ts) ----
function startHour(item: AgendaItem): string {
  return toLocalTimeString(item.startsAt, timezone.value);
}

function isPast(item: AgendaItem): boolean {
  return item.endsAt < agenda.now.value;
}

const heading = computed(() =>
  agenda.view.value === 'day'
    ? formatDayHeading(agenda.range.value.start, timezone.value, agenda.now.value)
    : null,
);
const weekHeading = computed(() => {
  if (agenda.view.value !== 'week') return '';
  // o heading descreve a GRADE renderizada (dom..sáb), não a query (seg..seg):
  // `agenda.rows` já é a semana dom..sáb da âncora — o fim é a meia-noite local
  // do sábado (instante exclusive)
  const rows = agenda.rows.value;
  if (rows.length === 0) return '';
  return formatWeekHeading(rows[0]!.start, rows[rows.length - 1]!.end, timezone.value);
});
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

/** Chip B.9/D6: dia de início = hora de início; dias do meio/fim = "dia inteiro"
 *  (sem hora) com o marcador da DIREÇÃO de onde o item VEIO: "↦" prefixado = veio do
 *  dia anterior; "↤" prefixado = virá do dia seguinte (chip de prévia num dia antes do
 *  início). O marcador fica SEMPRE do lado de onde o item atravessa a borda (review
 *  2026-10-11 apontava o símbolo trocado no fim do intervalo). */
function chipTime(item: AgendaItem, day: CalendarDay): string {
  const startsHere = item.startsAt >= day.start && item.startsAt < day.end;
  if (!startsHere) return item.startsAt < day.start ? '↦ dia inteiro' : '↤ dia inteiro';
  return item.endsAt > day.end ? `${startHour(item)} ↦` : startHour(item);
}

/**
 * MARCADORES DE CONTINUAÇÃO da decisão D4 (rótulo do recorte): "↦" quando o bloco
 * CONTINUA para outro dia (continuaAfter), "↤" quando o bloco VEIO de outro dia
 * (continuesBefore). Ex.: "23:00–23:59 ↦" no dia de início; "↤ 00:00–23:59 ↦"
 * no meio; dia final com "↤" antes e nada depois do fim real.
 */
function continuationMarks(before: boolean, after: boolean): string {
  return `${before ? '↤ ' : ''}${after ? ' ↦' : ''}`;
}

/**
 * Rótulo do bloco de grade (Dia/Semana): recorte local entre os marcadores ↤/↦.
 * O FIM do recorte que morre na meia-noite é rotulado 23:59 do MESMO dia
 * local (nunca "00:00" do dia seguinte — meia-noite é exclusive; o ↦ já diz que
 * continua). Início de recorte é sempre meia-noite em ponto → "00:00".
 */
function sliceTimeLabel(slice: {
  startsAt: Date;
  endsAt: Date;
  continuesBefore: boolean;
  continuesAfter: boolean;
}): string {
  const after = continuationMarks(false, slice.continuesAfter); // ↦ sufixado (D4)
  const end = slice.continuesAfter
    ? new Date(slice.endsAt.getTime() - 1) // 23:59:59.999 local → "23:59" no formatRangeInTz (nunca o dia seguinte)
    : slice.endsAt;
  return `${continuationMarks(slice.continuesBefore, false)}${formatRangeInTz(slice.startsAt, end, timezone.value)}${after}`;
}

// ---- Visão Dia (Etapa 1.3): linhas de hora + blocos prontos p/ o DayGrid burro ----
// Os dados vêm do composable (`hourGrid`/slices recortados + `layoutDayTimeline` do
// schedule-core); aqui só FORMATAÇÃO e classes — zero regra de data/conflito (E.4).
// C.18: na emprestada o aria das células de hora NÃO promete "criar" (os slots
// continuam renderizados — a grade é a leitura; `readOnly` no DayGrid desliga o
// botão e o click de criação morre na página de qualquer forma).
const daySlots = computed<DaySlotView[]>(() =>
  agenda.hourCells.value.map((cell) => ({
    hour: cell.hourUtc,
    label: cell.label,
    key: cell.start.toISOString(),
    isPast: cell.isPast,
    ariaLabel: agenda.readonly.value
      ? `${cell.label} de ${headingText.value}`
      : `Criar compromisso às ${cell.label} de ${headingText.value}`,
  })),
);
const dayBlocksView = computed<DayBlockView[]>(() =>
  agenda.dayBlocks.value.map((b) => blockView(b.item, b)),
);

/**
 * Vista de um bloco de GRADE a partir do SLICE do dia + bloco posicionado: o
 * rótulo/aria-label trazem o RECORTE local + marcador de continuação; clique/drag
 * usam o compromisso INTEGRAL (`slice.item`) — payloads não regredissem (D7).
 * C.20: na emprestada o acento é `border-l-info` + o aria-label diz "de ‹dono›"
 * (marcação textual, não só cor); A4: sem classe/borda de conflito.
 */
function blockView(slice: DaySlice<AgendaItem>, b: SliceTimelineBlock): DayBlockView {
  const item = slice.item;
  const time = sliceTimeLabel(slice);
  const shared = agenda.readonly.value;
  return {
    item,
    top: b.top,
    height: b.height,
    left: b.column * b.width,
    width: b.width,
    time,
    review: !shared && item.status === 'needs_review',
    conflictTitle: conflictTitle(item),
    ariaLabel: `${item.title}${shared ? ` — de ${agendaOwnerLabel.value}` : ''}, ${time}${b.isPast ? ' (passado)' : ''}`,
    class: [
      // faixa do dia: leve tingimento da cor primária (legível com o tema escuro);
      // revisão marca pela BARRA ESQUERDA (não pelo fundo, pra não brigar com
      // conflito); emprestada usa o ACENTO do marcador de dono (C.20).
      shared ? 'border-l-info' : item.status === 'needs_review' ? 'border-l-warning' : 'border-l-primary',
      !shared && conflictTitle(item)
        ? 'border-danger/70 bg-danger/10'
        : 'hover:border-primary/60 hover:bg-primary/10',
      b.isPast ? 'opacity-60' : '',
    ].join(' '),
  };
}

// ---- Semana: colunas dom..sáb COM grade de horas (weekGridRows) + blocos ----
// Cada coluna recebe os SLICES do recorte do dia (D7 — `agenda.slicesByRowDate`,
// cortado no composable via schedule-core); aqui o layout posiciona e só FORMATA
// (E.4). O clique/drag abrem/movem o compromisso INTEGRAL (`slice.item`).
const weekDays = computed<WeekDayView[]>(() =>
  agenda.rows.value.map((row) => {
    const slices = agenda.slicesByRowDate.value.get(row.date) ?? [];
    const blocks = layoutDayTimeline(
      slices.map((slice): SliceTimelineItem => ({ ...slice, id: slice.item.id })),
      { start: row.start, end: row.end },
      row.offsetMinutes,
      agenda.now.value,
    );
    const nowInDay =
      agenda.now.value >= row.start && agenda.now.value < row.end ? agenda.now.value : null;
    const nowCell = nowInDay
      ? row.cells.findIndex((c) => (nowInDay as Date) < c.end)
      : -1;
    return {
      date: row.date,
      key: row.start.toISOString(),
      heading: formatDayHeading(row.start, timezone.value, agenda.now.value),
      // C.18: emprestada → hora vazia da grade NÃO é convite a criar
      createHint: agenda.readonly.value
        ? null
        : (hour: string) => `Criar compromisso às ${hour} de ${formatDayHeading(row.start, timezone.value, agenda.now.value).label}`,
      blocks: blocks.map((b) => blockView(b.item as DaySlice<AgendaItem>, b)),
      rulerHour: nowCell >= 0 ? row.cells[nowCell]!.hourUtc : null,
      nowCell: nowCell >= 0 ? nowCell : null,
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
      review: ownAgenda.value && item.status === 'needs_review',
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
        : ownAgenda.value && item.status === 'needs_review'
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
 * C.18: na emprestada célula vazia é NAVEGAÇÃO para o Dia (nunca criação).
 */
function onMonthDayClick(cell: MonthCellView): void {
  if (cell.chips.length === 0 && cell.overflow === 0 && cell.dots.length === 0) {
    if (agenda.readonly.value) {
      openDayFrom(cell.date);
      return;
    }
    openCreateOn(cell.date);
    return;
  }
  openDayFrom(cell.date);
}

// ---- Ano: 12 mini-meses com densidade por DIA (spec visao-ano-heatmap, refina C.13) ----
// As grades 7×6 vêm do schedule-core (`agenda.yearHeat` — ano civil da âncora), a
// densidade de `dayDensity` sobre o range do ANO inteiro (query C1) e o conflito do
// par determinístico (`conflictedIds`). Aqui só COMPOSIÇÃO (E.4): a página decide se a
// célula tem bolinha, se é hoje/conflito/esmaecida; o YearGrid é burro.
const yearMinis = computed<YearMiniView[]>(() => {
  const ids = conflictIds.value;
  return agenda.yearHeat.value.map((heat) => {
    const dens = agenda.density.value.get(heat.month);
    const daySet = new Set(dens?.dayKeys ?? []);
    let dots = 0;
    const days: YearDayView[] = heat.cells.map((c, index) => {
      if (!c.inMonth) return { index, hasAppointment: false, isToday: false, hasConflict: false, dimmed: false };
      const has = daySet.has(c.date);
      const hasConflict = has && (agenda.byDay.value.get(c.date) ?? []).some((i) => ids.has(i.id));
      if (has) dots += 1;
      return {
        index,
        date: c.date,
        dayNumber: Number(c.date.slice(8, 10)),
        hasAppointment: has,
        isToday: c.isToday === true,
        hasConflict,
        dimmed: has && dots > 7, // esmaecimento além da 7ª bolinha do mês (C.13)
      };
    });
    return {
      month: heat.month,
      name: monthName(new Date(Date.UTC(agenda.year.value, heat.month - 1, 15)), timezone.value, 'short'),
      isCurrent: heat.month === agenda.monthIndex.value,
      daysWithAppointments: dens?.daysWithAppointments ?? 0,
      days,
    };
  });
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
const bodyKind = computed<'error' | 'skeleton-month' | 'skeleton-year' | 'skeleton' | 'day' | 'week' | 'month' | 'year'>(() => {
  if (appointmentsQuery.isError.value) return 'error';
  if (appointmentsQuery.isPending.value) {
    if (agenda.view.value === 'month') return 'skeleton-month';
    if (agenda.view.value === 'year') return 'skeleton-year';
    return 'skeleton';
  }
  // VAZIO nunca engole uma grade: Dia/Semana/Mês/Ano SEMPRE renderizam (a grade é
  // o alvo de clique p/ criar — B.7 — e o meio de navegar). O aviso "Nada nesta
  // …" fica DENTRO do próprio ramo, discreto, acima da grade (R.15).
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

function formatRange(item: AgendaItem): string {
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
/**
 * Preset do form de criação: `date` SEMPRE; `hour` "HH:mm" vem da célula da grade
 * do Dia (sem hora — célula do Mês — o form mantém o default 09:00, Aberto #5).
 * No drop conflituoso (2.3) o preset VAI COM o item em edição: `date`/`endsAt` =
 * horário candidato + duração, `autoRelocate` = pede as jogadas ao montar.
 */
const preset = ref<{ date: Date; hour?: string; endsAt?: Date; autoRelocate?: boolean } | undefined>(undefined);

const detailsItem = ref<AgendaItem | null>(null);
const confirmDelete = ref(false);
const deleting = useDeleteAppointmentMutation();

/** Contador de abertura do modal: entra no `:key` e força MONTAGEM NOVA por abertura. */
const formSession = ref(0);
const modalKey = computed(() => `${formSession.value}-${formMode.value}-${editing.value?.id ?? 'new'}`);

function openForm(): void {
  formMode.value = 'create';
  editing.value = undefined;
  preset.value = undefined;
  formSession.value += 1;
  formOpen.value = true;
}

/**
 * Criar a partir do calendário (D.16): data da célula; com `hour` (grade do Dia) a
 * hora da célula, sem ela (célula do Mês) o default 09:00 local do form (Aberto #5).
 * O PRESET é o dia/hora da célula clicada — não a âncora (a âncora move o calendário
 * inteiro e pegaria "hoje" na primeira célula clicada sem navegação).
 */
function openCreateOn(dateKey: string, hour?: string): void {
  formMode.value = 'create';
  editing.value = undefined;
  preset.value = { date: localMidnightUtc(dateKey, timezone.value), ...(hour ? { hour } : {}) };
  formSession.value += 1;
  formOpen.value = true;
}

/** Clique na célula vazia da grade do Dia: criar NAQUELE dia+hora (melhora o
 *  `openCreate('')`). C.18: na emprestada o click NUNCA chega aqui — o DayGrid
 *  burra vira `div` sem handler (`readOnly`); gate duplo por defesa em profundidade. */
function onDaySlotClick(slot: DaySlotView): void {
  if (agenda.readonly.value) return;
  const date = toLocalDateString(agenda.range.value.start, timezone.value);
  // a célula é uma HORA cheia; o form quer "HH:mm"
  openCreateOn(date, `${slot.hour}:00`);
}

/** Clique na célula vazia da coluna da Semana: criar NAQUELE dia+hora
 *  (mesmo gate C.18 do Dia). */
function onWeekCellClick(dateKey: string, hour: string): void {
  if (agenda.readonly.value) return;
  openCreateOn(dateKey, `${hour}:00`);
}

/** Abre os detalhes (própria OU emprestada): o painel se apresenta conforme a
 *  fonte — na emprestada é somente-leitura com o marcador "de ‹dono›" (C.18/C.20). */
function openDetails(item: AgendaItem): void {
  detailsItem.value = item;
  confirmDelete.value = false;
}

function closeDetails(): void {
  detailsItem.value = null;
  confirmDelete.value = false;
}

function editFromDetails(): void {
  // defensivo: o botão Editar nem existe na fonte emprestada (C.18)
  if (!detailsItem.value || agenda.readonly.value) return;
  formMode.value = 'edit';
  // seguro: o gate acima garante fonte própria ⇒ o item é `AppointmentDto`
  editing.value = asOwn(detailsItem.value);
  preset.value = undefined;
  formSession.value += 1;
  formOpen.value = true;
  closeDetails();
}

// ---- Drag-and-drop (plano grades-dia-semana-mes, Etapa 2.3) ----
// Composição: a mecânica é do hook, a regra é do schedule-core (via composable),
// o conflito reabre o Reagendamento Assistido (modal de edição no horário
// candidato). ZERO cálculo de data aqui (E.4).
const agendaDrag = useAgendaDrag({
  timezone: () => timezone.value,
  now: () => agenda.now.value,
  days: () =>
    agenda.view.value === 'day'
      ? agenda.hourCells.value
      : agenda.view.value === 'week'
        ? agenda.rows.value
        : agenda.cells.value,
  originOf: (item) => dropOriginKey(agenda.view.value === 'year' ? 'month' : agenda.view.value, item, timezone.value),
  onConflict: openRelocationFromDrop,
  // C.18/D9: gate do gesto — fonte emprestada ⇒ pointerdown no-op na origem
  readonly: () => agenda.readonly.value,
});

/** Drop com conflito: modal de EDIÇÃO do item no horário candidato + jogadas. */
function openRelocationFromDrop(req: { item: AppointmentDto; startsAt: Date; endsAt: Date }): void {
  formMode.value = 'edit';
  editing.value = req.item;
  preset.value = { date: req.startsAt, endsAt: req.endsAt, autoRelocate: true };
  formSession.value += 1;
  formOpen.value = true;
}

/** Salvo/jogado pelo modal: a mutation já invalidou a agenda; limpa o pendente. */
function onModalSaved(): void {
  agendaDrag.pendingRelocation.value = null;
}

async function doDelete(): Promise<void> {
  if (!detailsItem.value) return;
  await deleting.mutateAsync(detailsItem.value.id);
  toast.success('Compromisso excluído — os lembretes foram junto.');
  closeDetails();
}
</script>

