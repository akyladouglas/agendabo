import { computed, reactive, ref, watch } from 'vue';
import { BOT_EVENT_TYPES, LLM_CALL_PURPOSES } from '@agendabo/contracts';
import { localEndOfDayUtc } from '../utils/dateFilter';
import { useAuthStore } from '../store/authStore';
import {
  useAdminUsersQuery,
  useBotEventsQuery,
  useLlmUsageQuery,
  useObsMeQuery,
} from './queries/useObservability.query';
import { useSetRolloutMutation } from './mutations/useSetRollout.mutation';

/**
 * Estado da página Admin (observabilidade) — separado da view pela regra de
 * ~150 linhas do vue.md. O papel vem da API (`/observabilidade/me`), nunca do
 * token: não-admin sem rollout vê só o estado "acesso restrito" e as queries
 * de admin NUNCA disparam.
 */
export type AdminTab = 'eventos' | 'custo' | 'usuarios';
const ADMIN_TABS: readonly AdminTab[] = ['eventos', 'custo', 'usuarios'];

export function asAdminTab(raw: unknown): AdminTab {
  return ADMIN_TABS.includes(raw as AdminTab) ? (raw as AdminTab) : 'eventos';
}

const PAGE_SIZE = 50;

/** Data local ('YYYY-MM-DD') + N dias — borda de período só para exibir/filtrar. */
function addDaysLocal(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayLocalKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function useAdminPage(initialTab: AdminTab = 'eventos') {
  const auth = useAuthStore();
  const timezone = computed(() => auth.user?.timezone ?? 'UTC');

  const tab = ref<AdminTab>(initialTab);

  const meQuery = useObsMeQuery();
  type ObsMe = { isAdmin: boolean; observabilidadeEventosAtivo: boolean };
  const me = computed<ObsMe | undefined>(() => meQuery.data.value as ObsMe | undefined);
  /** status HTTP do erro de permissão (403/404 = sem acesso; 401 = sessão). */
  const meErrorStatus = computed(
    () => (meQuery.error.value as { response?: { status?: number } } | null)?.response?.status,
  );
  /** acesso resolvido = admin (tudo) ou rollout (só os próprios) ou negado. */
  const denied = computed(() => meErrorStatus.value === 403 || meErrorStatus.value === 404);
  const sessionExpired = computed(() => meErrorStatus.value === 401);
  /**
   * Rede de segurança (gotcha do F5 do auth): uma exceção de REDE no /me (sem
   * response) derruba meQuery para error e negaria a página p/ um admin
   * legítimo — o `isAdmin` da sessão (setado no login pelo server) assume.
   * Nunca fonte primária: rollout nunca tem isAdmin no store.
   */
  const sessionAdmin = computed(() => auth.user?.isAdmin === true);
  const isAdmin = computed(() => me.value?.isAdmin ?? sessionAdmin.value);
  const selfView = computed(() => !!me.value && !me.value.isAdmin);
  // custo é admin-only (spec C4): rollout nunca vê a aba — nem por ?aba=custo
  const effectiveTab = computed<AdminTab>(() =>
    tab.value === 'custo' && me.value && !isAdmin.value ? 'eventos' : tab.value,
  );
  /** papel PERMITIDO: sucesso do /me OU sessão admin com o /me fora do ar. */
  const showEvents = computed(() => (meQuery.isSuccess.value || sessionAdmin.value) && !denied.value);
  // eventos só fazem sentido na aba Eventos — o resto espera o clique da aba
  const eventsEnabled = computed(() => showEvents.value && effectiveTab.value === 'eventos');

  // --- aba Eventos -------------------------------------------------------
  const filters = reactive({
    userId: 'todos',
    type: 'todos',
    /** vazio = a API decide (eventos: tudo; custo: últimos 90 dias). */
    from: '',
    to: '',
  });
  const page = ref(0);
  watch(filters, () => {
    page.value = 0;
  });

  const eventsParams = computed<Record<string, string | number | undefined>>(() => ({
    ...(isAdmin.value && filters.userId !== 'todos' ? { userId: filters.userId } : {}),
    ...(filters.type !== 'todos' ? { type: filters.type } : {}),
    ...(filters.from ? { from: `${filters.from}T00:00:00.000Z` } : {}),
    // "até dia X" inclui o dia inteiro do usuário (23:59:59.999 local → UTC)
    ...(filters.to ? { to: localEndOfDayUtc(filters.to, timezone.value) } : {}),
    limit: PAGE_SIZE,
    offset: page.value * PAGE_SIZE,
  }));
  const eventsQuery = useBotEventsQuery(() => eventsParams.value, () => eventsEnabled.value);
  const total = computed(() => eventsQuery.data.value?.total ?? 0);
  const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));

  function applyPreset(days: 7 | 30 | 90): void {
    filters.from = addDaysLocal(todayLocalKey(), -days + 1);
    filters.to = todayLocalKey();
  }
  function clearDates(): void {
    filters.from = '';
    filters.to = '';
  }

  const typeOptions = [
    { value: 'todos', label: 'Todos os tipos' },
    ...BOT_EVENT_TYPES.map((value) => ({ value, label: value })),
  ];

  // --- aba Custo ---------------------------------------------------------
  const cost = reactive({ from: '', to: '', groupBy: 'purpose' as 'purpose' | 'user' });
  const usageParams = computed<Record<string, string | undefined>>(() => ({
    ...(cost.from ? { from: `${cost.from}T00:00:00.000Z` } : {}),
    ...(cost.to ? { to: localEndOfDayUtc(cost.to, timezone.value) } : {}),
    groupBy: cost.groupBy,
  }));
  const usageQuery = useLlmUsageQuery(
    () => usageParams.value,
    () => showEvents.value && isAdmin.value && effectiveTab.value === 'custo',
  );

  // --- aba Usuários (admin-only — a query NUNCA dispara para rollout) -----
  // admin: a lista é necessária também na aba Eventos (filtro + labels), então
  // dispara com o papel resolvido; rollout jamais.
  const usersQuery = useAdminUsersQuery(() => showEvents.value && isAdmin.value);
  /**
   * Guarda reativa p/ template (isAdmin só é true depois do /me resolver). É a
   * ÚNICA fonte de `v-if` de admin na view; o composable devolve `me` só p/
   * leitura de flag já resolvida — nunca p/ condicional de renderização.
   */
  const showUserFilter = computed(() => showEvents.value && isAdmin.value);
  const rolloutMutation = useSetRolloutMutation();

  /** label humano p/ o bucket de custo (groupBy=user) e p/ o filtro de eventos. */
  function userLabel(id: string): string {
    const u = (usersQuery.data.value?.items ?? []).find((x) => x.id === id);
    if (!u) return id.slice(0, 8);
    return u.name?.trim() || u.email;
  }

  const userFilterOptions = computed(() => [
    { value: 'todos', label: 'Todos os usuários' },
    ...(usersQuery.data.value?.items ?? []).map((u) => ({
      value: u.id,
      label: u.name?.trim() || u.email,
    })),
  ]);

  const purposeOptions = LLM_CALL_PURPOSES.map((value) => ({ value, label: value }));

  return {
    tab,
    effectiveTab,
    meQuery,
    me,
    denied,
    sessionExpired,
    showEvents,
    isAdmin,
    selfView,
    timezone,
    filters,
    page,
    eventsQuery,
    total,
    totalPages,
    applyPreset,
    clearDates,
    typeOptions,
    userFilterOptions,
    cost,
    usageQuery,
    purposeOptions,
    usersQuery,
    showUserFilter,
    rolloutMutation,
    userLabel,
  };
}
