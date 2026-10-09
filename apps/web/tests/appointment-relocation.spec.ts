import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createApp, h, type App } from 'vue';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { createPinia, setActivePinia } from 'pinia';
import type { AppointmentDto, RelocationOptionDto, RescheduleResult } from '@agendabo/contracts';
import * as appointmentsService from '../src/app/services/appointments';
import { useAuthStore } from '../src/app/store/authStore';
import { useAppointmentForm } from '../src/app/composables/useAppointmentForm.composable';

/**
 * Reagendamento Assistido na web (Etapa 0, fecha C.11 — spec
 * `.ia/specs/agenda/reagendamento-assistido.spec.md` §D): o form NÃO calcula
 * nada — ao detectar conflito chama `relocation-options` com o candidato e, ao
 * confirmar uma jogada, chama `reschedule` com a variante/campos certos.
 * A API é mockada na borda do service (padrão calendar-views.spec). Datas fixas.
 */

vi.mock('vue-sonner', () => ({
  toast: Object.assign(() => undefined, {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

const TZ = 'America/Sao_Paulo';
const MOVED_ID = '99999999-9999-4999-8999-999999999999';
const OTHER_ID = '88888888-8888-4888-8888-888888888888';

/** axios-like 409 no formato que `conflictMessage` entende. */
function http409(message = 'Conflito com outro compromisso.'): Error & { response: unknown } {
  return Object.assign(new Error(message), {
    response: { status: 409, data: { message } },
  });
}

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

function moveOtherOption(): RelocationOptionDto {
  return {
    kind: 'move-other',
    other: appt({
      id: OTHER_ID,
      title: 'Dentista',
      startsAt: new Date('2026-10-08T17:00:00.000Z'),
      endsAt: new Date('2026-10-08T18:00:00.000Z'),
    }),
    newStart: new Date('2026-10-09T00:00:00.000Z'),
    newEnd: new Date('2026-10-09T01:00:00.000Z'),
  };
}

function moveSelfOption(): RelocationOptionDto {
  return {
    kind: 'move-self',
    newStart: new Date('2026-10-08T19:00:00.000Z'),
    newEnd: new Date('2026-10-08T20:00:00.000Z'),
  };
}

function rescheduleResult(movedStarts: string): RescheduleResult {
  return {
    moved: appt({
      id: MOVED_ID,
      startsAt: new Date(movedStarts),
      endsAt: new Date(new Date(movedStarts).getTime() + 60 * 60_000),
    }),
    other: null,
    droppedRules: [],
  };
}

let relocationOptions: ReturnType<typeof vi.fn>;
let reschedule: ReturnType<typeof vi.fn>;
let createFn: ReturnType<typeof vi.fn>;
let updateFn: ReturnType<typeof vi.fn>;

function mountForm(opts: {
  mode: 'create' | 'edit';
  appointment?: AppointmentDto;
}): { form: ReturnType<typeof useAppointmentForm>; host: App } {
  setActivePinia(createPinia());
  useAuthStore().setUser({
    id: 'u1',
    email: 'ana@email.com',
    timezone: TZ,
    resumoDiarioHora: '08:00',
    resumoDiarioAtivo: true,
    name: 'Ana',
  });
  const qc = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false, gcTime: Infinity },
    },
  });
  // O composable exige contexto de setup (useMutation/injeção): o host é um
  // componente vazio que O CHAMA no setup e o expõe (padrão do harness da agenda
  // de expor a instância, aqui via variável do teste).
  let created: ReturnType<typeof useAppointmentForm> | null = null;
  const host = createApp({
    setup() {
      created = useAppointmentForm({ mode: opts.mode, appointment: opts.appointment });
      return () => h('div');
    },
  });
  host.use(VueQueryPlugin, { queryClient: qc });
  host.mount(document.createElement('div'));
  return { form: created as unknown as ReturnType<typeof useAppointmentForm>, host };
}

beforeEach(() => {
  relocationOptions = vi.fn();
  reschedule = vi.fn();
  createFn = vi.fn().mockResolvedValue({});
  updateFn = vi.fn().mockResolvedValue({});
  vi.spyOn(appointmentsService.appointmentsApi, 'checkConflict').mockImplementation(async () => ({
    conflict: true,
    with: appt({
      id: OTHER_ID,
      title: 'Dentista',
      startsAt: new Date('2026-10-08T17:00:00.000Z'),
      endsAt: new Date('2026-10-08T18:00:00.000Z'),
    }),
  }));
  vi.spyOn(appointmentsService.appointmentsApi, 'relocationOptions').mockImplementation(
    relocationOptions,
  );
  vi.spyOn(appointmentsService.appointmentsApi, 'reschedule').mockImplementation(reschedule);
  vi.spyOn(appointmentsService.appointmentsApi, 'create').mockImplementation(() => createFn());
  vi.spyOn(appointmentsService.appointmentsApi, 'update').mockImplementation((...a) =>
    updateFn(...a),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Candidato conflituoso em SP: 14:00 + 60min = 17:00Z–18:00Z. */
function fillConflicting(form: ReturnType<typeof useAppointmentForm>['values']) {
  form.title = 'Consulta';
  form.date = '2026-10-08';
  form.time = '14:00';
  form.durationMinutes = 60;
}

describe('Reagendamento Assistido — fetch de jogadas (D-W1)', () => {
  it('criação: conflito no save (409) chama relocation-options SEM movedId', async () => {
    const { form, host } = mountForm({ mode: 'create' });
    fillConflicting(form.values);
    relocationOptions.mockResolvedValue({ kind: 'options', options: [moveOtherOption()] });
    createFn.mockRejectedValue(http409('Conflito com "Dentista"'));

    const { ok } = await form.submit();
    await flushPromises();

    expect(ok).toBe(false);
    expect(relocationOptions).toHaveBeenCalledWith({
      startsAt: new Date('2026-10-08T17:00:00.000Z'),
      endsAt: new Date('2026-10-08T18:00:00.000Z'),
      movedId: undefined,
    });
    expect(form.relocationOptions.value).toHaveLength(1);
    expect(form.relocationBlocked.value).toBe(false);
    host.unmount();
  });

  it('edição: relocation-options é chamado COM movedId do compromisso editado', async () => {
    const edited = appt({
      id: MOVED_ID,
      title: 'Consulta',
      startsAt: new Date('2026-10-07T12:00:00.000Z'),
      endsAt: new Date('2026-10-07T13:00:00.000Z'),
    });
    const { form, host } = mountForm({ mode: 'edit', appointment: edited });
    fillConflicting(form.values);
    relocationOptions.mockResolvedValue({ kind: 'options', options: [moveOtherOption()] });
    updateFn.mockRejectedValue(http409('Conflito com "Dentista"'));

    const { ok } = await form.submit();
    await flushPromises();

    expect(ok).toBe(false);
    expect(relocationOptions).toHaveBeenCalledWith({
      startsAt: new Date('2026-10-08T17:00:00.000Z'),
      endsAt: new Date('2026-10-08T18:00:00.000Z'),
      movedId: MOVED_ID,
    });
    host.unmount();
  });

  it('409 do relocation-options (2+ conflitos = "não cabe") fecha a seção (inline cobre)', async () => {
    const { form, host } = mountForm({ mode: 'create' });
    fillConflicting(form.values);
    relocationOptions.mockRejectedValue(http409('Conflito com outro compromisso.'));
    createFn.mockRejectedValue(http409('Conflito com outro compromisso.'));

    const { ok } = await form.submit();
    await flushPromises();

    expect(ok).toBe(false);
    expect(form.conflictWarning.value).toContain('Conflito');
    expect(form.relocationOptions.value).toBeNull();
    expect(form.relocationBlocked.value).toBe(false);
    host.unmount();
  });

  it('opções vazias ⇒ relocationBlocked (UI: "não há como encaixar" + salvar bloqueado)', async () => {
    const { form, host } = mountForm({ mode: 'create' });
    fillConflicting(form.values);
    relocationOptions.mockResolvedValue({ kind: 'options', options: [] });
    createFn.mockRejectedValue(http409('Conflito com outro compromisso.'));

    await form.submit();
    await flushPromises();

    expect(form.relocationOptions.value).toEqual([]);
    expect(form.relocationBlocked.value).toBe(true);
    host.unmount();
  });

  it('mexer o horário (invalidateCheck) fecha a seção de jogadas', async () => {
    const { form, host } = mountForm({ mode: 'create' });
    fillConflicting(form.values);
    relocationOptions.mockResolvedValue({ kind: 'options', options: [moveOtherOption()] });
    createFn.mockRejectedValue(http409('Conflito com outro compromisso.'));

    await form.submit();
    await flushPromises();
    expect(form.relocationOptions.value).not.toBeNull();

    form.invalidateCheck();
    expect(form.relocationOptions.value).toBeNull();
    host.unmount();
  });
});

describe('Reagendamento Assistido — payload do reschedule (D-W2)', () => {
  it('criação + move-other ⇒ variante create com payload do form + otherId (SEM otherStart/otherEnd)', async () => {
    const { form, host } = mountForm({ mode: 'create' });
    fillConflicting(form.values);
    reschedule.mockResolvedValue(rescheduleResult('2026-10-08T17:00:00.000Z'));

    const { ok } = await form.confirmRelocation(moveOtherOption());

    expect(ok).toBe(true);
    expect(reschedule).toHaveBeenCalledTimes(1);
    const body = reschedule.mock.calls[0]![0];
    expect(body.mode).toBe('create');
    expect(body.otherId).toBe(OTHER_ID);
    expect(body.otherStart).toBeUndefined();
    expect(body.otherEnd).toBeUndefined();
    expect(body.create.title).toBe('Consulta');
    expect(body.create.startsAt.toISOString()).toBe('2026-10-08T17:00:00.000Z');
    expect(body.create.endsAt.toISOString()).toBe('2026-10-08T18:00:00.000Z');
    expect(Array.isArray(body.create.notificationRules)).toBe(true);
    host.unmount();
  });

  it('criação + move-self ⇒ variante create com startsAt/endsAt = slot da opção (sem otherId)', async () => {
    const { form, host } = mountForm({ mode: 'create' });
    fillConflicting(form.values);
    reschedule.mockResolvedValue(rescheduleResult('2026-10-08T19:00:00.000Z'));

    const { ok } = await form.confirmRelocation(moveSelfOption());

    expect(ok).toBe(true);
    const body = reschedule.mock.calls[0]![0];
    expect(body.mode).toBe('create');
    expect(body.otherId).toBeUndefined();
    expect(body.create.startsAt.toISOString()).toBe('2026-10-08T19:00:00.000Z');
    expect(body.create.endsAt.toISOString()).toBe('2026-10-08T20:00:00.000Z');
    host.unmount();
  });

  it('edição + move-other ⇒ variante move: movido→candidato, otherId + slot exato da opção', async () => {
    const edited = appt({
      id: MOVED_ID,
      title: 'Consulta',
      startsAt: new Date('2026-10-07T12:00:00.000Z'),
      endsAt: new Date('2026-10-07T13:00:00.000Z'),
    });
    const { form, host } = mountForm({ mode: 'edit', appointment: edited });
    fillConflicting(form.values);
    reschedule.mockResolvedValue(rescheduleResult('2026-10-08T17:00:00.000Z'));

    const { ok } = await form.confirmRelocation(moveOtherOption());

    expect(ok).toBe(true);
    const body = reschedule.mock.calls[0]![0];
    expect(body.mode).toBe('move');
    expect(body.movedId).toBe(MOVED_ID);
    expect(body.otherId).toBe(OTHER_ID);
    // o MOVIDO vai para o destino que o usuário escolheu (candidato do form)
    expect(body.newStart.toISOString()).toBe('2026-10-08T17:00:00.000Z');
    expect(body.newEnd.toISOString()).toBe('2026-10-08T18:00:00.000Z');
    // o OUTRO vai para o slot que a UI MOSTROU (server recusa client obsoleto)
    expect(body.otherStart.toISOString()).toBe('2026-10-09T00:00:00.000Z');
    expect(body.otherEnd.toISOString()).toBe('2026-10-09T01:00:00.000Z');
    host.unmount();
  });

  it('edição + move-self ⇒ variante move só com newStart/newEnd = slot (sem otherId)', async () => {
    const edited = appt({
      id: MOVED_ID,
      title: 'Consulta',
      startsAt: new Date('2026-10-07T12:00:00.000Z'),
      endsAt: new Date('2026-10-07T13:00:00.000Z'),
    });
    const { form, host } = mountForm({ mode: 'edit', appointment: edited });
    fillConflicting(form.values);
    reschedule.mockResolvedValue(rescheduleResult('2026-10-08T19:00:00.000Z'));

    const { ok } = await form.confirmRelocation(moveSelfOption());

    expect(ok).toBe(true);
    const body = reschedule.mock.calls[0]![0];
    expect(body.mode).toBe('move');
    expect(body.movedId).toBe(MOVED_ID);
    expect(body.otherId).toBeUndefined();
    expect(body.otherStart).toBeUndefined();
    expect(body.newStart.toISOString()).toBe('2026-10-08T19:00:00.000Z');
    expect(body.newEnd.toISOString()).toBe('2026-10-08T20:00:00.000Z');
    host.unmount();
  });

  it('409 no reschedule (jogada mudada — D4): nada confirmado, conflito avisado e jogadas re-consultadas', async () => {
    const { form, host } = mountForm({ mode: 'create' });
    fillConflicting(form.values);
    reschedule.mockRejectedValue(http409('Jogada de reagendamento nao disponivel'));
    relocationOptions.mockResolvedValue({ kind: 'options', options: [moveSelfOption()] });

    const { ok } = await form.confirmRelocation(moveOtherOption());
    await flushPromises();

    expect(ok).toBe(false);
    // `conflictMessage` usa a mensagem da API quando o corpo não traz `conflictWith`
    expect(form.conflictWarning.value).toContain('Jogada de reagendamento');
    expect(relocationOptions).toHaveBeenCalled();
    // a seção passa a mostrar a jogada RECOMPUTADA
    expect(form.relocationOptions.value).toHaveLength(1);
    expect(form.relocationOptions.value![0]!.kind).toBe('move-self');
    host.unmount();
  });
});
