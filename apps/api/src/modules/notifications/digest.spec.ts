import { describe, expect, it } from 'vitest';
import { buildDigestBody, digestHeaderPtBr, formatTimeRange } from './digest';

/**
 * Camada pura do resumo diário (2.1, spec regras 17–18 / decisões #5–6).
 * Datas fixas, offset injetado — nada de Intl/relógio real (testing.md).
 *
 * Cenário: America/Sao_Paulo (-03:00) em 08/10/2026. "dia civil" = [08/10 03:00Z, 09/10 03:00Z).
 */

const OFFSET = -180;
const NOW = new Date('2026-10-08T10:00:00Z'); // 07:00 de quinta em SP

const base = {
  now: NOW,
  offsetMinutes: OFFSET,
  header: digestHeaderPtBr(NOW, OFFSET),
  dueHeader: '⏰ Lembretes que vencem hoje:',
  diaLivreText: '☀️ Hoje você está livre!',
};

describe('digest.ts — buildDigestBody', () => {
  it('dia vazio dos dois (nenhum compromisso, nenhum lembrete) => dia livre (decisão #5)', () => {
    const body = buildDigestBody({ ...base, today: [], dueReminders: [] });
    expect(body).toBe('☀️ Hoje você está livre!');
  });

  it('cabeçalho com a data LOCAL (quinta, 08/10), não UTC', () => {
    expect(base.header).toBe('📋 Resumo de quinta-feira, 08/10');
    // 01:00Z ainda é QUARTA 22:00 em SP => o resumo é de quarta
    const beforeMidnightLocal = digestHeaderPtBr(new Date('2026-10-08T01:00:00Z'), OFFSET);
    expect(beforeMidnightLocal).toBe('📋 Resumo de quarta-feira, 07/10');
  });

  it('compromissos do dia em linhas "• dd/mm HH:mm–HH:mm — título"', () => {
    const body = buildDigestBody({
      ...base,
      today: [
        {
          title: 'Consulta',
          startsAt: new Date('2026-10-08T17:00:00Z'), // 14:00 local
          endsAt: new Date('2026-10-08T18:00:00Z'),
        },
      ],
      dueReminders: [],
    });
    expect(body).toContain('📋 Resumo de quinta-feira, 08/10');
    expect(body).toContain('• 08/10 14:00–15:00 — Consulta');
  });

  it('seção "vencem hoje" com compromisso de outra data (decisão #6)', () => {
    const body = buildDigestBody({
      ...base,
      today: [],
      dueReminders: [
        { title: 'Prova', startsAt: new Date('2026-10-20T16:00:00Z') }, // lembrete de 20/10 dispara hoje
      ],
    });
    expect(body).toContain('⏰ Lembretes que vencem hoje:');
    expect(body).toContain('⏰ Lembrete hoje — "Prova" (compromisso 20/10)');
    expect(body).not.toContain('Hoje você está livre');
  });

  it('formatTimeRange: mesmo dia "HH:mm–HH:mm"; fim no dia seguinte mostra o dia', () => {
    expect(
      formatTimeRange(new Date('2026-10-08T17:00:00Z'), new Date('2026-10-08T18:30:00Z'), OFFSET),
    ).toBe('14:00–15:30');
    expect(
      formatTimeRange(new Date('2026-10-08T21:00:00Z'), new Date('2026-10-09T03:30:00Z'), OFFSET),
    ).toBe('18:00–sex 09/10 00:30');
  });
});
