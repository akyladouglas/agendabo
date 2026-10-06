<script setup lang="ts">
// Fase 6: codigo de 6 digitos + contador de reenvios (max 3 / 30min)
import AuthLayout from '@/view/layouts/AuthLayout.vue';
import Card from '@/view/components/ui/card/Card.vue';
</script>

<template>
  <AuthLayout>
    <Card>
      <h2 class="text-lg font-semibold">
        Confirmar email
      </h2>
      <p class="mt-2 text-sm text-muted-foreground">
        Digite o código de 6 dígitos enviado para o seu email. Tela chega na Fase 6.
      </p>
    </Card>
  </AuthLayout>
</template>
