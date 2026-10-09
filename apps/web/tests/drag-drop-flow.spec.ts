import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import type { AppointmentDto } from '@agendabo/contracts';
import * as appointmentsService from '../src/app/services/appointments';
import type { UseAgendaPage } from '../src/app/composables/useAgendaPage.composable';
import { useAuthStore } from '../src/app/store/authStore';
import AgendaPage from '../src/view/pages/agenda/AgendaPage.vue';

/**
 * Drop de compromisso (plano grades-dia-semana-mes, Etapa 2.5): a página resolve
 * a célula (`data-cell-key`) em novo intervalo via schedule-core e decide pela
 * API — SEM conflito: `reschedule` variante move pura (payload exato) + toast +
 * aria-live; COM conflito: o Reagendamento Assistido (Etapa 0) reabre no modal
 * de edição do item no horário candidato. Sempre SEM optimistic update (o bloco
 * só se move quando o cache confirmar). Harness do day-grid.spec.
 */

vi.mock('vue-sonner', () => ({
  toast: Object.assign(() => undefined, { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
vi.mock('../src/app/composables/queries/useReview.query', () => ({
  useReviewQuery: () => ({ data: { value: undefined } }),
}));

import { toast } from 'vue-sonner';

const TZ = 'America/Sao_Paulo';
const NOW = new Date('2026-10-08T12:00:00.000Z'); // qui 08/10 09:00 SP
const DENTISTA_ID = '11111111-1111-4111-8111-111111111111';

function appt(
  over: Partial<AppointmentDto> & Pick<AppointmentDto, 'id' | 'startsAt' | 'endsAt'>,
): AppointmentDto {
  return {
    title: 'Compromisso',
    notes: null,
    status: 'confirmed',
    origin: 'web',
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    ...over,
  };
}

/** Dentista 11:00–12:30 SP (14:00–15:30Z) em 08/10; 15/10 19:00 SP vazio. */
const FIXTURES: AppointmentDto[] = [
  appt({
    id: DENTISTA_ID,
    title: 'Dentista',
    startsAt: new Date('2026-10-08T14:00:00.000Z'),
    endsAt: new Date('2026-10-08T15:30:00.000Z'),
  }),
];

const list = vi.fn();
const checkConflict = vi.fn();
const reschedule = vi.fn();
const relocationOptions = vi.fn();
vi.spyOn(appointmentsService.appointmentsApi, 'list').mockImplementation(list);
vi.spyOn(appointmentsService.appointmentsApi, 'checkConflict').mockImplementation(checkConflict);
vi.spyOn(appointmentsService.appointmentsApi, 'reschedule').mockImplementation(reschedule);
vi.spyOn(appointmentsService.appointmentsApi, 'relocationOptions').mockImplementation(relocationOptions);

function mountAgenda(opts: { items?: AppointmentDto[] | null; view?: 'month' | 'week' | 'day' } = {}) {
  list.mockImplementation(async () => ({ items: 'items' in opts ? (opts.items ?? []) : FIXTURES }));
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().setUser({
    id: 'u1',
    email: 'ana@email.com',
    timezone: TZ,
    resumoDiarioHora: '08:00',
    resumoDiarioAtivo: true,
    name: 'Ana',
  });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }],
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, refetchOnWindowFocus: false } },
  });
  localStorage.setItem('agenda:anchor', '2026-10-08');
  localStorage.setItem('agenda:view', opts.view ?? 'month');
  delete (window as unknown as { __agenda?: unknown }).__agenda;
  const w = mount(AgendaPage, {
    attachTo: document.body,
    global: {
      stubs: {
        RouterLink: { props: { to: {} }, template: '<a><slot /></a>' },
        DialogPortal: { template: '<div><slot /></div>' },
        DialogOverlay: true,
        FocusScope: { template: '<div><slot /></div>' },
        FocusGuards: true,
      },
      plugins: [pinia, [VueQueryPlugin, { queryClient: qc }], router],
    },
  });
  const mounteds = globalThis as unknown as { __mounteds?: Array<{ unmount(): void }> };
  (mounteds.__mounteds ??= []).push(w);
  return {
    w,
    get agenda(): UseAgendaPage {
      const a = (window as unknown as { __agenda?: UseAgendaPage }).__agenda;
      if (!a) throw new Error('hook window.__agenda ausente (linha @test-hook)');
      return a;
    },
    unmount: () => w.unmount(),
  };
}

const settle = async () => {
  await flushPromises();
  await new Promise((r) => setTimeout(r, 30));
  await flushPromises();
};

/** Caixa determinística SÓ na célula-alvo. No harness, `getBoundingClientRect` não
 *  existe em nenhum elemento (happy-dom não faz layout) — o install no alvo é a
  *  ÚNICA caixa não-nula do documento, e o hit-test do hook para nele. */
function patchTargetBox(cellKey: string): void {
  const target = document.querySelector<HTMLElement>(`[data-cell-key="${cellKey}"]`);
  if (!target) throw new Error(`célula ${cellKey} ausente`);
  Object.defineProperty(target, 'getBoundingClientRect', {
    value: () => ({ x: 0, y: 0, width: 400, height: 60, left: 0, top: 0, right: 400, bottom: 60, toJSON: () => ({}) }),
    configurable: true,
  });
}

/** Gesto completo de drag: down no chip, move além do threshold, up na célula-alvo. */
async function dragChipToCell(chipId: string, targetCellKey: string): Promise<void> {
  const chip = document.querySelector(`[data-drag-item="${chipId}"]`) as HTMLElement;
  const target = document.querySelector(`[data-cell-key="${targetCellKey}"]`) as HTMLElement;
  expect(chip).not.toBeNull();
  expect(target).not.toBeNull();
  let pid = 0;
  const fire = (target0: EventTarget, type: string, x: number, y: number) => {
    const ev = new window.Event(type, { bubbles: true, cancelable: true });
    for (const [k, v] of Object.entries({ pointerId: pid, clientX: x, clientY: y, button: 0 })) {
      Object.defineProperty(ev, k, { value: v, writable: true, configurable: true });
    }
    Object.defineProperty(ev, 'setPointerCapture', { value: () => undefined, configurable: true });
    target0.dispatchEvent(ev);
    return ev;
  };
  const down = fire(chip, 'pointerdown', 200, 80);
  pid = (down as unknown as { pointerId: number }).pointerId;
  fire(window, 'pointermove', 210, 60); // drag ativo (threshold 4px)
  await flushPromises();
  fire(window, 'pointerup', 200, 30); // solta DENTRO da célula-alvo (caixa 0..400 × 0..60)
  await settle();
}

afterEach(() => {
  (globalThis as unknown as { __mounteds?: Array<{ unmount(): void }> }).__mounteds?.forEach((m) =>
    m.unmount(),
  );
  (globalThis as unknown as { __mounteds?: Array<{ unmount(): void }> }).__mounteds = [];
  (document.activeElement as HTMLElement | null)?.blur?.();
});

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  list.mockReset();
  checkConflict.mockReset();
  reschedule.mockReset();
  relocationOptions.mockReset();
  vi.restoreAllMocks();
  vi.spyOn(appointmentsService.appointmentsApi, 'list').mockImplementation(list);
  vi.spyOn(appointmentsService.appointmentsApi, 'checkConflict').mockImplementation(checkConflict);
  vi.spyOn(appointmentsService.appointmentsApi, 'reschedule').mockImplementation(reschedule);
  vi.spyOn(appointmentsService.appointmentsApi, 'relocationOptions').mockImplementation(relocationOptions);
  list.mockImplementation(async () => ({ items: FIXTURES }));
  checkConflict.mockImplementation(async () => ({ conflict: false, with: null }));
  relocationOptions.mockImplementation(async () => ({ kind: 'options', options: [] }));
  reschedule.mockImplementation(async (input: { newStart: Date }) => ({
    moved: appt({
      id: DENTISTA_ID,
      startsAt: new Date(input.newStart),
      endsAt: new Date(new Date(input.newStart).getTime() + 90 * 60_000),
    }),
    other: null,
    droppedRules: [],
  }));
  vi.useFakeTimers({ toFake: ['setInterval'], now: NOW.getTime() });
});

describe('Drop de compromisso (grades-dia-semana-mes Etapa 2.3)', () => {
  it('mês: soltar em OUTRO dia pede check-conflict e chama reschedule com a translação (data muda, hora preserva)', async () => {
    mountAgenda({ items: FIXTURES });
    await settle();
    patchTargetBox('day:2026-10-15');
    await dragChipToCell(DENTISTA_ID, 'day:2026-10-15');
    // check-conflict com ignoreId = movido e o NOVO intervalo (translação de +7 dias)
    expect(checkConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        startsAt: new Date('2026-10-15T14:00:00.000Z'),
        endsAt: new Date('2026-10-15T15:30:00.000Z'),
        ignoreId: DENTISTA_ID,
      }),
    );
    // reschedule: variante move PURA (sem otherId/otherStart)
    expect(reschedule).toHaveBeenCalledTimes(1);
    expect(reschedule.mock.calls[0]![0]).toEqual({
      mode: 'move',
      movedId: DENTISTA_ID,
      newStart: new Date('2026-10-15T14:00:00.000Z'),
      newEnd: new Date('2026-10-15T15:30:00.000Z'),
    });
    // toast + aria-live
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Reagendado para'));
    const live = document.querySelector('[data-testid="drop-live"]');
    expect(live?.textContent).toContain('Reagendado para');
    // o ANÚNCIO É DEPOIS da resposta: o payload foi o único pedido (sem optimistic update)
    expect(reschedule).toHaveBeenCalledTimes(1);
  });

  it('mês: drop conflituoso NÃO chama reschedule e reabre o modal de edição com o horário candidato', async () => {
    checkConflict.mockImplementation(async () => ({
      conflict: true,
      with: appt({
        id: '22222222-2222-4222-8222-222222222222',
        title: 'Academia',
        startsAt: new Date('2026-10-15T13:00:00.000Z'),
        endsAt: new Date('2026-10-15T15:00:00.000Z'),
      }),
    }));
    mountAgenda({ items: FIXTURES });
    await settle();
    patchTargetBox('day:2026-10-15');
    await dragChipToCell(DENTISTA_ID, 'day:2026-10-15');
    // nada foi escrito (o bloco nunca saiu do lugar)
    expect(reschedule).not.toHaveBeenCalled();
    // modal de EDIÇÃO aberto no horário candidato (19:00 de 15/10 SP)
    const date = document.getElementById('ap-date') as HTMLInputElement | null;
    const time = document.getElementById('ap-time') as HTMLInputElement | null;
    expect(date?.value).toBe('2026-10-15');
    expect(time?.value).toBe('11:00'); // 14:00Z = 11:00 SP — a hora local preservada
    // o modal nasceu PEDINDO as jogadas do Reagendamento Assistido (Etapa 0)
    // para o horário candidato, com movedId = o item arrastado
    expect(relocationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        startsAt: new Date('2026-10-15T14:00:00.000Z'),
        endsAt: new Date('2026-10-15T15:30:00.000Z'),
        movedId: DENTISTA_ID,
      }),
    );
  });

  it('semana: soltar em OUTRA coluna translada para o MESMO horário em outro dia (dia×hora)', async () => {
    mountAgenda({ items: FIXTURES, view: 'week' });
    await settle();
    // o bloco da quinta 08/10 11:00 SP mora na coluna dom..sáb da semana
    const block = document.querySelector(`[data-testid="week-item-${DENTISTA_ID}"]`);
    expect(block).not.toBeNull();
    patchTargetBox('day:2026-10-10');
    await dragChipToCell(DENTISTA_ID, 'day:2026-10-10');
    // translação N×24h preservando a hora local: qui 11:00 SP → sáb 11:00 SP (+2 dias)
    expect(checkConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        startsAt: new Date('2026-10-10T14:00:00.000Z'),
        endsAt: new Date('2026-10-10T15:30:00.000Z'),
        ignoreId: DENTISTA_ID,
      }),
    );
    expect(reschedule).toHaveBeenCalledTimes(1);
    expect(reschedule.mock.calls[0]![0]).toEqual({
      mode: 'move',
      movedId: DENTISTA_ID,
      newStart: new Date('2026-10-10T14:00:00.000Z'),
      newEnd: new Date('2026-10-10T15:30:00.000Z'),
    });
  });

  it('semana: drop na PRÓPRIA coluna é no-op mudo (nada é pedido)', async () => {
    mountAgenda({ items: FIXTURES, view: 'week' });
    await settle();
    patchTargetBox('day:2026-10-08'); // a coluna do próprio item
    await dragChipToCell(DENTISTA_ID, 'day:2026-10-08');
    expect(checkConflict).not.toHaveBeenCalled();
    expect(reschedule).not.toHaveBeenCalled();
  });
});
