import { describe, expect, it } from 'vitest';
import { verificationCodeEmailHtml } from './verification-email';

/** Email HTML do codigo de confirmacao (Fase 5): marcacao basica e escapamento. */
describe('verificationCodeEmailHtml', () => {
  const html = verificationCodeEmailHtml('482913');

  it('mostra cada digito do codigo em uma caixinha, na ordem', () => {
    // digitos aparecem sozinhos entre as tags das caixinhas
    const boxes = [...html.matchAll(/>(\d)</g)].map((m) => m[1]);
    expect(boxes).toEqual(['4', '8', '2', '9', '1', '3']);
  });

  it('e HTML table-based com o texto alternativo em texto puro no cliente', () => {
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('role="presentation"');
    expect(html).toContain('Confirme');
    expect(html).toContain('15 minutos');
  });

  it('escapa caracteres de HTML vindos do codigo (defensivo, fora do padrao de 6 digitos)', () => {
    const evil = verificationCodeEmailHtml('<b>&x</b>');
    expect(evil).toContain('&lt;b&gt;&amp;x&lt;/b&gt;');
  });
});
