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

  // ---------- seção compartilhada (spec compartilhamento E.23, decisão D8) ----------

  const corpoSemSecoes = (over: { today?: never[] | { title: string; startsAt: Date; endsAt: Date }[]; dueReminders?: { title: string; startsAt: Date }[] }) =>
    buildDigestBody({ ...base, today: over.today ?? [], dueReminders: over.dueReminders ?? [] });

  it('seções AUSENTES ou VAZIAS: corpo byte a byte IDÊNTICO ao atual (zero regressão)', () => {
    const hoje = [
      {
        title: 'Consulta',
        startsAt: new Date('2026-10-08T17:00:00Z'),
        endsAt: new Date('2026-10-08T18:00:00Z'),
      },
    ];
    const due = [{ title: 'Prova', startsAt: new Date('2026-10-20T16:00:00Z') }];

    // dia cheio
    expect(buildDigestBody({ ...base, today: hoje, dueReminders: due, sharedSections: [] })).toBe(
      corpoSemSecoes({ today: hoje, dueReminders: due }),
    );
    // dia livre
    expect(buildDigestBody({ ...base, today: [], dueReminders: [], sharedSections: [] })).toBe(
      corpoSemSecoes({}),
    );
    // só lembretes
    expect(buildDigestBody({ ...base, today: [], dueReminders: due, sharedSections: [] })).toBe(
      corpoSemSecoes({ dueReminders: due }),
    );
  });

  it('dia livre do convidado + seção compartilhada: corpo NÃO é o "dia livre" (a seção entra)', () => {
    const body = buildDigestBody({
      ...base,
      today: [],
      dueReminders: [],
      sharedSections: [
        {
          ownerName: 'Fulano',
          items: [
            {
              title: 'Reunião',
              startsAt: new Date('2026-10-08T17:00:00Z'), // 14:00 no fuso do convidado
              endsAt: new Date('2026-10-08T18:00:00Z'),
            },
          ],
        },
      ],
    });
    expect(body).not.toBe('☀️ Hoje você está livre!');
    expect(body).toContain('🤝 Agenda de Fulano:');
    expect(body).toContain('• 08/10 14:00–15:00 — Reunião');
    expect(body).toContain('📋 Resumo de quinta-feira, 08/10');
  });

  it('1 seção: bloco "🤝 Agenda de X:" APÓS os itens próprios (antes da seção de lembretes)', () => {
    const body = buildDigestBody({
      ...base,
      today: [
        {
          title: 'Consulta',
          startsAt: new Date('2026-10-08T17:00:00Z'),
          endsAt: new Date('2026-10-08T18:00:00Z'),
        },
      ],
      dueReminders: [{ title: 'Prova', startsAt: new Date('2026-10-20T16:00:00Z') }],
      sharedSections: [
        {
          ownerName: 'Fulano',
          items: [
            {
              title: 'Reunião',
              startsAt: new Date('2026-10-08T21:00:00Z'), // 18:00 local do CONVIDADO
              endsAt: new Date('2026-10-08T22:00:00Z'),
            },
          ],
        },
      ],
    });
    const lines = body.split('\n');
    expect(lines).toContain('• 08/10 14:00–15:00 — Consulta');
    const idxSharedHeader = lines.indexOf('🤝 Agenda de Fulano:');
    expect(idxSharedHeader).toBeGreaterThan(-1);
    expect(lines.indexOf('• 08/10 18:00–19:00 — Reunião')).toBeGreaterThan(idxSharedHeader);
    // a seção "vencem hoje" continua DEPOIS das seções compartilhadas
    expect(lines.indexOf('⏰ Lembretes que vencem hoje:')).toBeGreaterThan(idxSharedHeader);
    expect(body).toContain('⏰ Lembrete hoje — "Prova"');
  });

  it('N seções: uma por dono, na ordem recebida (estável), cada uma com seus itens', () => {
    const body = buildDigestBody({
      ...base,
      today: [],
      dueReminders: [],
      sharedSections: [
        {
          ownerName: 'Ana',
          items: [
            {
              title: 'Consulta',
              startsAt: new Date('2026-10-08T14:00:00Z'), // 11:00 local
              endsAt: new Date('2026-10-08T15:00:00Z'),
            },
          ],
        },
        {
          ownerName: 'Bruno',
          items: [
            {
              title: 'Obra',
              startsAt: new Date('2026-10-08T16:00:00Z'), // 13:00 local
              endsAt: new Date('2026-10-08T17:00:00Z'),
            },
            {
              title: 'Jantar',
              startsAt: new Date('2026-10-08T22:00:00Z'), // 19:00 local
              endsAt: new Date('2026-10-08T23:00:00Z'),
            },
          ],
        },
      ],
    });
    const lines = body.split('\n');
    expect(lines.indexOf('🤝 Agenda de Ana:')).toBeGreaterThan(-1);
    expect(lines.indexOf('🤝 Agenda de Bruno:')).toBeGreaterThan(lines.indexOf('🤝 Agenda de Ana:'));
    expect(lines).toContain('• 08/10 11:00–12:00 — Consulta');
    expect(lines).toContain('• 08/10 13:00–14:00 — Obra');
    expect(lines).toContain('• 08/10 19:00–20:00 — Jantar');
  });

  it('itens compartilhados usam o MESMO horário local do convidado (offsetMinutes do input)', () => {
    // 21:00Z = 18:00 em -180 (fuso do convidado) — nunca a hora do dono/UTC
    const body = buildDigestBody({
      ...base,
      today: [],
      dueReminders: [],
      sharedSections: [
        {
          ownerName: 'Marta',
          items: [
            {
              title: 'Auditória',
              startsAt: new Date('2026-10-08T21:00:00Z'),
              endsAt: new Date('2026-10-08T22:30:00Z'),
            },
          ],
        },
      ],
    });
    expect(body).toContain('• 08/10 18:00–19:30 — Auditória');
    expect(body).not.toContain('21:00–');
  });
});
