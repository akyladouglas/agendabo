import { describe, expect, it } from 'vitest';
import { normalizeSharedName, resolveSharedTarget, type SharedTargetLink } from './resolve-shared-target';

/**
 * Pura da decisão de ALVO da consulta compartilhada (spec compartilhamento E.24,
 * decisão D6 do plano): o LLM só extrai o candidato (`alvo`/`alvo_nome`); a decisão
 * de ACESSO é 100% determinística aqui (ADR-004/008). Matriz: nenhum vínculo,
 * 1 match, N matches, 0 matches, alvo 'minha', alvo ausente, compartilhada sem nome.
 */

const LINK_A: SharedTargetLink = { id: 'link-a', ownerId: 'dono-a', ownerName: 'Ana Souza' };
const LINK_B: SharedTargetLink = { id: 'link-b', ownerId: 'dono-b', ownerName: 'Bruno Lima' };
const LINK_C: SharedTargetLink = { id: 'link-c', ownerId: 'dono-c', ownerName: 'Ana Beatriz' };

describe('resolveSharedTarget — régua 1/N/0 (espelho findMatchingAppointments)', () => {
  it('alvo ausente (default) => own, SEM ler os vínculos (regressão zero)', () => {
    expect(resolveSharedTarget(undefined, undefined, [LINK_A, LINK_B])).toEqual({ kind: 'own' });
  });

  it("alvo 'minha' => own mesmo com vínculos ativos", () => {
    expect(resolveSharedTarget('minha', undefined, [LINK_A])).toEqual({ kind: 'own' });
  });

  it("alvo 'minha' com nome dito (exótico) => own: o alvo manda, nunca casa nome", () => {
    expect(resolveSharedTarget('minha', 'Ana', [LINK_A])).toEqual({ kind: 'own' });
  });

  it('nenhum vínculo ativo + compartilhada com nome => none', () => {
    expect(resolveSharedTarget('compartilhada', 'Ana', [])).toEqual({ kind: 'none' });
  });

  it('compartilhada SEM nome => none (o service pergunta "de qual agenda?")', () => {
    expect(resolveSharedTarget('compartilhada', undefined, [LINK_A, LINK_B])).toEqual({
      kind: 'none',
    });
    expect(resolveSharedTarget('compartilhada', '   ', [LINK_A])).toEqual({ kind: 'none' });
  });

  it('1 match exato => single com o vínculo', () => {
    expect(resolveSharedTarget('compartilhada', 'Bruno Lima', [LINK_A, LINK_B])).toEqual({
      kind: 'single',
      link: LINK_B,
    });
  });

  it('match ignora caixa, acentos e espaços nas pontas (nome dito ≈ nome do dono)', () => {
    expect(resolveSharedTarget('compartilhada', '  ANA souza ', [LINK_A])).toEqual({
      kind: 'single',
      link: LINK_A,
    });
    // dono com acento, fala sem acento
    const cravo: SharedTargetLink = { id: 'l', ownerId: 'o', ownerName: 'José Álvares' };
    expect(resolveSharedTarget('compartilhada', 'jose alvares', [cravo])).toEqual({
      kind: 'single',
      link: cravo,
    });
  });

  it('sobrenome sozinho NÃO casa (comparação do nome inteiro normalizado)', () => {
    expect(resolveSharedTarget('compartilhada', 'Souza', [LINK_A])).toEqual({ kind: 'none' });
    expect(resolveSharedTarget('compartilhada', 'Souza', [LINK_A, LINK_B])).toEqual({
      kind: 'none',
    });
  });

  it('nome dito que é prefixo do nome real NÃO casa (sem chute de substring)', () => {
    expect(resolveSharedTarget('compartilhada', 'Ana', [LINK_A])).toEqual({ kind: 'none' });
    // dois nomes que começam com "Ana": o prefixo sozinho não é comparação de
    // nome inteiro, então nenhum casa — o service pergunta, nunca chuta.
    expect(resolveSharedTarget('compartilhada', 'Ana', [LINK_A, LINK_C])).toEqual({
      kind: 'none',
    });
  });

  it('N matches (mesmo nome normalizado em vínculos diferentes) => ambiguous com os nomes', () => {
    const ana2: SharedTargetLink = { id: 'link-a2', ownerId: 'dono-a2', ownerName: 'Ana Souza' };
    expect(resolveSharedTarget('compartilhada', 'ana souza', [LINK_A, ana2, LINK_B])).toEqual({
      kind: 'ambiguous',
      names: ['Ana Souza', 'Ana Souza'],
    });
  });

  it('dono sem nome (null) nunca casa (não há o que comparar)', () => {
    const anonimo: SharedTargetLink = { id: 'l2', ownerId: 'o2', ownerName: null };
    expect(resolveSharedTarget('compartilhada', 'Qualquer Um', [anonimo])).toEqual({
      kind: 'none',
    });
    // o dono nomeado ainda casa normalmente ao lado do anônimo
    expect(resolveSharedTarget('compartilhada', 'ana souza', [anonimo, LINK_A])).toEqual({
      kind: 'single',
      link: LINK_A,
    });
  });

  it('0 matches => none (nunca chuta um vínculo "mais parecido")', () => {
    expect(resolveSharedTarget('compartilhada', 'Carla', [LINK_A, LINK_B])).toEqual({
      kind: 'none',
    });
  });

  it('ambiguous preserva a ordem dos vínculos recebidos (prefixo comum casa os dois: "ana s")', () => {
    const out = resolveSharedTarget('compartilhada', 'ana silva', [
      { id: 'l1', ownerId: 'o1', ownerName: 'Ana Silva' },
      LINK_B,
      { id: 'l2', ownerId: 'o2', ownerName: 'ana   silva' },
    ]);
    expect(out).toEqual({ kind: 'ambiguous', names: ['Ana Silva', 'ana   silva'] });
  });
});

describe('normalizeSharedName', () => {
  it('trim + minúsculas + NFD sem acentos + espaços comprimidos', () => {
    expect(normalizeSharedName('  Ana   SOUZA ')).toBe('ana souza');
    expect(normalizeSharedName('José   Álvares')).toBe('jose alvares');
    expect(normalizeSharedName('Ção')).toBe('cao');
  });

  it('null/vazio => string vazia (nunca casa)', () => {
    expect(normalizeSharedName(null)).toBe('');
    expect(normalizeSharedName('   ')).toBe('');
  });
});
