import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, type App } from 'vue';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { createPinia, setActivePinia } from 'pinia';
import type { AppointmentDto } from '@agendabo/contracts';
import * as appointmentsService from '../src/app/services/appointments';
import { useAuthStore } from '../src/app/store/authStore';
import { useAppointmentForm } from '../src/app/composables/useAppointmentForm.composable';

/**
 * Spec notas-e-fim-na-web, critérios B (Gherkin) no COMPOSABLE (timezone injetável
 * via authStore): o form expõe início (data+hora) e FIM (data+hora) — nunca
 * "duração" como entrada; fim multi-dia é legível e editável; fim ≤ início bloqueia
 * o submit SEM chamar check-conflict; mudar só a DATA de início com fim configurado
 * PERGUNTA (decisão humana #2) com default "manter intervalo"; o payload final
 * continua `appointmentInputSchema` (zero campo novo).
 */

vi.mock('vue-sonner', () => ({
  toast: Object.assign(() => undefined, {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

// Relógio travado em 2026-10-08 (T0): `emptyValues` do form de criação parte de
// `new Date()` e o teste "mudar a data de início NÃO pergunta" asserta o FIM
// DERIVADO do agora real — sem isso ele quebra no dia 09/10 (e em qualquer data
// != 08) por design. testing.md: data fixa, nunca `new Date()` solto.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-08T12:00:00.000Z') });
});
afterEach(() => {
  vi.useRealTimers();
});

const TZ = 'America/Sao_Paulo';

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
    isAdmin: false,
    name: 'Ana',
  });
  const qc = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false, gcTime: Infinity } },
  });
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

let checkConflict: ReturnType<typeof vi.fn>;

beforeEach(() => {
  checkConflict = vi.fn().mockResolvedValue({ conflict: false });
  vi.spyOn(appointmentsService.appointmentsApi, 'checkConflict').mockImplementation(checkConflict);
  vi.spyOn(appointmentsService.appointmentsApi, 'create').mockImplementation(async () => ({}));
  vi.spyOn(appointmentsService.appointmentsApi, 'update').mockImplementation(async () => ({}));
  vi.spyOn(appointmentsService.appointmentsApi, 'relocationOptions').mockImplementation(
    async () => ({ kind: 'ok' as const }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('B1 — edição multi-dia exibe o FIM (não "3960 minutos")', () => {
  it('sáb 23:00 → seg 17:00 (tz do usuário): campos data sáb, início 23:00, fim seg 17:00', () => {
    const { form, host } = mountForm({
      mode: 'edit',
      appointment: appt({
        id: 'a1',
        startsAt: new Date('2026-10-11T02:00:00.000Z'), // sáb 23:00 SP
        endsAt: new Date('2026-10-12T20:00:00.000Z'), // seg 17:00 SP
      }),
    });
    expect(form.values.date).toBe('2026-10-10');
    expect(form.values.time).toBe('23:00');
    expect(form.values.endDate).toBe('2026-10-12');
    expect(form.values.endTime).toBe('17:00');
    // duração sobrevive DERIVADA (42h), não como entrada "3960 minutos"
    expect(form.durationMinutes.value).toBe(42 * 60);
    host.unmount();
  });
});

describe('B1/B4 — criação: fim derivado do default e editável', () => {
  it('início qua 10:00 + default 60min: fim derivado 11:00; editar fim p/ qui 12:30 ⇒ payload endsAt = início + 26h30', async () => {
    const { form, host } = mountForm({ mode: 'create' });
    form.values.title = 'Consulta';
    form.values.date = '2026-10-07';
    form.onStartTimeChange('10:00');
    expect(form.values.endDate).toBe('2026-10-07');
    expect(form.values.endTime).toBe('11:00');
    expect(form.durationMinutes.value).toBe(60);

    form.onEndChange({ endDate: '2026-10-08', endTime: '12:30' });
    expect(form.durationMinutes.value).toBe(26 * 60 + 30);

    const input = form.buildInput();
    expect(input).not.toBeNull();
    expect(input!.startsAt.toISOString()).toBe('2026-10-07T13:00:00.000Z');
    expect(input!.endsAt.toISOString()).toBe('2026-10-08T15:30:00.000Z');
    host.unmount();
  });

  it('payload final só tem os campos do appointmentInputSchema (zero campo novo)', () => {
    const { form, host } = mountForm({ mode: 'create' });
    form.values.title = 'X';
    form.values.date = '2026-10-08';
    form.values.time = '10:00';
    form.values.endDate = '2026-10-08';
    form.values.endTime = '11:00';
    const input = form.buildInput()!;
    expect(input.startsAt).toBeInstanceOf(Date);
    expect(input.endsAt).toBeInstanceOf(Date);
    expect(input.title).toBe('X');
    // zero campo novo vs. `appointmentInputSchema` (asert de contrato da spec)
    expect(Object.keys(input).sort()).toEqual(
      ['endsAt', 'notes', 'notificationRules', 'startsAt', 'title'].sort(),
    );
    host.unmount();
  });
});

describe('B2 — edição bidirecional em tempo real', () => {
  it('mudou só a HORA de início ⇒ fim desliza preservando a duração (sem pergunta)', () => {
    const { form, host } = mountForm({
      mode: 'edit',
      appointment: appt({
        id: 'a1',
        startsAt: new Date('2026-10-11T02:00:00.000Z'), // sáb 23:00
        endsAt: new Date('2026-10-12T20:00:00.000Z'), // seg 17:00
      }),
    });
    form.onStartTimeChange('21:00');
    expect(form.values.endDate).toBe('2026-10-12');
    expect(form.values.endTime).toBe('15:00'); // mesma duração, hora deslizou
    expect(form.startDatePrompt.value).toBe(false); // hora nunca pergunta
    host.unmount();
  });

  it('Gherkin: início sáb→qua (23:00 preservado) no sáb→seg 17:00 ⇒ fim sex 17:00 com PERGUNTA inline', () => {
    const { form, host } = mountForm({
      mode: 'edit',
      appointment: appt({
        id: 'a1',
        startsAt: new Date('2026-10-11T02:00:00.000Z'),
        endsAt: new Date('2026-10-12T20:00:00.000Z'),
      }),
    });
    form.onStartDateChange('2026-10-14'); // qua
    // default "manter intervalo": fim deslizou 4 dias (12→16 = sex), hora preservada
    expect(form.values.endDate).toBe('2026-10-16');
    expect(form.values.endTime).toBe('17:00');
    expect(form.startDatePrompt.value).toBe(true); // decisão 2: o form PERGUNTA
    // "definir novo fim" só fecha a pergunta — o campo fica para o usuário
    form.defineNewEnd();
    expect(form.startDatePrompt.value).toBe(false);
    host.unmount();
  });

  it('"manter o intervalo" fecha a pergunta sem mudar nada (default já aplicado)', () => {
    const { form, host } = mountForm({
      mode: 'edit',
      appointment: appt({
        id: 'a1',
        startsAt: new Date('2026-10-11T02:00:00.000Z'),
        endsAt: new Date('2026-10-12T20:00:00.000Z'),
      }),
    });
    form.onStartDateChange('2026-10-14');
    const end = { ...{ endDate: form.values.endDate, endTime: form.values.endTime } };
    form.keepInterval();
    expect(form.startDatePrompt.value).toBe(false);
    expect(form.values.endDate).toBe(end.endDate);
    expect(form.values.endTime).toBe(end.endTime);
    host.unmount();
  });

  it('sem fim configurado (criação nova): mudar a data de início NÃO pergunta', () => {
    const { form, host } = mountForm({ mode: 'create' });
    form.values.date = '2026-10-08';
    form.values.endDate = '';
    form.values.endTime = '';
    form.onStartDateChange('2026-10-09');
    expect(form.startDatePrompt.value).toBe(false);
    // fim derivado normalmente no novo dia
    expect(form.values.endDate).toBe('2026-10-09');
    host.unmount();
  });

  it('editou o FIM ⇒ início intacto e a pergunta morre', () => {
    const { form, host } = mountForm({
      mode: 'edit',
      appointment: appt({
        id: 'a1',
        startsAt: new Date('2026-10-11T02:00:00.000Z'),
        endsAt: new Date('2026-10-12T20:00:00.000Z'),
      }),
    });
    form.onStartDateChange('2026-10-14');
    const start = { date: form.values.date, time: form.values.time };
    form.onEndChange({ endDate: '2026-10-20', endTime: '09:00' });
    expect(form.values.date).toBe(start.date);
    expect(form.values.time).toBe(start.time);
    expect(form.values.endDate).toBe('2026-10-20');
    expect(form.values.endTime).toBe('09:00');
    expect(form.startDatePrompt.value).toBe(false);
    host.unmount();
  });
});

describe('B3 — validação fim ≤ início', () => {
  it('fim igual ao início ⇒ rangeOrderError, submit bloqueado e NENHUM check-conflict', async () => {
    const { form, host } = mountForm({ mode: 'create' });
    form.values.title = 'X';
    form.values.date = '2026-10-08';
    form.values.time = '14:30';
    form.values.endDate = '2026-10-08';
    form.values.endTime = '14:30';
    expect(form.rangeOrderError.value).toBe(true);

    const { ok } = await form.submit();
    expect(ok).toBe(false);
    expect(checkConflict).not.toHaveBeenCalled();
    host.unmount();
  });

  it('fim anterior ao início ⇒ submit bloqueado sem check-conflict; corrigir o fim destrava', async () => {
    const { form, host } = mountForm({ mode: 'create' });
    form.values.title = 'X';
    form.values.date = '2026-10-08';
    form.values.time = '14:30';
    form.values.endDate = '2026-10-07';
    form.values.endTime = '23:00';
    const first = await form.submit();
    expect(first.ok).toBe(false);
    expect(checkConflict).not.toHaveBeenCalled();

    form.onEndChange({ endDate: '2026-10-08', endTime: '15:30' });
    expect(form.rangeOrderError.value).toBe(false);
    const second = await form.submit();
    expect(second.ok).toBe(true);
    expect(checkConflict).toHaveBeenCalled();
    host.unmount();
  });
});
