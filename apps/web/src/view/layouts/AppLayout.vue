<template>
  <div class="min-h-dvh bg-background text-foreground">
    <header class="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
      <nav
        class="mx-auto flex h-14 max-w-[1080px] items-center gap-2 px-4 md:h-16 md:gap-4"
        aria-label="Navegação principal"
      >
        <!-- logo: ícone calendário verde + nome (mock) -->
        <RouterLink
          to="/agenda"
          class="flex min-h-11 items-center gap-2 rounded-md pr-2 font-heading text-lg font-bold"
        >
          <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <CalendarDays class="h-5 w-5" />
          </span>
          <span class="hidden xs:inline sm:inline">Agendabô</span>
        </RouterLink>

        <!-- ≥md: nav horizontal -->
        <div class="hidden items-center gap-1 md:flex">
          <RouterLink
            to="/agenda"
            class="od-move min-h-11 inline-flex items-center rounded-md px-3 text-sm font-medium"
            :class="route.path === '/agenda' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'"
          >
            Agenda
          </RouterLink>
          <RouterLink
            to="/revisao"
            class="od-move min-h-11 inline-flex items-center gap-2 rounded-md px-3 text-sm font-medium"
            :class="route.path === '/revisao' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'"
          >
            Revisão
            <span
              v-if="reviewCount > 0"
              class="od-nowrap inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-warning px-1.5 text-xs font-semibold text-warning-foreground"
              :aria-label="`${reviewCount} pendente${reviewCount === 1 ? '' : 's'} de revisão`"
            >{{ reviewCount }}</span>
          </RouterLink>
          <RouterLink
            to="/perfil"
            class="od-move min-h-11 inline-flex items-center rounded-md px-3 text-sm font-medium"
            :class="route.path === '/perfil' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'"
          >
            Perfil
          </RouterLink>
        </div>

        <div class="ml-auto flex items-center gap-1">
          <!-- toggle tema -->
          <button
            class="od-move flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            :aria-label="theme.theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'"
            @click="theme.toggle()"
          >
            <Sun
              v-if="theme.theme === 'dark'"
              class="h-5 w-5"
            />
            <Moon
              v-else
              class="h-5 w-5"
            />
          </button>

          <!-- ≥md: usuário + sair -->
          <div class="hidden min-w-0 items-center gap-4 md:flex">
            <span
              class="max-w-[240px] truncate text-sm text-muted-foreground"
              :title="displayName"
              data-testid="header-user"
            >{{ displayName }}</span>
            <Button
              variant="ghost"
              size="sm"
              class="gap-2 px-3"
              @click="auth.logout()"
            >
              <LogOut
                class="h-4 w-4"
                aria-hidden="true"
              /> Sair
            </Button>
          </div>

          <!-- <md: hambúrguer -->
          <button
            class="od-move flex h-11 w-11 items-center justify-center rounded-md text-foreground hover:bg-muted md:hidden"
            aria-label="Abrir menu"
            data-testid="menu-button"
            @click="menuOpen = true"
          >
            <Menu
              class="h-6 w-6"
              aria-hidden="true"
            />
          </button>
        </div>
      </nav>
    </header>

    <!-- gaveta <md (radix Dialog: foco preso, Esc fecha; fecha ao navegar) -->
    <DialogRoot
      :open="menuOpen"
      @update:open="menuOpen = $event"
    >
      <DialogPortal>
        <DialogOverlay class="fixed inset-0 z-50 bg-black/60 md:hidden" />
        <DialogContent
          aria-label="Menu"
          class="fixed inset-y-0 right-0 z-50 flex w-72 flex-col gap-1 border-l border-border bg-card p-4 shadow-2xl md:hidden"
        >
          <div class="mb-2 flex min-w-0 flex-col px-2 pt-2">
            <span
              class="truncate text-sm font-semibold"
              :title="displayName"
            >{{ displayName }}</span>
          </div>
          <button
            class="od-move flex min-h-11 items-center justify-between rounded-md px-3 text-left text-sm font-medium hover:bg-muted"
            @click="go('/agenda')"
          >
            Agenda
          </button>
          <button
            class="od-move flex min-h-11 items-center justify-between rounded-md px-3 text-left text-sm font-medium hover:bg-muted"
            @click="go('/revisao')"
          >
            Revisão
            <span
              v-if="reviewCount > 0"
              class="od-nowrap inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-warning px-1.5 text-xs font-semibold text-warning-foreground"
            >{{ reviewCount }}</span>
          </button>
          <button
            class="od-move flex min-h-11 items-center gap-2 rounded-md px-3 text-left text-sm font-medium hover:bg-muted"
            @click="go('/perfil')"
          >
            <UserRound class="h-4 w-4" /> Perfil
          </button>
          <div class="mt-auto border-t border-border pt-2">
            <button
              class="od-move flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left text-sm font-medium text-danger hover:bg-muted"
              @click="auth.logout(); closeMenu()"
            >
              <LogOut
                class="h-4 w-4"
                aria-hidden="true"
              /> Sair
            </button>
          </div>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>

    <main class="mx-auto w-full max-w-[1080px] px-4 py-6 md:py-8">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { CalendarDays, LogOut, Menu, Moon, Sun, UserRound } from 'lucide-vue-next';
import { useAuthStore } from '@/app/store/authStore';
import { useThemeStore } from '@/app/store/themeStore';
import { useReviewQuery } from '@/app/composables/queries/useReview.query';
import Button from '../components/ui/button/Button.vue';
import {
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
} from 'radix-vue';

/**
 * Layout autenticado (D3): header horizontal ≥md + gaveta hambúrguer <md (radix
 * Dialog com foco gerenciado, fecha ao navegar — spec B12). Badge de Revisão com o
 * contador da fila; `Nome · e-mail` (decisão 7); toggle de tema (decisão 9).
 */
const auth = useAuthStore();
const theme = useThemeStore();
const route = useRoute();
const router = useRouter();
const menuOpen = ref(false);

const reviewQuery = useReviewQuery();
const reviewCount = computed(() => reviewQuery.data.value?.items.length ?? 0);

const displayName = computed(() => {
  const name = auth.user?.name?.trim();
  return name ? `${name} · ${auth.user?.email}` : (auth.user?.email ?? '');
});

async function go(to: string): Promise<void> {
  menuOpen.value = false;
  await router.push(to);
}

function closeMenu(): void {
  menuOpen.value = false;
}
</script>
