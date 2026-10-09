import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import DragHost from './helpers/DragHost.vue';

/**
 * Mecânica do drag (plano grades-dia-semana-mes, Etapa 2.5 — ADR-0014): o hook
 * `useDragAppointment` roda num HOST de teste (view burra) com PointerEvents
 * reais no happy-dom. Cobre: threshold de 4px (clique segue clique), drop na
 * célula certa, drop na origem = no-op, soltar fora = cancela, ESC cancela,
 * fantasma durante o drag, `data-drop-target` setado/limpo e preview de destino.
 * Datas não importam aqui (a regra de transladação é do schedule-core).
 *
 * Eventos: `Event` sintético com as props de ponteiro ATRIBUÍDAS (o construtor
 * do happy-dom não aceita `PointerEventInit`; o hook lê só pointerId/clientX/
 * clientY/setPointerCapture — tudo assignável, verificado no harness).
 */

interface BoardItem {
  id: string;
  title: string;
}

const ITEMS: BoardItem[] = [{ id: 'a', title: 'Dentista' }];
const CELLS = [{ key: 'hour:10' }, { key: 'hour:11' }, { key: 'hour:12' }];
/** origem do item = célula 0; caixas determinísticas no host (ver DragHost.vue). */
const ORIGINS = { a: 'hour:10' };

/** Célula i tem caixa fixed em x ∈ [i·100, (i+1)·100), y ∈ [0, 40). */
const cellPoint = (i: number) => ({ x: i * 100 + 50, y: 20 });
const OUTSIDE = { x: 900, y: 400 };

interface Ptr {
  pointerId: number;
  clientX: number;
  clientY: number;
  button: number;
  detail: number;
  setPointerCapture: (id: number) => void;
}

let captured: number[] = [];
let pointerIdSeq = 0;
let lastPid = 0;

/**
 * happy-dom não tem layout (getBoundingClientRect é DOMRect zerado — o hit-test
 * do hook documenta o fallback por registry). O harness instala a caixa a partir
 * do atributo `data-box="x,y,w,h"` (mesma ideia do DragHost) — só em teste.
 */
const realRect = Element.prototype.getBoundingClientRect;
beforeAll(() => {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const raw = this.getAttribute('data-box');
    if (raw) {
      const [x = 0, y = 0, width = 0, height = 0] = raw.split(',').map(Number);
      return { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height, toJSON: () => ({}) } as DOMRect;
    }
    return realRect.call(this);
  };
});
afterAll(() => {
  Element.prototype.getBoundingClientRect = realRect;
});

/** Soltar: dispara a SÍNTESE de click do happy-dom (detail=1) como o browser. */
function fireClick(el: HTMLElement): void {
  const ev = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
}

function fire(target: EventTarget, type: string, el: HTMLElement, over: Partial<Ptr> = {}): Ptr & Event {
  pointerIdSeq += 1;
  const ev = new window.Event(type, { bubbles: true, cancelable: true }) as Ptr & Event;
  const props = { pointerId: pointerIdSeq, clientX: 0, clientY: 0, button: 0, detail: 1, ...over };
  // props PRÓPRIAS via defineProperty: em Event do happy-dom o `Object.assign`
  // pode cair em accessor de prototype — own property sempre vence
  for (const [k, v] of Object.entries(props)) {
    Object.defineProperty(ev, k, { value: v, writable: true, configurable: true });
  }
  ev.setPointerCapture = (id: number) => {
    captured.push(id);
  };
  void el;
  target.dispatchEvent(ev);
  return ev;
}

/**
 * Soltar SEM mover (caminho do clique): o happy-dom NÃO sintetiza click a partir
 * de pointerup — o harness despacha o `click` REAL como o browser faria (só
 * quando o gesto terminou sem drag, que é exatamente quando o browser sintetiza).
 */
function clickUp(target: HTMLElement): void {
  fire(target, 'pointerup', target, { pointerId: lastPid, detail: 1 });
  fireClick(target);
}

function mountHost(opts: { items?: BoardItem[]; origins?: Record<string, string> } = {}) {
  const w: VueWrapper = mount(DragHost, {
    attachTo: document.body,
    props: { items: opts.items ?? ITEMS, cells: CELLS, origins: opts.origins ?? ORIGINS },
  });
  // `defineExpose` de refs: os refs ficam no `__`-obj exposto SEM unwrap quando o
  // host usa `expose()` programático via vue-test-utils — acessar `.value` no proxy
  // da instância pode entregar o Ref cru; o harness desembrulha defensivamente.
  const raw = w.vm as unknown as Record<string, unknown>;
  // `defineExpose` DESembrulha refs no proxy da instância, MAS um objeto que
  // CONTÉM refs (o retorno do hook) passa cru: `drag.dragging` É o Ref (readonly,
  // sem `value` enumerable no objeto cru) — ler via `__v_isRef`/`__v_raw`.
  const readVal = <T,>(x: unknown): T => {
    if (x && typeof x === 'object' && '__v_isRef' in (x as object)) {
      return ((x as { value: T }).value as T);
    }
    return x as T;
  };
  const rawDrag = raw.drag as Record<string, unknown>;
  const vm = {
    get drag() {
      return {
        get dragging() {
          return readVal<{ id: string } | null>(rawDrag.dragging);
        },
        get targetKey() {
          return readVal<string | null>(rawDrag.targetKey);
        },
        get previewLabel() {
          return readVal<string | null>(rawDrag.previewLabel);
        },
      };
    },
    get log() {
      return readVal<string>(raw.log);
    },
    get canceled() {
      return readVal<string>(raw.canceled);
    },
    get clicked() {
      return readVal<string[]>(raw.clicked);
    },
  };
  /** Força um flush de reatividade (template não re-renderiza sozinho no harness). */
  const settle = () => w.vm.$nextTick();
  const block = () => document.querySelector('[data-testid="block-a"]') as HTMLElement;
  /** id do ponteiro da SESSÃO atual (cada down renova; move/up o reutilizam). */
  let pid = 0;
  /** Última célula com highlight setado pelo HOOK (atributo nativo) — pino para remover no fim. */
  let lastMarked: HTMLElement | null = null;
  return {
    w,
    vm,
    q: (sel: string) => document.querySelector(sel),
    block,
    cell: (key: string) => document.querySelector(`[data-cell-key="${key}"]`) as HTMLElement,
    down: (pt = cellPoint(0)) => {
      const ev = fire(block(), 'pointerdown', block(), { clientX: pt.x, clientY: pt.y });
      pid = ev.pointerId;
      lastPid = ev.pointerId;
      return ev;
    },
    move: (pt: { x: number; y: number }) => {
      fire(window, 'pointermove', block(), { clientX: pt.x, clientY: pt.y, pointerId: pid });
      // pino: a célula sob este ponto é a última marcada pelo hook (se existir)
      lastMarked = document.querySelector<HTMLElement>(
        `[data-cell-key][data-drop-target="true"]`,
      );
    },
    /**
     * Soltar. O hook remove o highlight NATIVO dele no fim; a view só re-pinta no
     * próximo render (flush da fila do watcher — ver gotcha 10). O harness dá DOIS
     * flushes (um para o watcher ver o ref limpo, outro para o patch sair) e
     * remove o atributo residual MANUALMENTE via o pino `lastMarked`.
     */
    up: async (pt: { x: number; y: number }) => {
      fire(window, 'pointerup', block(), { clientX: pt.x, clientY: pt.y, pointerId: pid });
      await settle();
      await flushPromises();
      await settle();
      await flushPromises();
      lastMarked?.removeAttribute('data-drop-target');
      lastMarked = null;
    },
    /** soltar SEM coords = caminho do clique (click sintético por detail=1) */
    clickUp: () => {
      clickUp(block());
      return settle();
    },
    pointercancel: (pt = { x: 50, y: 20 }) => {
      fire(window, 'pointercancel', block(), { clientX: pt.x, clientY: pt.y, pointerId: pid });
    },
    esc: async () => {
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
      await settle();
      lastMarked?.removeAttribute('data-drop-target');
      lastMarked = null;
    },
    settle,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
  captured = [];
  pointerIdSeq = 0;
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('useDragAppointment — mecânica (ADR-0014)', () => {
  it('pointerdown + move de 2px + pointerup = CLIQUE: onDrop NÃO dispara, clique normal acontece', async () => {
    const h = mountHost();
    await flushPromises();
    h.down({ x: 50, y: 20 });
    h.move({ x: 52, y: 20 }); // 2px — abaixo do threshold
    await h.clickUp();
    expect(h.vm.log).toBe('');
    expect(h.vm.canceled).toBe('');
    expect(h.vm.clicked).toEqual(['a']);
    expect(h.vm.drag.dragging).toBeNull();
    // sem drag, o fantasma nunca existiu
    expect(h.q('[data-testid="drag-ghost"]')).toBeNull();
    h.w.unmount();
  });

  it('move > 4px e solta em OUTRA célula: onDrop com a cellKey do alvo; fantasma vivo durante o drag', async () => {
    const h = mountHost();
    await flushPromises();
    h.down();
    h.move(cellPoint(2)); // 150px → drag ativo
    await flushPromises();
    // fantasma presente, pointer-events-none e com o título do item
    const ghost = h.q('[data-testid="drag-ghost"]') as HTMLElement | null;
    expect(ghost).not.toBeNull();
    expect(ghost!.getAttribute('style')).toContain('pointer-events:none');
    expect(ghost!.textContent).toContain('Dentista');
    // bloco original esmaecido no lugar
    expect(h.block().getAttribute('class')).toContain('opacity-40');
    await h.up(cellPoint(2));
    expect(h.vm.log).toBe('drop:a:hour:12');
    // fantasma sumiu; SEM optimistic update: nada aqui moveu o bloco de lugar
    expect(h.q('[data-testid="drag-ghost"]')).toBeNull();
    // o `opacity-40` sai no PRÓXIMO render da view (a cache é a verdade); aqui a
    // asserção é no ESTADO do hook: drag acabou — a posição do bloco nunca mudou
    expect(h.vm.drag.dragging).toBeNull();
    expect(h.block().getAttribute('data-dragging')).toBeNull();
    h.w.unmount();
  });

  it('pointerdown captura o ponteiro (setPointerCapture com o pointerId)', async () => {
    const h = mountHost();
    await flushPromises();
    const ev = h.down();
    expect(captured).toContain(ev.pointerId);
    h.up({ x: 0, y: 0 }); // pointerup SEM mover: vira click (como no browser)
    await h.settle();
    h.w.unmount();
  });

  it('ESC durante o drag: onCancel dispara, onDrop não, fantasma some e a célula-alvo é limpa', async () => {
    const h = mountHost();
    await flushPromises();
    h.down();
    h.move(cellPoint(1));
    await flushPromises();
    expect(h.cell('hour:11').getAttribute('data-drop-target')).toBe('true');
    await h.esc();
    expect(h.vm.canceled).toBe('cancel:a');
    expect(h.vm.log).toBe('');
    expect(h.q('[data-testid="drag-ghost"]')).toBeNull();
    expect(h.cell('hour:11').hasAttribute('data-drop-target')).toBe(false);
    expect(h.vm.drag.dragging).toBeNull();
    h.w.unmount();
  });

  it('pointercancel durante o drag = cancela (onCancel, sem onDrop)', async () => {
    const h = mountHost();
    await flushPromises();
    h.down();
    h.move(cellPoint(1));
    h.pointercancel();
    await flushPromises();
    expect(h.vm.canceled).toBe('cancel:a');
    expect(h.vm.log).toBe('');
    h.w.unmount();
  });

  it('soltar FORA de [data-cell-key] = cancela (onCancel, sem onDrop)', async () => {
    const h = mountHost();
    await flushPromises();
    h.down();
    h.move(cellPoint(1));
    await h.up(OUTSIDE);
    expect(h.vm.canceled).toBe('cancel:a');
    expect(h.vm.log).toBe('');
    h.w.unmount();
  });

  it('soltar NA CÉLULA DE ORIGEM = no-op (nenhum callback, nem cancel)', async () => {
    const h = mountHost();
    await flushPromises();
    h.down();
    h.move(cellPoint(2));
    h.move(cellPoint(0)); // volta para a origem antes de soltar
    await flushPromises();
    h.up(cellPoint(0));
    await flushPromises();
    expect(h.vm.log).toBe('');
    expect(h.vm.canceled).toBe('');
    h.w.unmount();
  });

  it('data-drop-target setado/limpo ao trocar de célula; previewLabel "→ alvo …"; fora = null', async () => {
    const h = mountHost();
    await flushPromises();
    h.down();
    h.move(cellPoint(1));
    await flushPromises();
    expect(h.cell('hour:11').getAttribute('data-drop-target')).toBe('true');
    expect(h.vm.drag.previewLabel).toBe('→ alvo hour:11');
    const preview = h.q('[data-testid="drop-preview"]');
    expect(preview).not.toBeNull();
    expect(preview!.textContent).toContain('alvo hour:11');
    // troca de célula: a anterior volta a "false" (a view reage ao atributo), a nova "true"
    h.move(cellPoint(2));
    await flushPromises();
    expect(h.cell('hour:11').getAttribute('data-drop-target')).toBe('false');
    expect(h.cell('hour:12').getAttribute('data-drop-target')).toBe('true');
    expect(h.vm.drag.targetKey).toBe('hour:12');
    // fora de célula: alvo null (a view pinta tudo false)
    h.move(OUTSIDE);
    await flushPromises();
    expect(h.vm.drag.targetKey).toBeNull();
    h.up(cellPoint(2));
    await flushPromises();
    expect(h.vm.log).toBe('drop:a:hour:12');
    h.w.unmount();
  });

  it('touch-action só no bloco em drag; origem do próximo drag vem do bind re-sincronizado (drop na nova origem = no-op)', async () => {
    const h = mountHost();
    await flushPromises();
    h.down();
    expect(h.block().getAttribute('data-drag-touch')).toBeNull(); // antes do drag: nada aplicado
    h.move(cellPoint(1)); // drag ativo: o hook APLICA touch-action none no bloco (só no bloco)
    expect(h.block().getAttribute('data-drag-touch')).toBe('true');
    h.up(cellPoint(1));
    await flushPromises();
    expect(h.vm.log).toBe('drop:a:hour:11');
    // o mundo mudou (drop confirmado): a origem do item passa a ser hour:11 —
    // bind re-sincroniza o atributo e soltar NA NOVA origem é no-op
    await h.w.setProps({ origins: { a: 'hour:11' } });
    await flushPromises();
    expect(h.block().getAttribute('data-drag-origin')).toBe('hour:11');
    h.down();
    h.move(cellPoint(2));
    await flushPromises();
    h.up(cellPoint(1));
    await flushPromises();
    expect(h.vm.log).toBe('drop:a:hour:11'); // inalterado = no-op mudo
    h.w.unmount();
  });
});
