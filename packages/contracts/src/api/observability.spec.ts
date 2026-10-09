import { describe, expect, it } from 'vitest';
import {
  botEventStageSchema,
  botEventsQuerySchema,
  botEventTypeSchema,
  llmUsageQuerySchema,
  parseBotEventMetadata,
  updateObservabilityRolloutInputSchema,
} from './observability';

/**
 * Fase 9 — contratos de observabilidade (spec observabilidade; ADR-0017).
 * O que importa aqui e NAO importa la: o zod e o gate que impede conteudo de
 * conversa (fala, titulo, nota, e-mail) de entrar em bot_events/llm_calls.
 */

const A_ID = '3f0f1e2c-1111-4aaa-8bbb-ccccdddd0001';
const B_ID = '3f0f1e2c-2222-4aaa-8bbb-ccccdddd0002';

describe('botEventTypeSchema / stage (enums fechados)', () => {
  it('so aceita os tipos conhecidos do enum Prisma', () => {
    expect(botEventTypeSchema.parse('flow_started')).toBe('flow_started');
    expect(() => botEventTypeSchema.parse('usuario_inventou_um_tipo')).toThrow();
  });

  it('stage e identificador controlado pelo codigo — fala nao passa', () => {
    expect(botEventStageSchema.parse('conflict.moving_piece')).toBe('conflict.moving_piece');
    expect(() => botEventStageSchema.parse('ola tudo bem?')).toThrow();
    expect(() => botEventStageSchema.parse('Titulo do compromisso')).toThrow();
  });
});

describe('parseBotEventMetadata (gate anti-conteudo do ADR-0017)', () => {
  it('flow_started so aceita objeto vazio', () => {
    expect(parseBotEventMetadata('flow_started', {})).toEqual({});
    expect(() => parseBotEventMetadata('flow_started', null)).toThrow();
  });

  it('conflict_dialog aceita ids de compromisso (uuid apenas)', () => {
    expect(
      parseBotEventMetadata('conflict_dialog', { appointmentId: A_ID, conflictingIds: [B_ID] }),
    ).toEqual({ appointmentId: A_ID, conflictingIds: [B_ID] });
    expect(() =>
      parseBotEventMetadata('conflict_dialog', { appointmentId: 'nao-e-uuid', conflictingIds: [] }),
    ).toThrow();
  });

  it('campo desconhecido e rejeitado (.strict) — fala disfarcada nao entra', () => {
    // Este e o teste do invariante: alguem tentar anexar a fala do usuario no
    // metadata (por "esquecimento" de codigo) deve FALHAR antes de gravar.
    expect(() =>
      parseBotEventMetadata('flow_completed', {
        appointmentId: A_ID,
        rawText: 'me marca ai uma reuniao amanhã as 10',
      }),
    ).toThrow();
    expect(() =>
      parseBotEventMetadata('needs_review', { reason: 'parse_fail', titulo: 'Dentista' }),
    ).toThrow();
  });

  it('todas as intents do CLASSIFICADOR do bot passam pelo zod do evento (sync dos dois enums)', async () => {
    // o registrador repassa o intent cru do classifyIntent p/ metadata — se o
    // contracts do evento perder um valor de llm/classifyIntent, a linha nasce
    // sem metadata e a auditoria cega. Este teste prende os dois canos.
    const { INTENTS } = await import('../llm/classifyIntent');
    for (const intent of INTENTS) {
      expect(() =>
        parseBotEventMetadata('intent_classified', { intent, confidence: 0.8 }),
      ).not.toThrow();
    }
  });

  it('needs_review exige motivo do enum fechado', () => {
    expect(parseBotEventMetadata('needs_review', { reason: 'low_confidence' })).toEqual({
      reason: 'low_confidence',
    });
    expect(() => parseBotEventMetadata('needs_review', { reason: 'o bot nao entendeu nada' })).toThrow();
  });

  it('intent_classified exige intent e confianca 0..1', () => {
    expect(
      parseBotEventMetadata('intent_classified', { intent: 'consultar', confidence: 0.92 }),
    ).toEqual({ intent: 'consultar', confidence: 0.92 });
    expect(() =>
      parseBotEventMetadata('intent_classified', { intent: 'consultar', confidence: 1.5 }),
    ).toThrow();
  });

  it('edit_applied so registra NOMES de campo (curtos), nunca valores', () => {
    expect(
      parseBotEventMetadata('edit_applied', { appointmentId: A_ID, fields: ['startsAt'] }),
    ).toEqual({ appointmentId: A_ID, fields: ['startsAt'] });
    // valor da edicao (conteria o conteudo do compromisso) nao tem onde morar:
    expect(() =>
      parseBotEventMetadata('edit_applied', {
        appointmentId: A_ID,
        fields: ['startsAt'],
        newTitle: 'Reuniao com a diretoria',
      }),
    ).toThrow();
  });
});

describe('botEventsQuerySchema (GET /bot-events — filtros tecnicos)', () => {
  it('defaults de paginacao', () => {
    const q = botEventsQuerySchema.parse({});
    expect(q).toMatchObject({ limit: 50, offset: 0 });
  });

  it('coerce datas ISO e rejeita lixo', () => {
    const q = botEventsQuerySchema.parse({ from: '2026-10-01T00:00:00Z' });
    expect(q.from).toBeInstanceOf(Date);
    expect(() => botEventsQuerySchema.parse({ from: 'ontem' })).toThrow();
  });

  it('limit tem teto (200) — consulta de auditoria nao puxa a tabela', () => {
    expect(() => botEventsQuerySchema.parse({ limit: 10_000 })).toThrow();
  });
});

describe('llmUsageQuerySchema (GET /llm-usage — admin-only)', () => {
  it('groupBy default purpose; valores fechados', () => {
    expect(llmUsageQuerySchema.parse({}).groupBy).toBe('purpose');
    expect(llmUsageQuerySchema.parse({ groupBy: 'user' }).groupBy).toBe('user');
    expect(() => llmUsageQuerySchema.parse({ groupBy: 'email' })).toThrow();
  });
});

describe('updateObservabilityRolloutInputSchema (PATCH rollout)', () => {
  it('so a flag — nada mais no user e alteravel pela rota', () => {
    expect(
      updateObservabilityRolloutInputSchema.parse({ observabilidadeEventosAtivo: true }),
    ).toEqual({ observabilidadeEventosAtivo: true });
    expect(() =>
      updateObservabilityRolloutInputSchema.parse({
        observabilidadeEventosAtivo: true,
        isAdmin: true,
      }),
    ).toThrow();
  });

  it('flag obrigatoria e booleana', () => {
    expect(() => updateObservabilityRolloutInputSchema.parse({})).toThrow();
    expect(() => updateObservabilityRolloutInputSchema.parse({ observabilidadeEventosAtivo: 'sim' })).toThrow();
  });
});
