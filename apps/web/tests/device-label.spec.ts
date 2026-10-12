import { describe, expect, it } from 'vitest';
import { deviceLabel, formatSessionDate } from '../src/app/utils/deviceLabel';

/**
 * Label de sessão (spec sessao-24h: seção "Suas sessões ativas"): UA crua →
 * "SO · Navegador". Funcao pura e deterministica — os UAs abaixo sao literais
 * reais; nada de navigator nos testes (testing.md).
 */
describe('deviceLabel', () => {
  it('Chrome no Windows', () => {
    expect(
      deviceLabel(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      ),
    ).toBe('Windows · Chrome');
  });

  it('Edge no Windows (Edg/ vence Chrome/ da compatibilidade)', () => {
    expect(
      deviceLabel(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
      ),
    ).toBe('Windows · Edge');
  });

  it('Firefox no Windows', () => {
    expect(
      deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0'),
    ).toBe('Windows · Firefox');
  });

  it('Safari no macOS', () => {
    expect(
      deviceLabel(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
      ),
    ).toBe('macOS · Safari');
  });

  it('Safari no iPhone (UA tambem traz "Version/... Safari")', () => {
    expect(
      deviceLabel(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('iPhone · Safari');
  });

  it('Chrome no Android', () => {
    expect(
      deviceLabel(
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
      ),
    ).toBe('Android · Chrome');
  });

  it('Chrome no Linux', () => {
    expect(
      deviceLabel(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      ),
    ).toBe('Linux · Chrome');
  });

  it('SO reconhecido sem navegador reconhecido → so o SO', () => {
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0) SomeWeirdBot/1.0')).toBe('Windows');
  });

  it('null → Dispositivo desconhecido', () => {
    expect(deviceLabel(null)).toBe('Dispositivo desconhecido');
  });

  it('string vazia/desconhecida → Dispositivo desconhecido', () => {
    expect(deviceLabel('')).toBe('Dispositivo desconhecido');
    expect(deviceLabel('coisa aleatoria')).toBe('Dispositivo desconhecido');
  });
});

describe('formatSessionDate (UTC, dd/MM HH:mm)', () => {
  it('formata em UTC independente do relogio do teste', () => {
    expect(formatSessionDate(new Date('2026-10-10T09:05:00Z'))).toBe('10/10 09:05');
  });

  it('dia/mes com zero a esquerda', () => {
    expect(formatSessionDate(new Date('2026-01-02T23:59:00Z'))).toBe('02/01 23:59');
  });
});
