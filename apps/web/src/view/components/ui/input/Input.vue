<template>
  <input
    ref="inputEl"
    v-bind="passed"
    :value="modelText"
    :type="props.type ?? 'text'"
    :class="cls"
    @input="onNativeInput"
  >
</template>

<script setup lang="ts">
import { computed, ref, unref, useAttrs, useTemplateRef, watch, type HTMLAttributes } from 'vue';
import { cn } from '@/app/utils/cn';

/**
 * Input padrão da web: tokens do tema, alvo ≥44px <md (spec B15).
 *
 * `inheritAttrs: false` + `v-bind` seletivo: em DEV o vite serve `vee-validate`
 * em cópias diferentes (o import direto da página ≠ o usado por dentro de
 * `@vee-validate/zod`), e o `modelValue` chega aqui como Ref cru em vez de
 * escalar — `scalar()` achata. Quando o emit do v-model é no-op (outra cópia de
 * reatividade), `local` segura o texto digitado para o DOM não "rebobinar".
 *
 * `lastShown` é a memória do último texto exibido: um valor novo que chega do
 * form SEM o usuário ter digitado (ex.: rascunho do cadastro aplicado por
 * `setValue()`) ASSUME o display; um eco do que ele digitou é ignorado.
 *
 * O `onInput` do vee-validate (handleChange) chega nos attrs junto com o
 * v-model; `onNativeInput` os chama com o VALOR lido do DOM (em DEV cada cópia
 * traz seu próprio objeto de evento e o `_value` em cache do Vue ignora o
 * reuso).
 */
defineOptions({ inheritAttrs: false });
const props = defineProps<{
  class?: HTMLAttributes['class'];
  type?: string;
  /** Valor inicial por programa (rascunho do cadastro que volta do /confirmar).
   *  Semente do `local` no setup — independe do vee-validate ecoar o form (em DEV
   *  as multi-cópias engolem `setValue`), então o campo NASCE preenchido. */
  initial?: string;
}>();
const attrs = useAttrs();
const inputEl = useTemplateRef<HTMLInputElement>('inputEl');
const local = ref('');
/** Último texto exibido — chave para distinguir "eco do que digitei" de "setValue do form". */
const lastShown = ref('');

// Semente reativa do `initial` (rascunho): roda na montagem e se o valor chegar
// depois (guard de rota). Não lemos props no root do setup (vue/no-setup-props).
watch(
  () => props.initial,
  (v) => {
    if (v != null && v !== '' && local.value === '') {
      local.value = v;
      lastShown.value = v;
    }
  },
  { immediate: true },
);

/** Só o que não controlamos vai direto ao <input> nativo. */
const passed = computed(() => {
  const {
    class: _cls,
    type: _type,
    value: _v,
    modelValue: _mv,
    'onUpdate:modelValue': _u,
    ...rest
  } = attrs as Record<string, unknown>;
  return rest;
});

/** Refs aninhados (multi-cópia vee-validate em dev) -> escalar. No-op em build.
 * `void v` garante que o efeito chamador dependa do `.value` interno (unwrapping).
 * `unref` é o aprofundamento padrão do Vue; o loop é o fallback para refs de
 * OUTRA cópia do vue (que o `unref` local não reconhece como Ref). */
function scalar(v: unknown): string {
  void v;
  let cur = unref(v);
  for (let i = 0; i < 4 && cur != null && typeof cur === 'object' && 'value' in (cur as object); i++) {
    cur = unref(cur);
  }
  return cur == null ? '' : String(cur);
}

const remoteText = computed(() => scalar(attrs.modelValue ?? undefined));

const modelText = computed(() => {
  // rascunho preenchido por programa via form (remote) vence; o `local` só segura
  // a digitação quando o emit de outra cópia do vee-validate é no-op.
  if (remoteText.value !== '') return remoteText.value;
  return local.value;
});

// Refs aninhados quebram o patch de :value do Vue (ele compara o objeto-Ref, não
// o escalar) — sincronizamos o nó do DOM diretamente. `immediate`: na montagem o
// watch ainda não rodou e um campo nascido preenchido (rascunho) ficaria vazio.
watch(
  modelText,
  (next) => {
    lastShown.value = next;
    if (inputEl.value && inputEl.value.value !== next) inputEl.value.value = next;
  },
  { flush: 'post', immediate: true },
);

// Mudança do form SEM input nativo = preenchimento por programa (rascunho do
// cadastro): assume o `local` (senão ele engolia o valor). Eco da digitação é
// ignorado (now === ultimo exibido).
watch(remoteText, (now, prev) => {
  if (now === prev || now === lastShown.value) return;
  local.value = now;
});

const cls = computed(() =>
  cn(
    'od-move flex h-11 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
    props.class,
  ),
);

/** Chama o handler (ou lista deles) dos attrs com o valor lido do DOM. */
function callAttr(name: string, value: string) {
  const h = (attrs as Record<string, unknown>)[name];
  const invoke = (fn: unknown) => {
    if (typeof fn === 'function') (fn as (v: string) => void)(value);
  };
  if (Array.isArray(h)) h.forEach(invoke);
  else invoke(h);
}

function onNativeInput(event: Event) {
  const value = (event.target as HTMLInputElement).value;
  local.value = value;
  lastShown.value = value;
  // 1) dono do v-model (página) e 2) handleChange do vee-validate (estado+validação)
  callAttr('onUpdate:modelValue', value);
  callAttr('onInput', value);
}
</script>
