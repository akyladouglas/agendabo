import { reactive, ref, computed } from 'vue';
import { toTypedSchema } from '@vee-validate/zod';
import { useForm } from 'vee-validate';
import { z } from 'zod';
import { toast } from 'vue-sonner';
import {
  appointmentInputSchema,
  notificationRuleInputSchema,
  type AppointmentDto,
  type AppointmentPatch,
  type CheckConflictResult,
  type CreateAppointmentInput,
  type NotificationRuleInput,
  type ReviewAppointmentDto,
} from '@agendabo/contracts';
import {
  computeAllTriggers,
  computeTriggers,
  type NotificationRule,
} from '@agendabo/schedule-core';
import { useAuthStore } from '../store/authStore';
import { useCheckConflict } from './mutations/useCheckConflict.mutation';
import { useCreateAppointmentMutation } from './mutations/useCreateAppointment.mutation';
import { useUpdateAppointmentMutation } from './mutations/useUpdateAppointment.mutation';
import { useConfirmReviewMutation } from './mutations/useConfirmReview.mutation';
import { conflictMessage } from '../utils/conflict';
import {
  formatRangeInTz,
  localDateTimeToUtc,
  toLocalDateString,
  toLocalTimeString,
} from '../utils/tz';

/** Modo do formulário único (D4): criar | editar | corrigir (fila de revisão). */
export type AppointmentFormMode = 'create' | 'edit' | 'review';

/** Estado bruto do form — datas como strings locais (D7: inputs nativos). */
export interface AppointmentFormValues {
  title: string;
  date: string;
  time: string;
  durationMinutes: number;
  notes: string;
  rules: NotificationRuleInput[];
}

/** Regra do form (input zod) → regra do domínio (schedule-core) p/ computeTriggers. */
export function toDomainRule(rule: NotificationRuleInput): NotificationRule {
  switch (rule.type) {
    case 'before_hours':
      return { type: 'before_hours', hours: rule.value ?? 1 };
    case 'before_days':
      return { type: 'before_days', days: rule.value ?? 1 };
    case 'countdown_3_2_1':
      return { type: 'countdown_3_2_1' };
    default:
      return { type: 'none' };
  }
}

interface PersistedRule {
  type: string;
  value: number | null;
}

/** DTO (regras materializadas) → chips editáveis do form. */
export function rulesFromDto(rules: PersistedRule[] | undefined): NotificationRuleInput[] {
  if (!rules || rules.length === 0) return [];
  return rules
    .filter((r) => r.type !== 'none')
    .map((r) => ({
      type: r.type as NotificationRuleInput['type'],
      value: r.value ?? undefined,
    }));
}

/** AppointmentDto pode vir enriquecido com as regras persistidas (GET /appointments). */
type AppointmentWithRules = AppointmentDto & { notificationRules?: PersistedRule[] };
type ReviewWithRules = ReviewAppointmentDto & { notificationRules?: PersistedRule[] };

function fromAppointment(app: AppointmentWithRules | ReviewWithRules, timezone: string): AppointmentFormValues {
  return {
    title: app.title,
    date: toLocalDateString(app.startsAt, timezone),
    time: toLocalTimeString(app.startsAt, timezone),
    durationMinutes: Math.max(
      5,
      Math.round((app.endsAt.getTime() - app.startsAt.getTime()) / 60_000),
    ),
    notes: app.notes ?? '',
    rules: rulesFromDto(app.notificationRules),
  };
}

function emptyValues(timezone: string, date?: Date): AppointmentFormValues {
  const day = date ?? new Date();
  return {
    title: '',
    date: toLocalDateString(day, timezone),
    time: toLocalTimeString(day, timezone),
    durationMinutes: 60,
    notes: '',
    rules: [],
  };
}

/** Puro e testável: quantos gatilhos de `rules` já passaram para `startsAt`. */
export function countRetroactiveTriggers(startsAt: Date, rules: readonly NotificationRuleInput[]): number {
  const domain = rules.map(toDomainRule);
  return computeAllTriggers(startsAt, domain).length - computeTriggers(startsAt, domain).length;
}

/** Puro e testável: strings locais → instantes UTC (null se inválido). */
export function resolveRange(
  values: Pick<AppointmentFormValues, 'date' | 'time' | 'durationMinutes'>,
  timezone: string,
): { startsAt: Date; endsAt: Date } | null {
  if (!values.date || !values.time || !Number.isFinite(values.durationMinutes) || values.durationMinutes < 5) {
    return null;
  }
  const parts = values.time.split(':').map(Number);
  const [hh = -1, mm = -1] = parts;
  const dateParts = values.date.slice(5).split('-').map(Number);
  const [mo = -1, day = -1] = dateParts;
  if (
    !Number.isInteger(hh) || hh < 0 || hh > 23 ||
    !Number.isInteger(mm) || mm < 0 || mm > 59 ||
    !Number.isInteger(mo) || mo < 1 || mo > 12 ||
    !Number.isInteger(day) || day < 1 || day > 31
  ) {
    return null;
  }
  try {
    const startsAt = localDateTimeToUtc(values.date, values.time, timezone);
    if (Number.isNaN(startsAt.getTime())) return null;
    return { startsAt, endsAt: new Date(startsAt.getTime() + values.durationMinutes * 60_000) };
  } catch {
    return null;
  }
}

/**
 * Formulário ÚNICO de compromisso (D4 da spec: criar/editar/corrigir-revisão).
 * Regras que NÃO moram aqui: conflito (check-conflict + 409 da API), gatilho
 * retroativo (a API descarta; aqui só AVISA — decisão 3 — com contagem via
 * schedule-core), datas→UTC (borda `tz.ts`) e período (schedule-core).
 */
export function useAppointmentForm(options: {
  mode: AppointmentFormMode;
  appointment?: AppointmentDto | ReviewAppointmentDto;
  /** Para "criar a partir de" um slot vazio da agenda. */
  presetDate?: Date;
}) {
  const auth = useAuthStore();
  const timezone = computed(() => auth.user?.timezone ?? 'UTC');

  /** Estado REATIVO único do form — a UI escreve aqui (v-model). */
  const values = reactive<AppointmentFormValues>(
    options.appointment
      ? fromAppointment(options.appointment as AppointmentWithRules, timezone.value)
      : emptyValues(timezone.value, options.presetDate),
  );

  const checkConflict = useCheckConflict();
  const create = useCreateAppointmentMutation();
  const update = useUpdateAppointmentMutation();
  const confirmReview = useConfirmReviewMutation();

  const conflictWarning = ref<string | null>(null);
  const submitError = ref<string | null>(null);
  const invalidMessage = ref<string | null>(null);

  /** Instantes UTC derivados (reativos) — null enquanto as strings são inválidas. */
  const range = computed(() => resolveRange(values, timezone.value));

  /** Gatilhos que não vão disparar porque já passaram (aviso antes de salvar). */
  const retroactiveCount = computed(() =>
    range.value ? countRetroactiveTriggers(range.value.startsAt, values.rules) : 0,
  );

  const rulesSchema = z.array(notificationRuleInputSchema).max(10, 'Máximo de 10 lembretes.');

  /** Objeto zod cru (mesma source of truth do `toTypedSchema` abaixo). */
  const fieldsSchema = z
    .object({
        title: z.string().trim().min(1, 'Informe um título.').max(200),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.'),
        time: z.string().regex(/^\d{2}:\d{2}$/, 'Hora inválida.'),
        durationMinutes: z
          .number()
          .int('Inteiro.')
          .min(5, 'Mínimo de 5 minutos.')
          .max(24 * 60 * 30, 'Duração longa demais.'),
        notes: z.string().max(2000),
        rules: rulesSchema,
      })
      .superRefine((_v, ctx) => {
        if (!range.value) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['time'],
            message: 'Horário inválido.',
          });
        }
      });

  const schema = toTypedSchema(fieldsSchema);

  const form = useForm({
    validationSchema: schema,
    initialValues: {
      title: values.title,
      date: values.date,
      time: values.time,
      durationMinutes: values.durationMinutes,
      notes: values.notes,
      rules: values.rules,
    },
  });

  function setFieldErrorsFromZod(err: unknown): void {
    const issues =
      err && typeof err === 'object' && 'issues' in err
        ? (err as { issues: { path: (string | number | symbol)[]; message: string }[] }).issues
        : [];
    const map: Record<string, string> = {};
    for (const issue of issues) {
      const key = String(issue.path[0] ?? '');
      if (!(key in map)) map[key] = issue.message;
    }
    if (Object.keys(map).length) form.setErrors(map);
  }

  /** Assinatura do último horário verificado (só re-checa se mexeu em data/hora/duração). */
  let checkedSignature: string | null = null;

  function invalidateCheck(): void {
    checkedSignature = null;
    conflictWarning.value = null;
  }

  async function ensureConflictCheck(): Promise<void> {
    const r = range.value;
    if (!r) return;
    const sig = `${r.startsAt.toISOString()}|${r.endsAt.toISOString()}`;
    if (sig === checkedSignature) return;
    const result = (await checkConflict.mutateAsync({
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      ignoreId: options.appointment?.id,
    })) as CheckConflictResult;
    conflictWarning.value =
      result.conflict && result.with
        ? `Choque com "${result.with.title}" (${formatRangeInTz(result.with.startsAt, result.with.endsAt, timezone.value)})`
        : null;
    checkedSignature = sig;
  }

  /** Valida `values` e devolve o payload dos contracts (null se inválido). */
  function buildInput(): CreateAppointmentInput | null {
    const r = range.value;
    if (!r) return null;
    try {
      return appointmentInputSchema.parse({
        title: values.title.trim(),
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        notes: values.notes.trim() ? values.notes.trim() : undefined,
        notificationRules: values.rules,
      });
    } catch {
      return null;
    }
  }

  /** O que a API descartou por gatilho retroativo vira toast discreto (decisão 3). */
  function warnDropped(result: unknown): void {
    const dropped = (result as { droppedRules?: string[] })?.droppedRules;
    if (dropped && dropped.length > 0) {
      toast.warning('⏰ alguns lembretes não vão disparar — o horário deles já passou');
    }
  }

  const submitting = computed(
    () =>
      create.isPending.value ||
      update.isPending.value ||
      confirmReview.isPending.value ||
      checkConflict.isPending.value,
  );

  /** Salvar: valida → check-conflict (se horário novo) → chama a API do modo. */
  async function submit(): Promise<{ ok: boolean }> {
    submitError.value = null;
    invalidMessage.value = null;

    const parsed = fieldsSchema.safeParse(values);
    if (!parsed.success) {
      setFieldErrorsFromZod(parsed.error);
      return { ok: false };
    }

    const input = buildInput();
    if (!input) {
      invalidMessage.value = 'Horário inválido.';
      return { ok: false };
    }

    try {
      await ensureConflictCheck();
    } catch {
      // check-conflict falhou: não bloqueamos — a API re-checa no save (spec A.4)
    }

    try {
      if (options.mode === 'create') {
        const result = await create.mutateAsync(input);
        warnDropped(result);
        toast.success('Compromisso criado.');
      } else if (options.mode === 'edit' && options.appointment) {
        const patch: AppointmentPatch = {
          title: input.title,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          notes: input.notes,
          notificationRules: input.notificationRules,
        };
        const result = await update.mutateAsync({ id: options.appointment.id, ...patch });
        warnDropped(result);
        toast.success('Compromisso atualizado.');
      } else if (options.mode === 'review' && options.appointment) {
        await confirmReview.mutateAsync({ id: options.appointment.id, ...input });
        toast.success('Aprovado — saiu da fila de revisão.');
      }
      return { ok: true };
    } catch (err) {
      const conflict = conflictMessage(err, (s, e) => formatRangeInTz(s, e, timezone.value));
      if (conflict) {
        conflictWarning.value = conflict;
      } else {
        submitError.value =
          (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          'Algo deu errado, tente de novo.';
      }
      return { ok: false };
    }
  }

  return {
    values,
    form,
    range,
    timezone,
    conflictWarning,
    submitError,
    invalidMessage,
    submitting,
    retroactiveCount,
    invalidateCheck,
    buildInput,
    submit,
  };
}
