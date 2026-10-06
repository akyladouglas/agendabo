# 0004 — LLM só interpreta; conflito é regra determinística

- Status: Aceito
- Data: 2026-10-05

## Contexto

O bot usa LLM (Anthropic) para entender "marcar consulta quinta que vem às 14h". Um modelo
pode alucinar datas, ignorar um compromisso existente ou "achar" um horário livre. Se a
decisão de conflito/confiança ficar com o modelo, o usuário perde agenda sem perceber e
nenhum teste garante o comportamento.

## Decisão

- O LLM produz **apenas um candidato** (`extrairAgendamentoSchema` em contracts, via tool
  calling com `safeParse`).
- Conflito, disparos de lembrete e elegibilidade de notificação são calculados por
  `@agendabo/schedule-core`, determinístico e coberto por testes. O LLM nunca é consultado
  para "posso marcar?".
- `safeParse` falhou **ou** `confidence < MIN_CONFIDENCE_TO_ACCEPT` (env, default 0.7):
  o compromisso nasce `needs_review` com `rawText` + `reviewReason`, visível na tela de
  revisão (3.3). Nunca chute silencioso nem retry infinito.
- A resposta do LLM nunca é repassada ao usuário como dado de agenda sem passar pelo
  pipeline acima.

## Consequências

- Bug de conflito tem teste que reprova; troca de modelo não muda comportamento de
  produto.
- Custo de manter a fila `needs_review` (tela 3.3), que já é requisito.
- Prompts vivem com testes de parsing (4 payloads: válido/faltante/extra/confiança baixa).
