import { describe, expect, it } from 'vitest';
import {
  classificarEdicao,
  classificarExtracao,
  dayFromResolvedUtc,
  type EdicaoVeredito,
  type ExtracaoVeredito,
} from './extraction-ruler';

/**
 * A RÉGUA da Fase 4 (spec llm-avancado regra 6 / D1 do plano) — domínio puro, testado
 * ANTES da máquina mexer (risco de regressão do plano). Payload no shape BRUTO da tool
 * `extrair_agendamento` (o safeParse do zod é a primeira barreira; a régua é a segunda).
 */

const MIN_CONF = 0.7;
const NOW = new Date('2026-10-06T15:00:00Z'); // 12:00 em America/Sao_Paulo (-180)
const OFFSET = -180;

function payload(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Consulta',
    startsAt: '2026-10-08T14:00:00-03:00',
    durationMinutes: 60,
    confidence: 0.9,
    dateEvidence: 'quinta que vem umas 14h',
    ...overrides,
  };
}

function classify(overrides: Record<string, unknown> = {}): ExtracaoVeredito {
  return classificarExtracao(payload(overrides), {
    minConfidence: MIN_CONF,
    now: NOW,
    offsetMinutes: OFFSET,
  });
}

describe('classificarExtracao — a régua (spec regra 6)', () => {
  it('aceito: confianca >= limiar e data futura => startUtc/endUtc materializados', () => {
    const v = classify();
    expect(v.verdict).toBe('aceito');
    if (v.verdict === 'aceito') {
      expect(v.candidate.startUtc.toISOString()).toBe('2026-10-08T17:00:00.000Z');
      expect(v.candidate.endUtc.toISOString()).toBe('2026-10-08T18:00:00.000Z');
      expect(v.candidate.title).toBe('Consulta');
      expect(v.candidate.dateEvidence).toBe('quinta que vem umas 14h');
    }
  });

  it('duracao ausente => default da borda 60min (contrato do schema)', () => {
    const v = classify({ durationMinutes: undefined });
    expect(v.verdict).toBe('aceito');
    if (v.verdict === 'aceito') {
      expect(v.candidate.endUtc.getTime() - v.candidate.startUtc.getTime()).toBe(60 * 60_000);
    }
  });

  it('fraco: confianca baixa COM titulo e inicio => needs_review confianca_baixa', () => {
    const v = classify({ confidence: 0.4 });
    expect(v.verdict).toBe('fraco');
    if (v.verdict === 'fraco') {
      expect(v.reviewReason).toBe('confianca_baixa');
      expect(v.candidate.startUtc.toISOString()).toBe('2026-10-08T17:00:00.000Z');
    }
  });

  it('suspeito: confianca alta mas o instante resolvido esta no PASSADO => needs_review', () => {
    const v = classify({ startsAt: '2026-10-06T09:00:00-03:00' }); // hoje 09:00, agora 12:00 local
    expect(v.verdict).toBe('suspeito');
    if (v.verdict === 'suspeito') {
      expect(v.reviewReason).toBe('data_no_passado');
    }
  });

  it('sem-quando: inicio ilegivel => re-pergunta (nunca needs_review na criacao)', () => {
    const v = classify({ startsAt: '2026-13-45T99:00:00-03:00' }); // data impossível
    expect(v.verdict).toBe('sem_quando');
  });

  it('inicio sem offset explicito => sem_quando (borda precisa do offset — ADR-002); a regex do zod já barra, a régua é cinto de segurança', () => {
    const v = classify({ startsAt: '2026-10-08T14:00:00' });
    expect(v.verdict).toBe('sem_quando');
  });

  it('offset devolvido inconsistente com o tz do usuario => fraco/parse_falho (spec regra 3: nunca confirmado em silêncio)', () => {
    // conta em -03:00, payload em -05:00: "quinta 14:00" não bate com o tz da conta
    const v = classify({ startsAt: '2026-10-08T14:00:00-05:00' });
    expect(v.verdict).toBe('fraco');
    if (v.verdict === 'fraco') expect(v.reviewReason).toBe('parse_falho');
  });

  it('offset consistente (mesma conta em outro horário) NÃO é rejeitado', () => {
    const v = classify({ startsAt: '2026-10-08T20:30:00-03:00' });
    expect(v.verdict).toBe('aceito');
  });

  it('titulo vazio => invalido (cai no guiado em titulo — spec regra 5)', () => {
    const v = classify({ title: '   ' });
    expect(v.verdict).toBe('invalido');
    if (v.verdict === 'invalido') expect(v.reason).toBe('sem_titulo');
  });

  it('instante exatamente AGORA não é passado (half-open: só < now é suspeito)', () => {
    const v = classify({ startsAt: '2026-10-06T12:00:00-03:00' }); // == NOW
    expect(v.verdict).toBe('aceito');
  });

  it('dayFromResolvedUtc: dia no calendario local do usuario (quando parcial — decisao #5)', () => {
    // a borda resolveu "quinta" no tz da conta: qui 08/10 09:00 local (-03:00) = 12:00Z
    const day = dayFromResolvedUtc(new Date('2026-10-08T12:00:00Z'), OFFSET);
    expect(day).toEqual({ year: 2026, month: 10, day: 8 });
  });

  it('dayFromResolvedUtc: instante invalido => null (guiado do zero)', () => {
    expect(dayFromResolvedUtc(new Date('quando der'), OFFSET)).toBeNull();
  });
});

describe('classificarEdicao — quando novo do editar (spec regra 10/20)', () => {
  function edit(overrides: Record<string, unknown> = {}): EdicaoVeredito {
    return classificarEdicao(
      {
        acao: 'editar',
        confidence: 0.9,
        novoInicio: '2026-10-09T16:00:00-03:00',
        ...overrides,
      },
      { minConfidence: MIN_CONF, now: NOW, offsetMinutes: OFFSET },
    );
  }

  it('novo inicio confiante e futuro => ok com novoStartUtc (borda materializou a data)', () => {
    const v = edit();
    expect(v.verdict).toBe('ok');
    if (v.verdict === 'ok') {
      expect(v.novoStartUtc?.toISOString()).toBe('2026-10-09T19:00:00.000Z');
    }
  });

  it('sem horario novo na fala (nem novoInicio, nem delta) => re-pergunta o horario', () => {
    const v = edit({ novoInicio: undefined });
    expect(v.verdict).toBe('reperguntar');
    if (v.verdict === 'reperguntar') expect(v.reason).toBe('sem_quando');
  });

  it('apenas delta ("adianta 1h") => ok SEM novoStartUtc (a borda aplica applyShift na candidata)', () => {
    const v = edit({ novoInicio: undefined, deslocamentoMin: -60 });
    expect(v.verdict).toBe('ok');
    if (v.verdict === 'ok') expect(v.novoStartUtc).toBeUndefined();
  });

  it('confianca baixa com horario plausivel => reperguntar confianca_baixa (NUNCA needs_review — regra 20)', () => {
    const v = edit({ confidence: 0.3 });
    expect(v.verdict).toBe('reperguntar');
    if (v.verdict === 'reperguntar') expect(v.reason).toBe('confianca_baixa');
  });

  it('novo horario no passado => reperguntar data_no_passado', () => {
    const v = edit({ novoInicio: '2026-10-05T14:00:00-03:00' });
    expect(v.verdict).toBe('reperguntar');
    if (v.verdict === 'reperguntar') expect(v.reason).toBe('data_no_passado');
  });

  it('offset inconsistente com o tz da conta => reperguntar offset_inconsistente (spec regra 3)', () => {
    const v = edit({ novoInicio: '2026-10-09T16:00:00-05:00' });
    expect(v.verdict).toBe('reperguntar');
    if (v.verdict === 'reperguntar') expect(v.reason).toBe('offset_inconsistente');
  });

  it('novaDuracaoMin acompanha o ok (mudar duracao junto do horario)', () => {
    const v = edit({ novaDuracaoMin: 90 });
    expect(v.verdict).toBe('ok');
    if (v.verdict === 'ok') expect(v.novaDuracaoMin).toBe(90);
  });
});
