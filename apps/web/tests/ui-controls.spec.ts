import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import AppSwitch from '@/view/components/ui/switch/Switch.vue';
import AppSelect from '@/view/components/ui/select/Select.vue';

/**
 * Regressões do smoke E2E de 2026-10-08 (gotcha #14): os wrappers de primitivos
 * radix-vue precisam usar a API EXATA do primitivo (`checked`/`update:checked`
 * no SwitchRoot; SelectItemIndicator como filho do slot `default` no SelectItem).
 * Os asserts são no ESTADO VISÍVEL (aria-checked, svg do check), nunca no modelo.
 */

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

describe('AppSwitch (radix SwitchRoot)', () => {
  it('renderiza LIGADO quando modelValue=true (regressão: :model-value era attr morto)', async () => {
    const w = mount(AppSwitch, { props: { modelValue: true } });
    await flush();
    const sw = w.find('[role="switch"]');
    expect(sw.attributes('aria-checked')).toBe('true');
    expect(sw.attributes('data-state')).toBe('checked');
    // o atributo HTML morto do bug antigo não pode voltar
    expect(sw.attributes('modelvalue')).toBeUndefined();
    w.unmount();
  });

  it('clique emite update:modelValue com booleano (listener do v-model reage)', async () => {
    const w = mount(AppSwitch, { props: { modelValue: true } });
    await flush();
    await w.find('[role="switch"]').trigger('click');
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual([false]);
    w.unmount();
  });

  it('modelValue=false renderiza desligado', async () => {
    const w = mount(AppSwitch, { props: { modelValue: false } });
    await flush();
    expect(w.find('[role="switch"]').attributes('aria-checked')).toBe('false');
    w.unmount();
  });
});

describe('AppSelect (radix SelectItem)', () => {
  const options = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
  ];

  it('renderiza o check do lado do SELECT FECHADO (trigger, via SelectValue)', async () => {
    // o valor selecionado tem que aparecer no trigger — era o `as-child` do
    // SelectItemText (bug antigo) que comia esse lugar com o check.
    const w = mount(AppSelect, { props: { modelValue: 'a', options }, attachTo: document.body });
    await flush();
    const trigger = w.find('button');
    expect(trigger.text()).toContain('Alpha');
    expect(trigger.find('svg').exists()).toBe(true); // o chevron do trigger
    w.unmount();
    document.body.innerHTML = '';
  });

  it('check do item é filho do slot `default` (template #indicator é engolido)', async () => {
    // happy-dom nao monta o popper do radix (TransitionPresent sem WAAPI): a
    // abertura real foi verificada no smoke E2E do navegador; aqui assenta no
    // CONTRATO que quebrou (gotcha #14) lendo o source do componente — o
    // SelectItemIndicator precisa ser filho DIRETO do SelectItem (slot default),
    // fora do SelectItemText (o typeahead do radix lê só esse slot).
    const src = await import('@/view/components/ui/select/Select.vue?raw');
    const template = (src as { default: string }).default;
    const itemBlock = template.slice(
      template.indexOf('<SelectItem'),
      template.indexOf('</SelectItem>'),
    );
    expect(itemBlock).toContain('<SelectItemIndicator');
    expect(itemBlock).not.toContain('#indicator');
    // o Check está DENTRO do indicador e FORA do SelectItemText
    const indicatorBlock = itemBlock.slice(
      itemBlock.indexOf('<SelectItemIndicator'),
      itemBlock.indexOf('</SelectItemIndicator>'),
    );
    expect(indicatorBlock).toContain('<Check');
    const textBlock = itemBlock.slice(itemBlock.indexOf('<SelectItemText'));
    expect(textBlock).not.toContain('<Check');
  });
});
