---
name: tdd
description: Fluxo red-green-refactor para o Agendabô. Use ao escrever qualquer regra de conflito, notificação, data, quota ou parsing de LLM (obrigatório nesses casos pela regra de testing).
metadata:
  author: Agendabo (adaptado de Tech Leads Club)
  version: "1.0.0"
---

# TDD no Agendabô

Onde TDD é **obrigatório** (regra `.ia/rules/testing.md`): conflito, notificação, data,
quota de código, parsing de LLM. Nesses módulos, código nasce do teste, não o contrário.

## Ciclo

1. **Red**: escreva UM teste do comportamento (nome em pt-br, Given/When/Then implícito).
   Rode e veja FALHAR pela razão esperada (não por erro de setup).
2. **Green**: implementação mínima que passa — nada além do caso testado.
3. **Refactor**: com verde, limpe nomes/duplicação; rode suite inteira (`pnpm test` no
   package) antes de declarar pronto.
4. Próximo caso-limite. (schedule-core: siga a lista de mínimos de testing.md como
   fileira de casos.)

## Convenções do projeto

- Testes de domínio rodam `vitest` com `now` fixo; services Nest em `jest` com `jest.fn()`.
- `now`/relógio/tz **sempre** parâmetro com default — nunca `new Date()` dentro da regra.
- O teste fala a linguagem do usuário/negócio: `findConflict`, não `intervalCheck`.
- Anti-padrão local: testar conflito via service com Prisma mockado quando a regra poderia
  estar em schedule-core puro — teste na camada mais pura possível.
- Bug corrigido: primeiro o teste que reproduz, depois o fix; referência o gotcha no
  comentário.
