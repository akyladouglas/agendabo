<script setup lang="ts">
// Layout das telas de conta (login/cadastro/confirmacao)
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-background p-4">
    <div class="w-full max-w-md">
      <div class="mb-6 text-center">
        <h1 class="text-2xl font-bold">
          Agendabô
        </h1>
        <p class="text-sm text-muted-foreground">
          Sua agenda no Telegram, com visão web.
        </p>
      </div>
      <slot />
    </div>
  </main>
</template>
