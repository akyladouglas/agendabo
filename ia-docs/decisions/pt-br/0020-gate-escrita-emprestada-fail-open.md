# 0020 - Negação de escrita emprestada: gate determinístico fail-open (sugerido)

- Status: **Sugerido — NÃO registrado; aguarda aprovação humana** (rascunho da Etapa 8 do
  plano `ia-docs/plans/compartilhamento-agenda-par.plan.md`, feature implementada 2026-10-12)
- Data: 2026-10-12
- Relacionado: ADR-004/008 (LLM interpreta, regras decidem), ADR-015 (invariante de
  sobreposição é do dono).
- Spec: `.ia/specs/compartilhamento/compartilhamento-agenda-par.spec.md` (E.25, F.5 previa
  este ADR como sugerido).

## Contexto

Convidados com vínculo ativo continuam podendo falar "marca X amanhã" com o bot. Se o bot
abrisse a máquina de criar normalmente, o convidado marcaria na PRÓPRIA agenda achando que
era a emprestada — ou, pior, a feature teria que perguntar "de qual agenda?" em toda
criação, piorando o fluxo de quem nunca compartilha nada. A regra de produto (E.25): a
negação de escrita emprestada não pode depender do LLM decidir o "não", e não pode abrir a
máquina de criar para negar.

## Decisão

- Gate determinístico na ABERTURA do fluxo de criar (off-flow, intent `criar` já
  classificada): o texto passa pelo `ConsultaInterpreterService` (1 chamada haiku, modo
  strip com `alvo`/`alvo_nome`); alvo `compartilhada` + nome casando um vínculo
  ativo recebido ⇒ resposta fixa PT-BR + auditoria `write_denied`, SEM abrir a máquina.
- **Fail-open**: se a chamada do gate falhar (LLM fora do ar) ou o alvo não for extraído
  com confiança, o criar abre normalmente na agenda da SESSÃO. Justificativa de segurança:
  as rotas de escrita não têm parâmetro de dono (B.15, testado triplo), então a falha
  aberta NUNCA escreve na agenda alheia — no pior caso o convidado marca na própria agenda.
  Fail-closed transformaria indisponibilidade do LLM em indisponibilidade do criar para
  todo mundo.

## Consequências

- Custo: +1 chamada haiku por pedido de criação (só com intent `criar` já classificada).
- Limitação conhecida registrada no plano/revisão: sob falha do LLM, a negação educada
  vira "marcação silenciosa na agenda errada" (a própria agenda). Candidato futuro a
  fechar sem LLM: parsing determinístico (regex "na agenda d(a|o) ‹nome›") como segunda
  cinta.
- O prompt do interpretador de consulta passou a instruir o alvo também para pedidos de
  marcação — duas preocupações num prompt, aceitável no v1 (nota de revisão Leve).
