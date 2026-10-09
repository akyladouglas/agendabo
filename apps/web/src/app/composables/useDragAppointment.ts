import { onScopeDispose, readonly, ref, type DeepReadonly, type Ref } from 'vue';


/**
 * Mecânica de DRAG-AND-DROP de compromisso (ADR-0014 — Pointer Events nativos,
 * sem lib): este hook cuida APENAS da mecânica — threshold, pointer capture,
 * fantasma, hit-test da célula-alvo (`[data-cell-key]` + `data-drop-target`),
 * cancelamento (ESC/`pointercancel`/fora de célula) e no-op na origem.
 *
 * Ele NÃO conhece regra de agenda nenhuma (nem conflito, nem horário, nem
 * duração): recebe callbacks (`onDrop`, `onCancel`, `cellLabel`). A posição do
 * bloco NUNCA muda por aqui — sem optimistic update: a cache é a verdade e só
 * a mutação confirmada move o bloco (regra de produto da Etapa 2).
 *
 * O fantasma é um NÓ DE DOM puro (não um vnode): a página o MONTA no corpo com
 * a ref `ghostEl` e o estilo `ghostStyle`; os updates de posição escrevem no
 * elemento direto (o teste o encontra por `[data-testid="drag-ghost"]`).
 */

export const DRAG_THRESHOLD_PX = 4;

/** Constantes locais ao módulo (convenção schedule-core: nomes únicos — gotcha 17). */
const DRAG_MOVE_MS = 32;
const GHOST_OFFSET_PX = 12;

export interface DragItemLike {
  id: string;
}

export interface DragPointerLike {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly button?: number;
  setPointerCapture?: (pointerId: number) => void;
}

export interface DragBindProps {
  class: string;
  'data-dragging': 'true' | undefined;
  'data-drag-block': 'true';
  'data-drag-item': string;
  'data-drag-origin': string;
  onPointerdown: (ev: DragPointerLike & Event) => void;
}

export interface UseDragAppointmentOptions<T extends DragItemLike> {
  /** Soltou SOBRE uma célula diferente da de origem: cellKey = `data-cell-key` do alvo. */
  onDrop: (item: T, cellKey: string) => void;
  /** Cancelou (ESC, `pointercancel` ou soltou fora de célula) — nada foi pedido. */
  onCancel?: (item: T) => void;
  /** Rótulo de destino do preview ("→ 18:00" / "→ qua 14/10"); ausente = só o título no fantasma. */
  cellLabel?: (cellKey: string) => string;
  /** Célula-origem do item (drop na origem = no-op). A view BURRA só injeta o valor pronto. */
  originOf?: (item: T) => string;
  /** Texto do fantasma (título + hora do item) — a página monta com dados dela. */
  ghostTextOf?: (item: T) => string;
}

/** Fantasma: estilo inline do hook (position/left/top virão a mais no mesmo atributo). */
const GHOST_BASE_STYLE =
  'z-index:60;pointer-events:none;max-width:240px;min-width:120px;border-radius:8px;' +
  'border:1px solid var(--border);background:var(--card);color:var(--foreground);padding:4px 8px;' +
  'font-size:12px;box-shadow:0 8px 24px rgb(0 0 0 / 0.35);';

/**
 * O que a VIEW BURRA recebe via `provide` (prop de componente não fica reativa):
 * só o `bind` (props/listeners do bloco), o `draggingId` PRIMITIVO (dirige a
 * classe esmaecida) e o `dropKey` da célula-alvo (dirige `data-drop-target`).
 */
export interface DragBindApi<T extends DragItemLike> {
  bind: (item: T) => DragBindProps;
  draggingId: DeepReadonly<Ref<string | null>>;
  dropKey: DeepReadonly<Ref<string | null>>;
}

export interface UseDragAppointment<T extends DragItemLike> {
  /** Item em drag (null = parado) — reativo. */
  dragging: DeepReadonly<Ref<T | null>>;
  /** id do item em drag (null = parado): use este PRIMITIVO na classe do bloco. */
  draggingId: DeepReadonly<Ref<string | null>>;
  /** Estilo do fantasma na última posição do ponteiro (também aplicado direto no nó). */
  ghostStyle: Ref<Record<string, string>>;
  /** `data-cell-key` da célula-alvo sob o ponteiro (null = fora de célula). */
  targetKey: Ref<string | null>;
  /** Preview de destino ("→ 18:00"): rótulo da célula-alvo (ou null). */
  previewLabel: Ref<string | null>;
  /** Ref do elemento fantasma (o hook monta o nó no body; exposta por inspeção). */
  ghostEl: Ref<HTMLElement | null>;
  /** Props/listeners que a view BURRA aplica no bloco arrastável (`v-bind`). */
  bind: (item: T) => DragBindProps;
  /** Texto do fantasma do item em drag ('' quando parado — a página só formata). */
  ghostText: () => string;
  /** O pacote que as grades burras consomem (bind + primitivos, nada além). */
  viewApi: DragBindApi<T>;
}

/** O hook só aceita mouse/botão esquerdo/toque/caneta — direito/middle não arrastam. */
function isMainPointer(ev: DragPointerLike): boolean {
  return ev.button === undefined || ev.button === 0;
}

/**
 * Hit-test determinístico do ADR-0014: a célula `[data-cell-key]` sob o ponteiro.
 * Em browser real, `document.elementFromPoint` + `closest('[data-cell-key]')`.
 * Em teste (happy-dom não tem layout — `elementFromPoint` devolve `null` e toda
 * caixa é zero), o registry `[data-cell-key]` é percorrido comparando a caixa do
 * harness: `getBoundingClientRect` instalado pelo teste a partir de `data-box`
 * ("x,y,w,h") ou `__box`. Browser real nunca cai aqui quando o hit tem caixa.
 */
export function cellKeyUnderPoint(clientX: number, clientY: number): { key: string; el: HTMLElement } | null {
  if (typeof document === 'undefined') return null;
  const under =
    typeof document.elementFromPoint === 'function'
      ? document.elementFromPoint(clientX, clientY)
      : null;
  const viaPoint = under?.closest?.('[data-cell-key]') ?? null;
  if (viaPoint && hasBox(viaPoint as HTMLElement)) return asHit(viaPoint as HTMLElement);
  const cells = document.querySelectorAll<HTMLElement>('[data-cell-key]');
  for (const cell of cells) {
    const r = cell.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && clientX >= r.left && clientX < r.right && clientY >= r.top && clientY < r.bottom) {
      return asHit(cell);
    }
  }
  return null;
}

/** Caixa da célula para o fallback do registry: `data-box`/`__box` do harness. */
export function elementTestBox(el: HTMLElement): { left: number; top: number; width: number; height: number } | null {
  const raw =
    el.getAttribute('data-box') ??
    (el as unknown as { __box?: string }).__box ??
    null;
  if (!raw) return null;
  const [left, top, width, height] = raw.split(',').map(Number);
  if ([left, top, width, height].some((n) => !Number.isFinite(n))) return null;
  return { left: left!, top: top!, width: width!, height: height! };
}

function hasBox(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function asHit(el: HTMLElement): { key: string; el: HTMLElement } | null {
  const key = el.getAttribute('data-cell-key');
  return key ? { key, el } : null;
}

export function useDragAppointment<T extends DragItemLike>(
  options: UseDragAppointmentOptions<T>,
): UseDragAppointment<T> {
  const dragging = ref<T | null>(null) as Ref<T | null>;
  /** Marca ref-driven: a view usa `draggingId` (primitivo) para a classe do bloco. */
  const draggingId = ref<string | null>(null);
  const targetKey = ref<string | null>(null);
  const previewLabel = ref<string | null>(null);
  const ghostStyle = ref<Record<string, string>>({});
  const ghostEl = ref<HTMLElement | null>(null);

  /** Sessão de press (antes do threshold): pointerdown ainda NÃO é drag — pode ser clique. */
  interface PressState {
    item: T;
    pointerId: number;
    originKey: string | null;
    originX: number;
    originY: number;
    startX: number;
    startY: number;
    pointermove: (ev: Event) => void;
    pointerup: (ev: Event) => void;
    pointercancel: (ev: Event) => void;
  }
  let press: PressState | null = null;
  let targetEl: HTMLElement | null = null;
  let lastMove = 0;
  /** Guarda o `touch-action` inline anterior do bloco (restaurado no fim da sessão). */
  let originTouchAction: string | null = null;

  /** `touch-action: none` no bloco (nunca no bind estático — ver o head do arquivo). */
  function blockOf(id: string): HTMLElement | null {
    const sel =
      typeof CSS !== 'undefined' && CSS.escape ? `[data-drag-item="${CSS.escape(id)}"]` : `[data-drag-item="${id}"]`;
    return document.querySelector(sel);
  }

  function setBlockTouch(el: HTMLElement | null, value: string): void {
    if (!el) return;
    try {
      el.style.touchAction = value;
    } catch {
      /* ambiente sem CSSStyleDeclaration completo (harness) */
    }
    // trilha inspecionável (happy-dom não serializa style de bind — ver testes)
    el.setAttribute('data-drag-touch', value === '' ? 'restored' : 'true');
  }

  function clearTargetHighlight(): void {
    targetEl?.removeAttribute('data-drop-target');
    targetEl = null;
    targetKey.value = null;
    previewLabel.value = null;
  }

  function setTarget(hit: { key: string; el: HTMLElement } | null): void {
    if (hit && targetEl === hit.el && targetKey.value === hit.key) return;
    targetEl?.removeAttribute('data-drop-target');
    targetEl = null;
    if (!hit) {
      targetKey.value = null;
      previewLabel.value = null;
      return;
    }
    hit.el.setAttribute('data-drop-target', 'true');
    targetEl = hit.el;
    targetKey.value = hit.key;
    previewLabel.value = options.cellLabel ? `→ ${options.cellLabel(hit.key)}` : '→ soltar aqui';
  }

  function writeGhost(ev: { clientX: number; clientY: number }): void {
    const style: Record<string, string> = {
      position: 'fixed',
      left: `${ev.clientX + GHOST_OFFSET_PX}px`,
      top: `${ev.clientY + GHOST_OFFSET_PX}px`,
    };
    ghostStyle.value = style;
    const el = ghostEl.value;
    if (el) {
      el.setAttribute('data-x', String(ev.clientX));
      el.setAttribute('data-y', String(ev.clientY));
      el.setAttribute('style', `position:fixed;left:${style.left};top:${style.top};${GHOST_BASE_STYLE}`);
    }
  }

  /** A partir do threshold: vira DRAG — fantasma nasce no body, `touch-action: none` só no bloco. */
  function startDrag(p: PressState, ev: DragPointerLike): void {
    if (typeof document === 'undefined') return endPress();
    // o bloco pode ter sido re-renderizado no meio do gesto: re-localiza pelo id
    const el = blockOf(p.item.id);
    if (el) {
      el.setAttribute('data-dragging', 'true');
      // `touch-action: none` SÓ no bloco arrastável (o fundo da grade mantém o scroll)
      try {
        originTouchAction = el.style.touchAction;
      } catch {
        originTouchAction = '';
      }
      setBlockTouch(el, 'none');
    }
    const ghost = document.createElement('div');
    ghost.setAttribute('data-testid', 'drag-ghost');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.setAttribute('style', `position:fixed;${GHOST_BASE_STYLE}`);
    ghost.textContent = options.ghostTextOf ? options.ghostTextOf(p.item) : '';
    document.body.appendChild(ghost);
    ghostEl.value = ghost;
    writeGhost(ev);
    setTarget(cellKeyUnderPoint(p.startX, p.startY));
    // POR ÚLTIMO: expõe o item. A classe do bloco é DIRIGIDA POR PRIMITIVO
    // (`draggingId`) — o patch do watcher só troca a string da classe e NÃO
    // re-escreve os atributos imperativos (`data-dragging`, `touch-action`)
    // que foram postos no nó durante o gesto.
    dragging.value = p.item;
    draggingId.value = p.item.id;
    // o watcher da view pode ter RE-CRIADO o elemento no patch (mesmo key,
    // classe trocada — vue-test-utils); re-aplica a vestimenta no nó atual
    const el2 = blockOf(p.item.id);
    if (el2) {
      el2.setAttribute('data-dragging', 'true');
      setBlockTouch(el2, 'none');
    }
  }

  /** Devolve o fantasma ao body e apaga os atributos de drag (a posição real NUNCA mudou). */
  function cleanup(): void {
    clearTargetHighlight();
    ghostEl.value?.remove();
    ghostEl.value = null;
    ghostStyle.value = {};
  }

  /** Fim do GESTO: state ref + vestimenta do nó. O patch da classe pode re-criar o
   * elemento (troca completa do `class` no harness) — remove pelos DOIS nós possíveis. */
  function clearDragState(): void {
    const id = draggingId.value ?? press?.item.id ?? null;
    if (id) {
      for (const el of document.querySelectorAll(`[data-drag-item="${id}"]`)) {
        el.removeAttribute('data-dragging');
        setBlockTouch(el as HTMLElement, originTouchAction ?? '');
      }
    }
    originTouchAction = null;
    draggingId.value = null;
    dragging.value = null;
  }

  function detachWindow(): void {
    if (!press) return;
    window.removeEventListener('pointermove', press.pointermove);
    window.removeEventListener('pointerup', press.pointerup);
    window.removeEventListener('pointercancel', press.pointercancel);
    window.removeEventListener('keydown', onKeyDown);
  }

  function endPress(): void {
    detachWindow();
    press = null;
  }

  function cancelDrag(): void {
    const p = press;
    const item = dragging.value ?? p?.item ?? null;
    cleanup();
    endPress();
    if (item) options.onCancel?.(item);
    clearDragState();
  }

  function onKeyDown(ev: Event): void {
    if ((ev as KeyboardEvent).key === 'Escape') {
      ev.preventDefault();
      cancelDrag();
    }
  }

  /** Solta: origem = no-op mudo; fora de célula = cancela; senão = onDrop. */
  function finishDrag(ev: DragPointerLike): void {
    const p = press;
    const item = dragging.value ?? p?.item ?? null;
    const hit = cellKeyUnderPoint(ev.clientX, ev.clientY);
    const sameOrigin = hit !== null && p !== null && hit.key === p.originKey;
    cleanup();
    endPress();
    if (!item) {
      clearDragState();
      return;
    }
    if (sameOrigin || !hit) {
      // cancelamento silencioso (origem) ou cancelamento com aviso (fora)
      if (!sameOrigin) options.onCancel?.(item);
      clearDragState();
      return;
    }
    options.onDrop(item, hit.key);
    clearDragState();
  }

  function onPointerdown(item: T, ev: DragPointerLike & Event): void {
    // drag em andamento ou botão não-principal: não inicia nova sessão
    if (press || dragging.value || !isMainPointer(ev)) return;
    if (typeof document === 'undefined') return;
    const el = blockOf(item.id);
    const originKey = el?.getAttribute('data-drag-origin') ?? (options.originOf ? options.originOf(item) : '');
    // capture: mesmo que o ponteiro saia do bloco, os eventos continuam vindo
    ev.setPointerCapture?.(ev.pointerId);
    const state: PressState = {
      item,
      pointerId: ev.pointerId,
      originKey,
      originX: ev.clientX,
      originY: ev.clientY,
      startX: ev.clientX,
      startY: ev.clientY,
      pointermove: (mev: Event) => {
        const e = mev as unknown as DragPointerLike;
        if (e.pointerId !== state.pointerId) return;
        state.startX = e.clientX;
        state.startY = e.clientY;
        if (!dragging.value) {
          const dx = e.clientX - state.originX;
          const dy = e.clientY - state.originY;
          if (dx * dx + dy * dy > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) startDrag(state, e);
          return;
        }
        // throttle de DOM só para o fantasma; o hit-test SEMPRE roda no último ponto
        const nowMs = Date.now();
        if (nowMs - lastMove >= DRAG_MOVE_MS) {
          lastMove = nowMs;
          writeGhost(e);
        }
        setTarget(cellKeyUnderPoint(e.clientX, e.clientY));
      },
      pointerup: (uev: Event) => {
        const e = uev as unknown as DragPointerLike;
        if (e.pointerId !== state.pointerId) return;
        if (!dragging.value) {
          // ≤ threshold no pointerup: CLIQUE normal — nenhum callback de drag
          endPress();
          return;
        }
        writeGhost(e);
        finishDrag(e);
      },
      pointercancel: (cev: Event) => {
        if ((cev as unknown as DragPointerLike).pointerId !== state.pointerId) return;
        if (dragging.value) cancelDrag();
        else endPress();
      },
    };
    press = state;
    window.addEventListener('pointermove', state.pointermove);
    window.addEventListener('pointerup', state.pointerup);
    window.addEventListener('pointercancel', state.pointercancel);
    window.addEventListener('keydown', onKeyDown);
  }

  const bindCache = new Map<string, DragBindProps>();
  /**
   * `data-drag-origin` pode mudar SEM o id mudar (ex.: o item mudou de dia depois de
   * um drop cancelado/confirmado e a lista re-renderizou) — a cache guarda a origem
   * com que foi criada e sincroniza no bind (mutação segura: o valor é o MESMO
   * dentro do mesmo render).
   */
  function bind(item: T): DragBindProps {
    // cache por id: `v-bind` recriado a cada render chamaria setPointerCapture de novo
    const origin = options.originOf ? options.originOf(item) : '';
    let props = bindCache.get(item.id);
    if (!props) {
      props = {
        class: 'od-drag-block select-none',
        'data-dragging': undefined,
        'data-drag-block': 'true',
        'data-drag-item': item.id,
        'data-drag-origin': origin,
        onPointerdown: (ev: DragPointerLike & Event) => onPointerdown(item, ev),
      };
      bindCache.set(item.id, props);
    } else if (props['data-drag-origin'] !== origin) {
      props = { ...props, 'data-drag-origin': origin };
      bindCache.set(item.id, props);
    }
    return props;
  }

  onScopeDispose(() => {
    if (dragging.value) cancelDrag();
    endPress();
  });

  return {
    dragging: readonly(dragging) as DeepReadonly<Ref<T | null>>,
    draggingId: readonly(draggingId) as DeepReadonly<Ref<string | null>>,
    ghostStyle,
    targetKey,
    previewLabel,
    ghostEl,
    bind,
    /** Texto do fantasma do item (a página passa a formatação; o hook só guarda o item). */
    ghostText: () => (dragging.value && options.ghostTextOf ? options.ghostTextOf(dragging.value) : ''),
    /** O pacote que a view burra consome (as grades aceitam SÓ isto — a11y de tipos). */
    viewApi: {
      bind,
      draggingId: readonly(draggingId) as DeepReadonly<Ref<string | null>>,
      dropKey: readonly(targetKey) as DeepReadonly<Ref<string | null>>,
    } as DragBindApi<T>,
  };
}
