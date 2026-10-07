import { AgendaQueryService, AGENDA_QUERY_MAX_LIST } from './agenda-query.service';
import type { ConsultaPeriodo } from '../ai/consulta-interpreter.service';
import type { BotUser } from './bot-access.service';

/**
 * AgendaQueryService (Fase 2): orquestração do turno de leitura com bordas mockadas
 * (LLM interpretador + banco). Casos: símbolos (via stub do interpretador que devolve
 * o resultado já classificado), intervalo explícito, vazio, truncamento (decisão #4),
 * agregado (decisão #8), falha do interpretador => pergunta (spec #5).
 */

const USER: BotUser = { id: 'u1', telegramId: '111', timezone: 'America/Sao_Paulo' };
const NOW = new Date('2026-10-07T11:00:00Z'); // 08:00 local SP
const OFFSET = -180;

function make(interpreterResult: ConsultaPeriodo) {
  const findMany = jest.fn().mockResolvedValue([]);
  const interpreter = { interpret: jest.fn().mockResolvedValue(interpreterResult) };
  const appointments = { listOverlapping: jest.fn().mockResolvedValue([]) };
  const svc = new AgendaQueryService(interpreter as never, appointments as never);
  const run = (text = 'o que tenho hoje?') =>
    svc.run(USER, { text, offsetMinutes: OFFSET, now: NOW });
  return { svc, run, findMany, interpreter, appointments };
}

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `a${i}`,
    title: `Compromisso ${i + 1}`,
    startsAt: new Date(`2026-10-0${(i % 3) + 7}T12:00:00Z`),
    endsAt: new Date(`2026-10-0${(i % 3) + 7}T13:00:00Z`),
    status: 'confirmed',
  }));

describe('AgendaQueryService', () => {
  it('símbolo "hoje": resolve no tz do usuário, lista e formata no cabeçalho (spec #9)', async () => {
    const { run, appointments } = make({ ok: true, simbolo: 'hoje', confidence: 0.95 });
    appointments.listOverlapping.mockResolvedValue([
      {
        id: 'a1',
        title: 'Consulta dentista',
        startsAt: new Date('2026-10-07T15:00:00Z'), // 12:00 local
        endsAt: new Date('2026-10-07T16:00:00Z'), // 13:00 local
        status: 'confirmed',
      },
    ]);

    const result = await run();

    // meia-noite local SP = 03:00Z (ADR-002): nunca 00:00Z
    expect(appointments.listOverlapping).toHaveBeenCalledWith(
      'u1',
      new Date('2026-10-07T03:00:00Z'),
      new Date('2026-10-08T03:00:00Z'),
      ['confirmed', 'needs_review'],
    );
    expect(result.awaitingPeriod).toBe(false);
    expect(result.replies[0]).toContain('Isto é o que você tem em 07/10:');
    expect(result.replies[0]).toContain('12:00–13:00 — Consulta dentista');
    expect(result.replies).toHaveLength(1);
  });

  it('intervalo explícito: datas locais -> UTC meia-noite local (spec #6)', async () => {
    const { run, appointments } = make({
      ok: true,
      intervalo: { from: '2026-10-10', to: '2026-10-13' },
      confidence: 0.9,
    });

    await run('o que tenho de 10 a 12?');

    expect(appointments.listOverlapping).toHaveBeenCalledWith(
      'u1',
      new Date('2026-10-10T03:00:00Z'),
      new Date('2026-10-13T03:00:00Z'),
      ['confirmed', 'needs_review'],
    );
  });

  it('vazio: mensagem de vazio e NADA mais (spec #10)', async () => {
    const { run } = make({ ok: true, simbolo: 'amanha', confidence: 0.9 });

    const result = await run('amanhã?');

    expect(result.replies).toEqual(['Você não tem nada nesse período 👌']);
  });

  it(`muitos resultados: truncar em ${AGENDA_QUERY_MAX_LIST} e oferecer o resto (decisão #4)`, async () => {
    const { run, appointments } = make({ ok: true, simbolo: 'este_mes', confidence: 0.9 });
    appointments.listOverlapping.mockResolvedValue(rows(12));

    const result = await run();

    expect(result.replies).toHaveLength(2);
    expect(result.replies[0]).toContain('Compromisso 10');
    expect(result.replies[0]).not.toContain('Compromisso 11');
    expect(result.replies[1]).toContain('E mais 2');
  });

  it('período muito amplo (>=30): resposta agregada com contagem (decisão #8)', async () => {
    const { run, appointments } = make({ ok: true, simbolo: 'este_ano', confidence: 0.9 });
    appointments.listOverlapping.mockResolvedValue(rows(34));

    const result = await run();

    expect(result.replies).toHaveLength(1);
    expect(result.replies[0]).toContain('34 compromissos');
    expect(result.replies[0]).toContain('mês a mês');
    expect(result.replies[0]).not.toContain('Compromisso 11');
  });

  it('interpretador falhou (confiança baixa): PERGUNTA o período, nenhuma query ao banco (spec #5)', async () => {
    const { run, appointments } = make({ ok: false, reason: 'low_confidence' });

    const result = await run('meus compromissos');

    expect(result.awaitingPeriod).toBe(true);
    expect(result.replies[0]).toContain('Para qual período');
    expect(appointments.listOverlapping).not.toHaveBeenCalled();
  });

  it('interpretador devolveu intervalo inválido: pergunta, não chuta (ADR-003)', async () => {
    // o serviço recebe o resultado normalizado; o caso "to < from" é rejeitado na
    // camada pura — simulamos o guard pedindo o período de volta.
    const { run, appointments } = make({
      ok: true,
      intervalo: { from: '2026-10-12', to: '2026-10-11' },
      confidence: 0.9,
    });

    const result = await run();

    expect(result.awaitingPeriod).toBe(true);
    expect(appointments.listOverlapping).not.toHaveBeenCalled();
  });

  it('fora_do_escopo no interpretador: pergunta educadamente (a intent já roteou)', async () => {
    const { run } = make({ ok: false, reason: 'fora_do_escopo' });

    const result = await run('blz?');

    expect(result.awaitingPeriod).toBe(true);
    expect(result.replies[0]).toContain('Para qual período');
  });

  it('needs_review aparece com o marcador; confirmed sem (decisão #3)', async () => {
    const { run, appointments } = make({ ok: true, simbolo: 'hoje', confidence: 0.9 });
    appointments.listOverlapping.mockResolvedValue([
      {
        id: 'a1',
        title: 'Aprovado',
        startsAt: new Date('2026-10-07T12:00:00Z'),
        endsAt: new Date('2026-10-07T13:00:00Z'),
        status: 'confirmed',
      },
      {
        id: 'a2',
        title: 'Dentista <10>',
        startsAt: new Date('2026-10-07T14:00:00Z'),
        endsAt: new Date('2026-10-07T15:00:00Z'),
        status: 'needs_review',
      },
    ]);

    const result = await run();

    expect(result.replies[0]).toContain('Aprovado');
    expect(result.replies[0]).toContain('⚠️ conferindo');
    // gotcha 6: título dinâmico com < precisa chegar escapado no HTML do Telegram
    expect(result.replies[0]).toContain('Dentista &lt;10&gt;');
  });
});
