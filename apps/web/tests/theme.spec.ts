import { describe, expect, it } from 'vitest';
import {
  applyThemeToDocument,
  resolveInitialTheme,
} from '../src/app/store/themeStore';

/**
 * Tema (decisão 9): escuro é o default do produto; o toggle persistido manda,
 * depois prefers-color-scheme. Lógica pura fora do store p/ teste.
 */
describe('resolveInitialTheme', () => {
  it('toggle persistido vence tudo', () => {
    expect(resolveInitialTheme('light', false)).toBe('light');
    expect(resolveInitialTheme('dark', true)).toBe('dark');
  });

  it('sem preferências -> escuro (default do produto)', () => {
    expect(resolveInitialTheme(null, false)).toBe('dark');
  });

  it('sem toggle, sistema claro -> claro', () => {
    expect(resolveInitialTheme(null, true)).toBe('light');
  });

  it('lixo no storage cai no sistema', () => {
    expect(resolveInitialTheme('garbage', true)).toBe('light');
    expect(resolveInitialTheme('garbage', false)).toBe('dark');
  });
});

describe('applyThemeToDocument', () => {
  it('escreve data-theme no elemento', () => {
    const el = document.createElement('html');
    applyThemeToDocument(el, 'light');
    expect(el.getAttribute('data-theme')).toBe('light');
    applyThemeToDocument(el, 'dark');
    expect(el.getAttribute('data-theme')).toBe('dark');
  });

  it('elemento nulo não explode', () => {
    expect(() => applyThemeToDocument(null, 'dark')).not.toThrow();
  });
});
