import { describe, expect, it } from 'vitest';
import { NEW_LOGIN_SUBJECT, newLoginEmail } from './new-login-email';

/**
 * Conteúdo do e-mail de novo login (spec sessão-24h, decisão humana nº 3):
 * subject exato, ip + user-agent + data/hora UTC no corpo e o aviso de emergência.
 * Módulo puro — o service decide QUANDO enviar, aqui só o MENSAGEM.
 */

const msg = newLoginEmail({
  to: 'ana@exemplo.com',
  ip: '201.1.2.3',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130',
  at: new Date('2026-10-11T14:05:00Z'),
});

describe('newLoginEmail', () => {
  it('subject exatamente "Novo login na sua conta" (asserção do Gherkin)', () => {
    expect(msg.subject).toBe(NEW_LOGIN_SUBJECT);
    expect(msg.subject).toBe('Novo login na sua conta');
  });

  it('text traz ip, user-agent e data/hora UTC (dd/MM/yyyy HH:mm UTC)', () => {
    expect(msg.to).toBe('ana@exemplo.com');
    expect(msg.text).toContain('201.1.2.3');
    expect(msg.text).toContain('Mozilla/5.0 (Windows NT 10.0) Chrome/130');
    expect(msg.text).toContain('11/10/2026 14:05 UTC');
  });

  it('text traz o aviso "encerre as outras sessões em Perfil → Suas sessões"', () => {
    expect(msg.text).toContain(
      'Se não foi você, acesse a aplicação e encerre as outras sessões em Perfil → Suas sessões.',
    );
  });

  it('ip/user-agent ausentes viram "desconhecido" (sem "null"/"undefined" no e-mail)', () => {
    const m = newLoginEmail({ to: 'a@b.co', ip: null, userAgent: null, at: new Date(0) });
    expect(m.text).toContain('desconhecido');
    expect(m.text).not.toContain('null');
    expect(m.text).not.toContain('undefined');
  });

  it('html presente e escapa HTML do user-agent (barateza defensiva)', () => {
    expect(msg.html).toContain('<table');
    const evil = newLoginEmail({
      to: 'a@b.co',
      ip: null,
      userAgent: '<script>alert(1)</script>',
      at: new Date(0),
    });
    expect(evil.html).not.toContain('<script>alert');
    expect(evil.html).toContain('&lt;script&gt;');
  });
});
