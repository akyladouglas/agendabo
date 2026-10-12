import { describe, expect, it } from 'vitest';
import type { SharedAgendaListItem } from '@agendabo/contracts';
import {
  SHARED_AUDIT_KINDS,
} from '@agendabo/contracts';
import {
  sharedAuditDetail,
  sharedAuditKindLabel,
  sharedCounterpartLabel,
  sharedOwnerName,
  sharedStatusLine,
  sharedStatusLabel,
} from '../src/app/utils/sharedAgendas';

/**
 * Exibição pura do compartilhamento (spec D.21/A2/F.4). A ASSIMETRIA de
 * privacidade (A2) é regra de produto: enviado ⇒ SEMPRE o email (nunca o nome,
 * nem ativo); recebido ⇒ o nome. Os testes travam os dois lados.
 */

const NOW = '2026-10-12T12:00:00.000Z';

function link(over: Partial<SharedAgendaListItem> & Pick<SharedAgendaListItem, 'papel' | 'status'>): SharedAgendaListItem {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    contraparte: {},
    inviteSentAt: null,
    inviteExpiresAt: null,
    createdAt: new Date(NOW),
    acceptedAt: null,
    revokedAt: null,
    ...over,
  };
}

describe('sharedStatusLabel / sharedStatusLine (D.21)', () => {
  it('rotação PT dos 3 status', () => {
    expect(sharedStatusLabel('pending')).toBe('pendente');
    expect(sharedStatusLabel('active')).toBe('ativo');
    expect(sharedStatusLabel('revoked')).toBe('revogado');
  });

  it('pendente ganha "· expira ‹data/hora›" no fuso do visualizador', () => {
    // o zod do contrato devolve Date (isoDateSchema coerce); a UI recebe Date
    const line = sharedStatusLine(
      link({
        papel: 'owner',
        status: 'pending',
        inviteExpiresAt: new Date('2026-10-13T00:00:00.000Z'),
      }),
      'America/Sao_Paulo',
    );
    expect(line).toContain('pendente · expira');
    // 00:00Z = 21:00 do dia 12/10/2026 (segunda) em -03:00 — exibição na borda
    expect(line).toContain('seg 12/10 21:00');
  });

  it('ativo/revogado = só o rótulo (sem expiração)', () => {
    expect(sharedStatusLine(link({ papel: 'owner', status: 'active' }), 'UTC')).toBe('ativo');
    expect(sharedStatusLine(link({ papel: 'guest', status: 'revoked' }), 'UTC')).toBe('revogado');
  });
});

describe('identificação da contraparte por papel (A2 — privacidade)', () => {
  it('ENVIADO pendente: mesmo com name no payload, o rótulo é o EMAIL (nunca o nome)', () => {
    const item = link({
      papel: 'owner',
      status: 'pending',
      contraparte: { email: 'bruno@exemplo.com', name: 'Bruno' },
    });
    expect(sharedCounterpartLabel(item)).toBe('bruno@exemplo.com');
  });

  it('ENVIADO ativo: continua EMAIL (a regra A2 não muda com aceite)', () => {
    const item = link({
      papel: 'owner',
      status: 'active',
      contraparte: { email: 'bruno@exemplo.com', name: 'Bruno' },
    });
    expect(sharedCounterpartLabel(item)).toBe('bruno@exemplo.com');
  });

  it('RECEBIDO: o NOME do dono (sem nome = texto neutro, nunca "null"/email)', () => {
    expect(
      sharedCounterpartLabel(
        link({ papel: 'guest', status: 'active', contraparte: { name: 'Carla' } }),
      ),
    ).toBe('Carla');
    expect(
      sharedCounterpartLabel(link({ papel: 'guest', status: 'active', contraparte: {} })),
    ).toBe('Alguém');
    expect(
      sharedOwnerName(link({ papel: 'guest', status: 'active', contraparte: { name: '   ' } })),
    ).toBe('Alguém');
  });
});

describe('auditoria (F.4)', () => {
  it('todos os 11 kinds têm rótulo PT (a lista é constante testável)', () => {
    for (const kind of SHARED_AUDIT_KINDS) {
      const label = sharedAuditKindLabel(kind);
      expect(label).not.toBe(kind); // nada cai no cru
      expect(label.length).toBeGreaterThan(3);
    }
    expect(SHARED_AUDIT_KINDS).toHaveLength(11);
  });

  it('detail só traduz quantidades (nunca conteúdo)', () => {
    expect(sharedAuditDetail('access_read', { count: 3 })).toBe('3 compromissos');
    expect(sharedAuditDetail('access_read', { count: 1 })).toBe('1 compromisso');
    expect(sharedAuditDetail('invite_resent', { invitesInWindow: 2 })).toBe('2º envio na janela');
    expect(sharedAuditDetail('invite_created', null)).toBe('');
  });
});
