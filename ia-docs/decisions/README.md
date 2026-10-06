# ADRs — Architecture Decision Records

Registro das decisões arquiteturais do Agendabô. Uma decisão = um arquivo, imutável depois
de `Accepted`. Decisão nova que contradiz antiga ganha número novo e campo
`Supersede: NNNN`.

## Índice

| ADR                                                    | Título                                                            | Status | Data       |
| ------------------------------------------------------ | ----------------------------------------------------------------- | ------ | ---------- |
| [0000](pt-br/0000-adopt-adr-process.md)                | Adotar o processo ADR                                             | Aceito | 2026-10-05 |
| [0001](pt-br/0001-monolito-modular-monorepo.md)        | Monolito modular em monorepo (sem microserviços, sem turbo)       | Aceito | 2026-10-05 |
| [0002](pt-br/0002-datas-utc-timezone-por-usuario.md)   | Datas em UTC + timezone por usuário                               | Aceito | 2026-10-05 |
| [0003](pt-br/0003-verificacao-email-por-codigo.md)     | Verificação de email por código em vez de magic link              | Aceito | 2026-10-05 |
| [0004](pt-br/0004-llm-interpreta-regras-decidem.md)    | LLM só interpreta; conflito é regra determinística                | Aceito | 2026-10-05 |
| [0005](pt-br/0005-packages-cjs-web-consome-fonte.md)   | Packages em CJS; web consome o fonte via alias                    | Aceito | 2026-10-05 |
| [0006](pt-br/0006-ia-docs-unico-lar-de-decisoes.md)    | `ia-docs/decisions/` é o único lar dos ADRs                       | Aceito | 2026-10-05 |
| [0007](pt-br/0007-grafo-de-imports-depcruise.md)       | Grafo de imports explícito entre módulos (depcruise)              | Aceito | 2026-10-05 |
| [0008](pt-br/0008-llm-classifica-intencao-conversa.md) | LLM classifica a intenção da conversa (sem barra); regras decidem | Aceito | 2026-10-06 |

## Template

Novo ADR: copie `TEMPLATE-pt-br.md` para `pt-br/NNNN-<slug>.md` (skill
`create-adr` em `.ia/skills/`).
