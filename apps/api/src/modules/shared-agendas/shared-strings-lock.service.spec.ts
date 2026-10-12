import { BOT_MESSAGES } from '../bot/messages';
import { SHARED_ACCESS_ENDED, SHARED_GUEST_LEFT } from './shared-agendas.service';

/**
 * T5 (revisão): trava DRY das strings A.3. `SHARED_ACCESS_ENDED`/`SHARED_GUEST_LEFT`
 * (shared-agendas.service.ts) e `BOT_MESSAGES.sharedAccessEnded`/`sharedGuestLeft`
 * (bot/messages.ts) são a MESMA string duplicada de propósito — o grafo de
 * dependências proíbe shared-agendas importar modules/bot (lint:arch). O comentário
 * dos dois lados diz "mude aqui e lá juntos"; este spec é o "juntos" mecânico:
 * um dos lados mudar sozinho, a igualdade profunda abaixo quebra.
 */
describe('trava A.3 — strings do aviso de acesso encerrido (shared-agendas × bot/messages)', () => {
  // exemplo parametrizado: nome vazio, com espaço, acentuado e de marca
  const SAMPLES = ['', 'Ana', 'Ana Souza', 'João Ç. <x>', 'Dona’1'];

  it.each(SAMPLES.map((n) => [n]))('sharedAccessEnded(%j): os dois lados idênticos', (name) => {
    expect(SHARED_ACCESS_ENDED(name)).toBe(BOT_MESSAGES.sharedAccessEnded(name));
    // deep-equal explícito (a string é o payload inteiro):
    expect({ text: SHARED_ACCESS_ENDED(name) }).toStrictEqual({
      text: BOT_MESSAGES.sharedAccessEnded(name),
    });
  });

  it.each(SAMPLES.map((n) => [n]))('sharedGuestLeft(%j): os dois lados idênticos', (name) => {
    expect(SHARED_GUEST_LEFT(name)).toBe(BOT_MESSAGES.sharedGuestLeft(name));
    expect({ text: SHARED_GUEST_LEFT(name) }).toStrictEqual({
      text: BOT_MESSAGES.sharedGuestLeft(name),
    });
  });
});
