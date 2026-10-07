# Regra — Documentação (docs vivos)

**Escopo:** `ia-docs/`, `docs/`, ADRs e specs.

1. **Toda decisão relevante vira ADR** em `ia-docs/decisions/pt-br/NNNN-<slug>.md`
   (template: `TEMPLATE-pt-br.md`; inglês opcional em `en/`). Irrelevante = visível só no
   código (nome de variável, formatação). Decisões que uma IA da próxima sessão poderia
   re-erguer sozinha: registre.
2. **Toda feature vira spec antes de virar código**: `.ia/specs/<domínio>/<feature>.spec.md`
   (via agent `spec-writer`), com critérios de aceite testáveis.
3. **Todo plano de trabalho multi-etapa** em `ia-docs/plans/<feature>.plan.md`
   (formato: `plans.md`).
4. `docs/gotchas.md`: armadilha real encontrada → entrada nova no mesmo commit do fix,
   formato "problema → fix → o que fazer de novo".
5. `ia-docs/architecture/architecture-overview.md` descreve o sistema **como ele é**;
   atualize junto da mudança que o altera (mesmo PR).
6. `ia-docs/domain/` guarda glossário e context-map (ubíquo: compromisso, lembrete,
   resumo, revisão). Nome do domínio no código = nome no glossário.
7. Ao fim de **cada fase** do roadmap: atualizar `ia-docs/plans/<fase>.plan.md` (status)
   e registrar ADR de decisão nova não-óbvia.
8. `docs/cenarios-do-bot.md` é o onboarding/roteiro de smoke do bot (o que o usuário
   consegue fazer no chat, com exemplos de fala). Ao fim de cada fase que mudar
   **comportamento visível no chat** (novos fluxos, novas falas, novas intenções):
   adicionar/atualizar os cenários no mesmo commit, marcar os roteáveis como ✅ e mover
   o que foi implementado da tabela "ainda NÃO faz".
9. Nunca duplicar verdade: decisão mora no ADR; comportamento no código; armadilha no
   gotchas; cenários de chat no cenários-do-bot. Referência cruzada por link, não cópia.
