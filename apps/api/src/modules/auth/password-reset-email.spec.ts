import { describe, expect, it } from 'vitest';
import { passwordResetEmailHtml } from './password-reset-email';

/** E-mail HTML do magic link de reset (spec regra 7): marcacao, link e escapamento. */
describe('passwordResetEmailHtml', () => {
  const link = 'http://localhost:5174/redefinir-senha?token=aa11bb22';
  const html = passwordResetEmailHtml(link);

  it('e HTML table-based no tema do produto com o botao "Redefinir senha"', () => {
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('role="presentation"');
    expect(html).toContain('Redefinir senha');
  });

  it('usa o link no botao E no texto alternativo, e avisa o TTL de 1 hora', () => {
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual([link, link]); // botao + link copiavel
    expect(html).toContain('1 hora');
    // o HTML usa entidades (&eacute; s&oacute; ignorar) — testar "ignore" cru era burro
    expect(html).toContain('ignorar este e-mail');
  });

  it('escapa caracteres de HTML vindos do link (defensivo, gotcha 6)', () => {
    const evil = passwordResetEmailHtml('https://x.com/<b>&a</b>');
    expect(evil).toContain('&lt;b&gt;&amp;a&lt;/b&gt;');
    expect(evil).not.toContain('href="https://x.com/<b>');
  });
});
