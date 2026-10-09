import { describe, expect, it } from 'vitest';
import { scrubEvent } from './error-scrub';

/**
 * Scrub do tracker (Fase 9, spec observabilidade A3/A5; ADR-0016). O evento vai
 * para o SAAS GlitchTip — a politica e do fornecedor externo, nao nossa. Este
 * spec e o seed do smoke: SEMPRE que `beforeSend` deixar um campo de identidade
 * ou corpo de request passar, o teste aponta. `user.id` (uuid interno) e o
 * UNICO identificador permitido, e so quando autenticado.
 */

function baseEvent(over: Record<string, unknown> = {}) {
  return {
    event_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    message: 'explodei',
    ...over,
  } as never;
}

describe('scrubEvent (politica de privacidade do tracker)', () => {
  it('arranca e-mail e telegramId de qualquer canto (extra, tags, user)', () => {
    const out = scrubEvent(
      baseEvent({
        extra: { email: 'ana@exemplo.com', telegramId: '123456789' },
        tags: { usuario: 'ana@exemplo.com', tg: '123456789' },
        user: { id: 'u-uuid', email: 'ana@exemplo.com', telegramId: '123456789' },
      }),
    );
    const json = JSON.stringify(out);
    expect(json).not.toContain('ana@exemplo.com');
    expect(json).not.toContain('123456789');
    // o uuid interno fica (e o gancho de cruzar com o Postgres — assimetria do ADR)
    expect((out as { user?: { id?: string } }).user?.id).toBe('u-uuid');
  });

  it('arranca keys proibidas mesmo aninhadas (req/res/breadcrumbs)', () => {
    const out = scrubEvent(
      baseEvent({
        request: {
          headers: { cookie: 'refresh=abc', authorization: 'Bearer x', 'x-coisa': 'guardado' },
          cookies: { agendabo_refresh: 'segredo' },
          data: { password: 'hunter2', title: 'Consulta' },
        },
        breadcrumbs: [{ message: 'fetch /x', data: { email: 'a@b.c' } }],
      }),
    );
    const json = JSON.stringify(out);
    expect(out).not.toHaveProperty('request'); // o section inteira fora (headers/corps)
    expect(json).not.toContain('hunter2');
    expect(json).not.toContain('segredo');
    expect(json).not.toContain('Bearer x');
    expect(json).not.toContain('a@b.c');
  });

  it('arranca CONTEUDO de conversa/titulo: keys known-lixo + padrao de texto livre', () => {
    const out = scrubEvent(
      baseEvent({
        extra: {
          rawText: 'me marca uma consulta amanha as 10',
          titulo: 'Dentista',
          note: 'reuniao com a diretoria',
          debugFlag: 42, // tecnico fica
        },
      }),
    );
    const json = JSON.stringify(out);
    expect(json).not.toContain('Dentista');
    expect(json).not.toContain('consulta amanha');
    expect(json).toContain('42');
  });

  it('message com e-mail/telegram embutido e sanitizado (regex, nao so keys)', () => {
    const out = scrubEvent(
      baseEvent({ message: 'usuario ana@exemplo.com (tg 987654321) travou no passo titulo' }),
    );
    const json = JSON.stringify(out);
    expect(json).not.toContain('ana@exemplo.com');
    expect(json).not.toContain('987654321');
    expect(json).toContain('passo titulo'); // o contexto tecnico sobrevive
  });

  it('segredo colado em texto livre (chave=valor) e redigitado', () => {
    const out = scrubEvent(
      baseEvent({ message: 'falhou senha=hunter3; api_key: sk-ant-abc123; ok=segue' }),
    );
    const json = JSON.stringify(out);
    expect(json).not.toContain('hunter3');
    expect(json).not.toContain('sk-ant-abc123');
    expect(json).toContain('senha=[redacted]');
    expect(json).toContain('ok=segue'); // o que nao e segredo fica
  });

  it('sem DSN/sem user autenticado: evento segue sem user (e sem crash)', () => {
    const out = scrubEvent(baseEvent());
    expect((out as { user?: unknown }).user).toBeUndefined();
    expect((out as { message: string }).message).toBe('explodei');
  });

  it('event virado a null (drop total) quando o proprio event e so identidade', () => {
    // o contrato do beforeSend: retornar null DESCARTA o evento; um evento sem
    // nada alem de user com identidade nua nao merece existir no tracker
    const out = scrubEvent({ event_id: 'x', user: { email: 'a@b.c' } } as never);
    expect(out).toBeNull();
  });
});
