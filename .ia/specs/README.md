# `.ia/specs/` — specs de features

**Toda feature vira spec antes de virar código** (regra `.ia/rules/documentation.md`).

- Um arquivo por feature: `.ia/specs/<domínio>/<feature>.spec.md`.
- Domínios previstos: `conta`, `agendamento`, `notificacao`, `bot`, `llm`, `web`.
- Escritas pelo agent `spec-writer` (template dentro dele), aprovadas pelo usuário antes de
  qualquer `feature-orchestrator`/`feature-builder` tocar em `src/`.
- Spec aprovada muda de `Status: rascunho` para `aprovada`; se o código entregar menos do
  que a spec pede, a spec é corrigida por ADR/spec nova, nunca silenciosamente.

Roadmap (Fases 1–7 do `PROMPT.md`) — cada fase gera suas specs:

| Fase | Specs esperadas                                         |
| ---- | ------------------------------------------------------- |
| 1    | `agendamento/criar-compromisso-bot.spec.md`             |
| 2    | `notificacao/lembretes.spec.md`                         |
| 3    | `bot/extracao-linguagem-natural.spec.md`                |
| 4    | `notificacao/resumo-diario.spec.md`                     |
| 5    | `bot/consulta-em-linguagem-natural.spec.md`             |
| 6    | `conta/cadastro-confirmacao-login.spec.md`              |
| 7    | `web/calendario.spec.md`, `web/fila-de-revisao.spec.md` |
