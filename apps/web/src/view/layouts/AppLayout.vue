<script setup lang="ts">
import { RouterLink } from 'vue-router';
import { useAuthStore } from '@/app/store/authStore';

const auth = useAuthStore();
</script>

<template>
  <div class="min-h-screen bg-background">
    <header class="border-b border-border">
      <nav class="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
        <RouterLink
          to="/agenda"
          class="font-bold"
        >
          Agendabô
        </RouterLink>
        <RouterLink
          to="/agenda"
          class="text-sm text-muted-foreground hover:text-foreground"
        >
          Agenda
        </RouterLink>
        <RouterLink
          to="/revisao"
          class="text-sm text-muted-foreground hover:text-foreground"
        >
          Revisão
        </RouterLink>
        <span class="ml-auto text-sm text-muted-foreground">{{ auth.user?.email }}</span>
        <button
          class="text-sm text-muted-foreground hover:text-foreground"
          @click="auth.logout()"
        >
          Sair
        </button>
      </nav>
    </header>
    <main class="mx-auto max-w-5xl px-4 py-6">
      <slot />
    </main>
  </div>
</template>
