# Prevenção de XSS no Vue 3

## O que é XSS?

**XSS (Cross-Site Scripting)** é uma vulnerabilidade que permite a um atacante injetar código malicioso (JavaScript, HTML) em uma página web, que é executado no navegador do usuário.

## Tipos de XSS

1. **Reflected XSS**: O código malicioso é refletido na resposta do servidor
2. **Stored XSS**: O código malicioso é armazenado no servidor (ex.: banco de dados)
3. **DOM-based XSS**: O código malicioso é injetado via DOM

## Como o Vue 3 previne XSS

### 1. Interpolação `{{ }}` é segura

```vue
<!-- BOM: Vue escapa automaticamente -->
<p>{{ tenant.description }}</p>
```

Se `tenant.description` for `<script>alert('xss')</script>`, o Vue renderiza:

```html
<p>&lt;script&gt;alert('xss')&lt;/script&gt;</p>
```

### 2. `v-html` é PERIGOSO

```vue
<!-- RUIM: v-html não escapa -->
<div v-html="tenant.description"></div>
```

Se `tenant.description` for `<script>alert('xss')</script>`, o Vue renderiza:

```html
<div>
  <script>
    alert("xss");
  </script>
</div>
```

**O script é executado!**

### 3. Como usar `v-html` com segurança

**Opção 1**: Sanitizar com `DOMPurify`

```typescript
import DOMPurify from "dompurify";

const sanitizedDescription = computed(() =>
  DOMPurify.sanitize(tenant.description.value),
);
```

```vue
<div v-html="sanitizedDescription"></div>
```

**Opção 2**: Evitar `v-html` (preferível)

```vue
<!-- BOM: usar interpolação segura -->
<p>{{ tenant.description }}</p>
```

## Checklist de XSS

- [ ] `v-html` **nunca** usado sem sanitização
- [ ] `v-bind:innerHTML` **nunca** usado
- [ ] Interpolação `{{ }}` é segura (Vue escapa automaticamente)
- [ ] Sanitização de HTML com `DOMPurify` (se `v-html` for inevitável)
- [ ] `v-pre` usado com cuidado (desativa interpolação)
- [ ] Não usar `v-once` com dados dinâmicos (pode cachear XSS)

## Exemplos

### Ruim: `v-html` sem sanitização

```vue
<script setup lang="ts">
const { tenant } = useTenant();
</script>

<template>
  <div v-html="tenant.description"></div>
</template>
```

**Risco**: Se `tenant.description` contiver `<script>alert('xss')</script>`, o script é executado.

### Bom: `v-html` com sanitização

```vue
<script setup lang="ts">
import DOMPurify from "dompurify";
import { computed } from "vue";

const { tenant } = useTenant();

const sanitizedDescription = computed(() =>
  DOMPurify.sanitize(tenant.value?.description || ""),
);
</script>

<template>
  <div v-html="sanitizedDescription"></div>
</template>
```

**Seguro**: `DOMPurify` remove tags/scripts maliciosos.

### Bom: Interpolação segura

```vue
<script setup lang="ts">
const { tenant } = useTenant();
</script>

<template>
  <p>{{ tenant.description }}</p>
</template>
```

**Seguro**: Vue escapa automaticamente o HTML.

## Referências

- [OWASP XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/XSS_Prevention_Cheat_Sheet.html)
- [DOMPurify](https://github.com/cure53/DOMPurify)
- [Vue.js Security](https://vuejs.org/guide/essentials/understanding.html)
