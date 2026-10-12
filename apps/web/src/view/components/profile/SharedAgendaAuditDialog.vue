<template>
  <div
    v-if="open && link"
    class="fixed inset-0 z-50"
    data-testid="shared-audit-dialog"
  >
    <div class="absolute inset-0 bg-black/60" />
    <div
      role="dialog"
      aria-modal="true"
      :aria-label="title"
      class="absolute inset-x-0 bottom-0 flex max-h-[94dvh] flex-col rounded-t-2xl border border-border bg-card p-4 shadow-xl md:inset-0 md:m-auto md:h-fit md:max-h-[80dvh] md:max-w-[560px] md:rounded-2xl"
    >
      <div class="flex items-center justify-between gap-2 border-b border-border pb-3">
        <h2 class="text-sm font-semibold text-foreground">
          {{ title }}
        </h2>
        <button
          type="button"
          class="flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Fechar"
          data-testid="audit-close"
          @click="emit('update:open', false)"
        >
          <X
            class="h-5 w-5"
            aria-hidden="true"
          />
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto py-4">
        <!-- estado de erro (F.7): visível + recuperável -->
        <div
          v-if="pageQuery.isError.value"
          class="flex items-center justify-between gap-3 rounded-md border border-danger/60 bg-danger/10 px-3 py-2"
          role="alert"
          data-testid="audit-error"
        >
          <p class="text-sm text-danger">
            Não foi possível carregar o histórico.
          </p>
          <AppButton
            variant="outline"
            size="sm"
            class="min-h-11"
            :disabled="pageQuery.isFetching.value"
            data-testid="audit-retry"
            @click="pageQuery.refetch()"
          >
            Tentar de novo
          </AppButton>
        </div>

        <!-- carregando (F.7): skeleton na página corrente -->
        <div
          v-else-if="pageQuery.isPending.value"
          class="flex flex-col gap-2"
          data-testid="audit-loading"
        >
          <AppSkeleton class="h-10" />
          <AppSkeleton class="h-10" />
          <AppSkeleton class="h-10" />
        </div>

        <template v-else>
          <!-- vazio (F.7) -->
          <p
            v-if="events.length === 0"
            class="text-sm text-muted-foreground"
            data-testid="audit-empty"
          >
            Nenhum evento neste compartilhamento ainda.
          </p>

          <!-- linha por evento: hora LOCAL + rótulo PT do kind (11 kinds) -->
          <ul
            v-else
            class="flex flex-col divide-y divide-border"
            data-testid="audit-list"
          >
            <li
              v-for="event in events"
              :key="event.id"
              class="flex flex-wrap items-baseline justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
              data-testid="audit-row"
            >
              <span class="text-sm text-foreground">
                {{ sharedAuditKindLabel(event.kind) }}
                <span
                  v-if="sharedAuditDetail(event.kind, event.metadata)"
                  class="text-xs text-muted-foreground"
                >· {{ sharedAuditDetail(event.kind, event.metadata) }}</span>
              </span>
              <span class="shrink-0 text-xs tabular-nums text-muted-foreground">
                {{ formatDateTimeInTz(event.occurredAt, timezone) }}
              </span>
            </li>
          </ul>

          <!-- paginação por cursor (F.4): "Carregar mais" ACUMULA a próxima página -->
          <div
            v-if="nextCursor"
            class="mt-3 flex justify-center"
          >
            <AppButton
              variant="outline"
              size="sm"
              class="min-h-11"
              :disabled="pageQuery.isFetching.value"
              data-testid="audit-more"
              @click="loadMore"
            >
              {{ pageQuery.isFetching.value ? 'Carregando…' : 'Carregar mais' }}
            </AppButton>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * "Histórico" de um vínculo compartilhado (spec F.4/D.21): GET /shared-agendas/
 * audit paginado por cursor com estados carregando/erro/vazio (F.7 — checklist
 * da feature). Os 11 kinds são traduzidos em PT-BR pelo utilitário puro
 * (`sharedAgendas.ts`); a metadata só carrega quantidades (zod `.strict()` na
 * API), então NUNCA aparece conteúdo de compromisso aqui.
 *
 * Painel PRÓPRIO (não o Dialog radix): o harness de testes roda com FocusScope
 * stubbado globalmente (gotcha 10) e o popper/portal do radix engoliria os
 * testes de estado (gotcha 19). Markup equivalente ao padrão bottom-sheet do
 * Dialog, com role/aria-modal/foco visível e alvos ≥44px (F.7).
 *
 * Paginação: `qk.sharedAudit(linkId, cursor)` é 1 página por chave; o painel
 * acumula as páginas consumidas em estado local e "Carregar mais" avança para o
 * `nextCursor`. O `queryKey` é um computado: fechar/abrir ou trocar de vínculo
 * zera o estado e volta ao cursor null.
 */
import { computed, ref, watch } from 'vue';
import { X } from 'lucide-vue-next';
import type { SharedAgendaListItem, SharedAuditPage } from '@agendabo/contracts';
import { useSharedAuditQuery } from '@/app/composables/queries/useSharedAudit.query';
import {
  sharedAuditDetail,
  sharedAuditKindLabel,
  sharedOwnerName,
} from '@/app/utils/sharedAgendas';
import { formatDateTimeInTz } from '@/app/utils/tz';
import AppButton from '@/view/components/ui/button/Button.vue';
import AppSkeleton from '@/view/components/ui/skeleton/Skeleton.vue';

const props = defineProps<{
  open: boolean;
  /** Vínculo cujo histórico se vê (id = filtro da query). */
  link: SharedAgendaListItem | null;
  /** Fuso do VISUALIZADOR (exibição na borda — ADR-002). */
  timezone: string;
}>();

const emit = defineEmits<{ 'update:open': [boolean] }>();

/** Título só com o que a listagem já mostra (dono p/ recebidos; papel p/ enviados). */
const title = computed(() =>
  props.link
    ? `Histórico — ${
        props.link.papel === 'owner'
          ? 'convite enviado'
          : `agenda de ${sharedOwnerName(props.link)}`
      }`
    : 'Histórico',
);

/** Cursor da página CORRENTE (null = 1ª). Estado local do painel. */
const cursor = ref<string | null>(null);
/** Eventos das páginas já consumidas (o "Carregar mais" acumula aqui). */
const accumulated = ref<SharedAuditPage['items']>([]);

const enabled = computed(() => props.open && props.link !== null);
const pageQuery = useSharedAuditQuery(() => props.link?.id ?? '', cursor, enabled);

// abrir de novo / trocar de vínculo: volta à 1ª página (nada de cursor velho)
watch(
  () => [props.open, props.link?.id] as const,
  ([open]) => {
    if (open) {
      cursor.value = null;
      accumulated.value = [];
    }
  },
);

const pageData = computed(() => (enabled.value ? pageQuery.data.value : undefined));
const events = computed(() => [...accumulated.value, ...(pageData.value?.items ?? [])]);
const nextCursor = computed(() => pageData.value?.nextCursor ?? null);

/** Consome a página corrente e pede a próxima pelo cursor opaco devolvido. */
function loadMore(): void {
  const data = pageData.value;
  if (!data?.nextCursor) return;
  accumulated.value = [...accumulated.value, ...data.items];
  cursor.value = data.nextCursor;
}
</script>
