<script setup lang="ts">
// Fase 6: email + senha + telegramId com UI explicando o @userinfobot
import AuthLayout from '@/view/layouts/AuthLayout.vue';
import Card from '@/view/components/ui/card/Card.vue';
</script>

<template>
  <AuthLayout>
    <Card>
      <h2 class="text-lg font-semibold">
        Criar conta
      </h2>
      <p class="mt-2 text-sm text-muted-foreground">
        Formulário chega na Fase 6. Dica: seu telegramId é o <em>Id</em> numérico que o
        <strong>@userinfobot</strong> devolve quando você manda qualquer mensagem pra ele.
      </p>
    </Card>
  </AuthLayout>
</template>
