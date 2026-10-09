<template>
  <div>
    <p
      v-if="drag.previewLabel.value"
      class="text-xs tabular-nums text-muted-foreground"
      data-testid="drop-preview"
    >
      {{ drag.previewLabel.value }}
    </p>
    <!-- grade de células: cada uma é `[data-cell-key]` (o registry do hit-test);
         o fundo mantém o scroll — `touch-action: none` está SÓ no bloco (bind).
         CAIXAS VIA ATRIBUTO `data-box` (nada de style inline): em teste o harness
         instala `getBoundingClientRect` a partir delas; no browser o layout é real
         e `elementFromPoint` resolve. A view só conhece as coords porque é um
         host de teste; a AgendaPage de verdade não passa nada disso. -->
    <div
      class="flex gap-1"
      data-testid="cell-board"
    >
      <div
        v-for="(cell, ci) in cells"
        :key="cell.key"
        :data-cell-key="cell.key"
        :data-testid="`cell-${cell.key}`"
        :data-box="`${ci * 100},0,100,40`"
        class="cell h-10 w-16 border border-border"
        :data-drop-target="dropTargetAttr(cell.key)"
      />
    </div>
    <!-- bloco arrastável: TODA a mecânica vem do hook via v-bind (a view não sabe
         nada de drag); o clique continua o caminho normal do bloco -->
    <button
      v-for="item in items"
      :key="item.id"
      type="button"
      class="block min-h-11 rounded border border-border p-1 text-left"
      :class="drag.draggingId.value === item.id ? 'opacity-40' : ''"
      :data-testid="`block-${item.id}`"
      data-box="0,60,100,44"
      v-bind="drag.bind(item)"
      @click="clicked.push(item.id)"
    >
      {{ item.title }}
    </button>
    <!-- o FANTASMA é montado/posicionado/removido pelo hook direto no body (nó de
         DOM puro — sem vnode); a view renderiza só o PREVIEW de destino acima -->
    <p data-testid="drop-log">
      {{ log }}
    </p>
    <p data-testid="cancel-log">
      {{ canceled }}
    </p>
  </div>
</template>

<script setup lang="ts">
/**
 * HOST DE TESTE do hook `useDragAppointment` (padrão da casa: a página é burra, a
 * mecânica mora no hook). Este componente NÃO é shipped — mora em `tests/helpers`
 * e existe só para exercitar a mecânica com PointerEvents reais no happy-dom
 * (threshold, ESC, drop na origem, fora de célula, fantasma, `data-drop-target`).
 */
import { ref } from 'vue';
import { useDragAppointment } from '../../src/app/composables/useDragAppointment';

interface BoardItem {
  id: string;
  title: string;
}

const props = defineProps<{
  items: BoardItem[];
  cells: { key: string }[];
  /** id → célula de origem (a página calcula; aqui é tabela fixa do teste). */
  origins?: Record<string, string>;
}>();

const log = ref('');
const canceled = ref('');
const clicked = ref<string[]>([]);

const drag = useDragAppointment<BoardItem>({
  onDrop: (item, cellKey) => {
    log.value = `drop:${item.id}:${cellKey}`;
  },
  onCancel: (item) => {
    canceled.value = `cancel:${item.id}`;
  },
  cellLabel: (cellKey) => `alvo ${cellKey}`,
  originOf: (item) => props.origins?.[item.id] ?? props.cells[0]!.key,
  ghostTextOf: (item) => item.title,
});

/** A view reage a `data-drop-target="true|false"` (classe via atributo de dados). */
function dropTargetAttr(key: string): 'true' | 'false' {
  return drag.targetKey.value === key ? 'true' : 'false';
}

defineExpose({ drag, log, canceled, clicked });
</script>
