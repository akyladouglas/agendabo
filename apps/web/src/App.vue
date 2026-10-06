<script setup lang="ts">
import { Toaster } from 'vue-sonner';
</script>

<template>
  <RouterView />
  <Toaster
    position="top-right"
    rich-colors
  />
</template>
