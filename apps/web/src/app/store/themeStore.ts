import { defineStore } from 'pinia';
import { ref } from 'vue';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = '***';

/** Tema inicial: toggle persistido > prefers-color-scheme > escuro (default do produto). */
export function resolveInitialTheme(
  stored: string | null,
  prefersLight: boolean,
): Theme {
  if (stored === 'dark' || stored === 'light') return stored;
  return prefersLight ? 'light' : 'dark';
}

/** Efeito de aplicação do tema (fora do store p/ teste puro). */
export function applyThemeToDocument(el: HTMLElement | null, theme: Theme): void {
  el?.setAttribute('data-theme', theme);
}

/**
 * Tema claro/escuro (decisão 9 da spec web): ESCURO é o default; a escolha inicial
 * vem de `prefers-color-scheme` e o toggle persiste em localStorage (é preferência
 * de UI, não dado de servidor — pode viver fora do authStore).
 */
export const useThemeStore = defineStore('theme', () => {
  const theme = ref<Theme>('dark');

  function init(): void {
    let stored: string | null = null;
    let prefersLight = false;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
      prefersLight = window.matchMedia?.('(prefers-color-scheme: light)').matches ?? false;
    } catch {
      // sem storage/matchMedia (SSR/teste): cai no default escuro
    }
    theme.value = resolveInitialTheme(stored, prefersLight);
    applyThemeToDocument(document.documentElement, theme.value);
  }

  function apply(value: Theme): void {
    theme.value = value;
    applyThemeToDocument(document.documentElement, value);
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // storage indisponível: o tema vale para a sessão, não persiste
    }
  }

  function toggle(): void {
    apply(theme.value === 'dark' ? 'light' : 'dark');
  }

  return { theme, init, apply, toggle };
});
