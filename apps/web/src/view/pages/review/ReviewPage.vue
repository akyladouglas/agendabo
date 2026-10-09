<template>
  <AppLayout>
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h1 class="title-page">
          Revisão
        </h1>
        <AppBadge
          v-if="items.length"
          tone="warning"
          data-testid="review-count"
        >
          {{ items.length }} pendente{{ items.length === 1 ? '' : 's' }}
        </AppBadge>
      </div>
      <p class="text-sm text-muted-foreground">
        Compromissos que o bot não entendeu com confiança. Revise, corrija se
        preciso e aprove — ou descarte.
      </p>

      <!-- erro -->
      <div
        v-if="reviewQuery.isError.value"
        class="flex flex-col items-start gap-3 rounded-lg border border-danger/60 bg-danger/10 p-4"
        role="alert"
      >
        <p class="text-sm text-danger">
          Não foi possível carregar a fila de revisão.
        </p>
        <AppButton
          variant="outline"
          size="sm"
          @click="reviewQuery.refetch()"
        >
          Tentar de novo
        </AppButton>
      </div>

      <!-- skeleton -->
      <div
        v-else-if="reviewQuery.isPending.value"
        class="flex flex-col gap-3"
      >
        <AppSkeleton class="h-32" />
        <AppSkeleton class="h-32" />
      </div>

      <!-- vazio -->
      <div
        v-else-if="items.length === 0"
        class="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-14 text-center"
        data-testid="review-empty"
      >
        <ShieldCheck
          class="h-9 w-9 text-primary"
          aria-hidden="true"
        />
        <p class="text-sm font-medium text-foreground">
          Nada para revisar ✅
        </p>
        <p class="text-xs text-muted-foreground">
          Quando o bot não tiver certeza sobre um compromisso, ele aparece aqui.
        </p>
      </div>

      <!-- fila -->
      <ul
        v-else
        class="flex flex-col gap-3"
      >
        <li
          v-for="item in items"
          :key="item.id"
          class="rounded-lg border border-border border-l-4 border-l-warning bg-card p-4"
        >
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="min-w-0">
              <h2 class="truncate text-sm font-semibold text-foreground">
                {{ item.title }}
              </h2>
              <p class="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                <Clock
                  class="h-3.5 w-3.5 shrink-0"
                  aria-hidden="true"
                />
                {{ when(item) }}
              </p>
            </div>
            <AppBadge tone="warning">
              pendente de revisão
            </AppBadge>
          </div>

          <figure class="mt-3 rounded-md border-l-2 border-border bg-surface-2 px-3 py-2">
            <blockquote class="text-sm italic text-foreground">
              “{{ item.rawText }}”
            </blockquote>
            <figcaption
              v-if="item.reviewReason"
              class="mt-1 text-xs text-muted-foreground"
            >
              motivo: {{ item.reviewReason }}
            </figcaption>
          </figure>

          <!-- descartar em 2 passos (A.9) -->
          <div
            v-if="dismissingId === item.id"
            class="mt-3 flex flex-wrap items-center justify-end gap-2 rounded-md border border-danger/40 bg-danger/5 p-2"
            role="alertdialog"
            aria-label="Confirmar descarte"
          >
            <span class="mr-auto text-sm text-foreground">
              Descartar “{{ item.title }}”?
            </span>
            <AppButton
              variant="outline"
              size="sm"
              @click="dismissingId = null"
            >
              <X
                class="h-4 w-4"
                aria-hidden="true"
              />
              Cancelar
            </AppButton>
            <AppButton
              variant="destructive"
              size="sm"
              :disabled="dismissMutation.isPending.value"
              @click="dismiss(item)"
            >
              Descartar
            </AppButton>
          </div>

          <div
            v-else
            class="mt-3 flex flex-wrap gap-2"
          >
            <AppButton
              size="sm"
              :disabled="approvingId === item.id"
              data-testid="review-approve"
              @click="approve(item)"
            >
              <Check
                class="h-4 w-4"
                aria-hidden="true"
              />
              Aprovar
            </AppButton>
            <AppButton
              variant="soft"
              size="sm"
              @click="openCorrection(item)"
            >
              <Pencil
                class="h-4 w-4"
                aria-hidden="true"
              />
              Corrigir
            </AppButton>
            <AppButton
              variant="ghost"
              size="sm"
              class="text-danger"
              @click="dismissingId = item.id"
            >
              <Trash2
                class="h-4 w-4"
                aria-hidden="true"
              />
              Descartar
            </AppButton>
          </div>
        </li>
      </ul>
    </div>

    <!-- corrigir = mesmo modal do criar (D4); conflito mantém o item na fila -->
    <AppointmentModal
      v-if="correcting && correctingOpen"
      v-model:open="correctingOpen"
      mode="review"
      :appointment="correcting"
    />
  </AppLayout>
</template>

<script setup lang="ts">
/**
 * Fila de revisão (Fase 5, spec A.9/A.10): mais recente primeiro; card com o
 * proposto + fala original citada (`rawText`) + motivo (`reviewReason`).
 * Aprovar = 1 clique (confirm com valores atuais); Corrigir = o MESMO modal do
 * criar (D4); Descartar = 2 passos. Vazio = "Nada para conferir ✅".
 */
import { computed, ref } from 'vue';
import { Check, Clock, Pencil, ShieldCheck, Trash2, X } from 'lucide-vue-next';
import { toast } from 'vue-sonner';
import type { ReviewAppointmentDto } from '@agendabo/contracts';
import { useAuthStore } from '@/app/store/authStore';
import { useReviewQuery } from '@/app/composables/queries/useReview.query';
import { useConfirmReviewMutation } from '@/app/composables/mutations/useConfirmReview.mutation';
import { useDismissReviewMutation } from '@/app/composables/mutations/useDismissReview.mutation';
import { conflictMessage } from '@/app/utils/conflict';
import { formatDayHeading, formatRangeInTz } from '@/app/utils/tz';
import AppLayout from '@/view/layouts/AppLayout.vue';
import AppBadge from '@/view/components/ui/badge/Badge.vue';
import AppButton from '@/view/components/ui/button/Button.vue';
import AppSkeleton from '@/view/components/ui/skeleton/Skeleton.vue';
import AppointmentModal from '@/view/components/appointment/AppointmentModal.vue';

const auth = useAuthStore();
const timezone = computed(() => auth.user?.timezone ?? 'UTC');

const reviewQuery = useReviewQuery();
const confirmMutation = useConfirmReviewMutation();
const dismissMutation = useDismissReviewMutation();

/** Mais recente primeiro (criado por último no topo). */
const items = computed(() =>
  [...(reviewQuery.data.value?.items ?? [])].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  ),
);

const correcting = ref<ReviewAppointmentDto | null>(null);
const correctingOpen = ref(false);
const dismissingId = ref<string | null>(null);
const approvingId = ref<string | null>(null);

function when(item: ReviewAppointmentDto): string {
  const h = formatDayHeading(item.startsAt, timezone.value, new Date());
  return `${h.weekday} ${h.label} · ${formatRangeInTz(item.startsAt, item.endsAt, timezone.value)}`;
}

/** Aprovar 1-clique: confirm com os valores atuais (spec A.9). */
async function approve(item: ReviewAppointmentDto): Promise<void> {
  approvingId.value = item.id;
  try {
    await confirmMutation.mutateAsync({
      id: item.id,
      title: item.title,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
    });
    toast.success('Aprovado — entrou na agenda.');
  } catch (err) {
    toast.error(conflictMessage(err) ?? 'Algo deu errado, tente de novo.');
  } finally {
    approvingId.value = null;
  }
}

function openCorrection(item: ReviewAppointmentDto): void {
  correcting.value = item;
  correctingOpen.value = true;
}

async function dismiss(item: ReviewAppointmentDto): Promise<void> {
  await dismissMutation.mutateAsync(item.id);
  dismissingId.value = null;
  toast.success('Descartado.');
}
</script>
