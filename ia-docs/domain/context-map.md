# Context Map — Agendabô

Bounded contexts e suas fronteiras (linha tracejada = fronteira anti-corrupção via
contracts/schedule-core).

```
┌─────────────┐  fala    ┌──────────────────────┐
│   CONTA     │◀────────▶│         BOT          │
│ cadastro,   │  gate de │ máquina de estados,  │
│ email conf.,│ telegram │ handlers finos       │
│ tz, prefs   │  confirmado └───────┬────────────┘
└─────┬───────┘                    │ candidato (zod)
      │                            ▼
      │                    ┌──────────────────┐
      │                    │      LLM         │ tool schemas, cascata,
      │                    │ (interpretar só) │ confiança
      │                    └────────┬─────────┘
      │        decisão determinística│
      ▼                             ▼
┌──────────────────────────────────────────────┐   ┌──────────────┐
│                AGENDAMENTO                   │──▶│ NOTIFICAÇÃO  │
│ appointment, conflito, revisão, calendário   │   │ regras, outbox,│
│ schedule-core = kernel compartilhado         │   │ digest, jobs  │
└──────────────────────────────────────────────┘   └──────────────┘
  ▲        ▲                                        ▲
  │ leitura │ vínculo ativo (leitura/aviso A.3)   │ seções no digest
┌════════════════════════════════════════════════════════════════┐
│                      COMPARTILHAMENTO                          │
│ vínculo dono → convidado (par ordenado, papel fixo read),      │
│ convite por e-mail (token opaco TTL+quota, anti-enumeration),  │
│ auditoria de acesso; decisão de acesso 100% determinística     │
└════════════════════════════════════════════════════════════════┘
      ▲
      │ HTTP/JWT + zod (contracts = fronteira anti-corrupção)
┌─────┴───────┐
│     WEB     │  visão mês/semana/dia/ano, fila de revisão, login,
└─────────────┘  seletor de fonte read-only (agenda emprestada), gestão em /perfil
```

- **schedule-core** é o _shared kernel_ puro usado por BOT, AGENDAMENTO e NOTIFICAÇÃO.
- **LLM** nunca fala com AGENDAMENTO direto — só entrega candidato ao BOT, que consulta o
  kernel determinístico.
- **WEB** só enxerga o sistema pelos DTOs de `@agendabo/contracts`.
- **COMPARTILHAMENTO** (módulo `shared-agendas`) decide acesso a agenda emprestada de forma
  100% determinística (vínculo ativo dono→convidado, papel fixo `read`); consome AGENDAMENTO
  (leitura filtrada), alimenta NOTIFICAÇÃO (seções no digest) e BOT (alvo de consulta/aviso
  de revogação). Zero escrita pelo convidado; spec `.ia/specs/compartilhamento/`.
