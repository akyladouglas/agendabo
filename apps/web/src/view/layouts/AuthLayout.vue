<template>
  <main class="flex min-h-dvh items-center justify-center bg-background p-4">
    <div class="w-full max-w-md">
      <div class="mb-6 flex flex-col items-center gap-2 text-center">
        <span class="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <CalendarDays class="h-7 w-7" />
        </span>
        <h1 class="title-page font-heading">
          Agendabô
        </h1>
        <p class="text-sm text-muted-foreground">
          Sua agenda sem complicação, agenda inteligente = dia organizado.
        </p>
      </div>
      <slot />
    </div>
  </main>
</template>

<script setup lang="ts">
import { CalendarDays } from 'lucide-vue-next';

/**
 * Layout das telas de conta (protótipo OpenDesign): card centralizado em fundo
 * próprio, logo verde + tagline. 360px sem scroll horizontal (checklist B16).
 */
</script>
