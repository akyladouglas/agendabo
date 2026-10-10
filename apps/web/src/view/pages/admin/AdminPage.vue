<template>
  <AppLayout>
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h1 class="title-page">
          Observabilidade
        </h1>
        <AppBadge
          v-if="page.isAdmin.value"
          tone="info"
          data-testid="admin-role"
        >
          admin
        </AppBadge>
        <AppBadge
          v-else-if="page.selfView.value"
          tone="muted"
          data-testid="admin-role"
        >
          meus eventos
        </AppBadge>
      </div>

      <!-- carregando o papel (nunca tela em branco — regra vue 8) -->
      <div
        v-if="page.meQuery.isPending.value"
        class="flex flex-col gap-3"
      >
        <AppSkeleton class="h-10 w-64" />
        <AppSkeleton class="h-40" />
      </div>

      <!-- sessão expirada (a query de permissão é retry:false) -->
      <div
        v-else-if="page.sessionExpired.value"
        class="flex flex-col items-start gap-3 rounded-lg border border-border p-4"
        role="alert"
        data-testid="admin-session"
      >
        <p class="text-sm text-foreground">
          Sua sessão expirou. Entre de novo para ver esta página.
        </p>
        <AppButton
          variant="outline"
          size="sm"
          @click="goLogin"
        >
          Ir para o login
        </AppButton>
      </div>

      <!-- sem acesso: a rota não existe para quem não é admin nem rollout
           (a API responde 404 de propósito — nada vaza) -->
      <div
        v-else-if="page.denied.value"
        class="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-14 text-center"
        data-testid="admin-denied"
      >
        <Lock
          class="h-9 w-9 text-muted-foreground"
          aria-hidden="true"
        />
        <p class="text-sm font-medium text-foreground">
          Acesso restrito
        </p>
        <p class="text-xs text-muted-foreground">
          Esta página existe apenas para administradores e usuários liberados
          pelo administrador.
        </p>
      </div>

      <AdminTabs
        v-else
        :vm="page"
      />
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
/**
 * Página de observabilidade (Fase 9 — a "UI de auditoria" da spec): rota os
 * três estados de papel (carregando / sessão expirada / negado) e delega as
 * abas a `AdminTabs.vue`. O papel vem SEMPRE da API (`/observabilidade/me`);
 * a guarda de verdade é do server — esta página só decide o que renderizar.
 */
import { useRoute, useRouter } from 'vue-router';
import { Lock } from 'lucide-vue-next';
import { asAdminTab, useAdminPage } from '@/app/composables/useAdminPage.composable';
import AppBadge from '@/view/components/ui/badge/Badge.vue';
import AppButton from '@/view/components/ui/button/Button.vue';
import AppSkeleton from '@/view/components/ui/skeleton/Skeleton.vue';
import AppLayout from '@/view/layouts/AppLayout.vue';
import AdminTabs from './AdminTabs.vue';

const router = useRouter();
// `aba` é NAVEGÁVEL (?aba=custo) — usa useRoute (a location injeta).
const route = useRoute();
const page = useAdminPage(asAdminTab(route.query.aba));

function goLogin(): void {
  void router.push({ name: 'login' });
}
</script>
