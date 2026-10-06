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
      ▲
      │ HTTP/JWT + zod (contracts = fronteira anti-corrupção)
┌─────┴───────┐
│     WEB     │  visão mês/semana/dia/ano, fila de revisão, login
└─────────────┘
```

- **schedule-core** é o _shared kernel_ puro usado por BOT, AGENDAMENTO e NOTIFICAÇÃO.
- **LLM** nunca fala com AGENDAMENTO direto — só entrega candidato ao BOT, que consulta o
  kernel determinístico.
- **WEB** só enxerga o sistema pelos DTOs de `@agendabo/contracts`.
