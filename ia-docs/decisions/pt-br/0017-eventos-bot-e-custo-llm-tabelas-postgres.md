# 0017 — Eventos do bot e custo de LLM como tabelas de auditoria no Postgres

- Status: Aceito
- Data: 2026-10-09
- Contexto da fase: Fase 9 "Observabilidade" (registro de interações do bot por
  usuário + tokens/custo do LLM)
- Relacionado: ADR-0004 (regras decidem ⇒ o evento **registra** a decisão, nunca
  re-decide), ADR-0008 (intenção classificada pelo LLM ⇒ o evento guarda intent
  - confiança, não a fala), ADR-0002 (UTC no banco), ADR-0003 (zod na borda ⇒
    `metadata` validada antes de gravar)
- Spec: `.ia/specs/observabilidade/observabilidade.spec.md` (seções B/C; D2/D3/D6/D7/D8/D9/D10/D12)

## Contexto

O PROMPT 9 pede duas coisas que log em stdout não entrega: interações do bot
**consultáveis por usuário** e tokens/custo de LLM **por chamada e agregável**.
As alternativas eram: (a) log JSON estruturado (grep/Loki — exige infra e não é
"por usuário" sem indexação), (b) **tabelas no Postgres** (já existe, é
indexável, sobrevive a deploy, e "consultável" vira SQL/teste), ou (c) só
métrica agregada (perde o "por chamada"). Escolhemos (b): `bot_events` e
`llm_calls`.

O desenho teve de responder a três tensões:

1. **Privacidade vs. auditabilidade.** "Quem usou o bot" convida a guardar a
   fala do usuário — e fala é dado pessoal sensível (pode conter qualquer coisa).
   A dor real ("o que aconteceu nesta conversa?") é 100% atendida por
   metadados: etapa da máquina, intent, decisão de regra, outcome. O texto já
   tem casa própria e limitada (`Appointment.rawText` na fila de revisão).
2. **Correlação sem identidade crua.** O PROMPT pede "quem (telegramId/userId)".
   `userId` (FK) resolve a consulta; o `telegramId` cru não precisa existir na
   tabela — um hash com salt preserva correlação de incidentes.
3. **Telemetria não pode virar produto.** Gravação de evento não pode derrubar
   um turno, travar transação de negócio nem alimentar decisão de regra.

E uma dependência estrutural que a fase trouxe: liberar o usuário a ver os
próprios eventos (**rollout** decidido pelo humano) pressupõe um conceito de
**admin**, que o schema não tinha.

## Decisão

- **`bot_events`** (Postgres): `userId` FK (cascade), `telegramIdHash` (sha256
  com salt do `JWT_SECRET`, truncado — coluna crua **não existe**), `type` (enum
  Prisma — tipos conhecidos), `stage` (texto controlado — etapa/intenção finas,
  sem migration por fala nova), `outcome` (`ok | needs_review | conflict |
error | aborted`), `metadata` (jsonb **validada por zod dos contracts antes de
  gravar** — enums/números/ids apenas; **proibido**: fala, título, nota),
  `createdAt` UTC. Índices `(userId, createdAt)` e `(type, createdAt)`
  declarados na migration.
- **`llm_calls`** (Postgres): `userId` FK **nullable** (chamada sem dono é null,
  nunca chute), `purpose` enum espelhando os 5 services de IA, `modelUsed`,
  `inputTokens`/`outputTokens`, `costUsdMicros` (**inteiro micro-USD —
  estimativa declarada**, preço por env; float somado em SQL é armadilha),
  `latencyMs`, `outcome` (`ok | parse_fail | low_confidence | escalated |
error`), `createdAt` UTC + índices. Capture **centralizado no provider
  Anthropic** (único ponto das 5 saídas; services de IA não conhecem custo;
  `usage` ausente ⇒ linha ainda gravada com tokens null).
- **Retenção: para sempre** (decisão humana 2026-10-09). Sem job de expurgo
  nesta fase; volume baixo declarado; reavaliar (expurgo ou anonimização) quando
  multiusuário doer — decisão nova, ADR novo.
- **Quem vê o quê (assimétrica)**: admin (`users.isAdmin`) vê tudo
  (`/bot-events`, `/llm-usage`); usuário comum vê **apenas os próprios eventos**
  se `users.observabilidadeEventosAtivo = true` (default false) — rollout liga-
  desliga por usuário via `PATCH /admin/users/:id/observabilidade`. **Custo de
  LLM é sempre admin-only** (decisão humana: cliente nunca vê custo).
- **Admin sem sistema de roles**: `users.isAdmin` boolean; **primeiro usuário do
  sistema vira admin no signup** (contagem dentro da tx de cadastro — corrida de
  dois "primeiros" não pode criar dois admins). Multi-admin de verdade pede ADR
  novo.
- **Gravação best-effort pós-commit** (padrão do repo: efeitos colaterais fora
  de tx de negócio): falha de telemetria é log, nunca propaga.

## Consequências

- "Por que este compromisso caiu em revisão?" e "quanto o LLM gastou este mês?"
  viram queries testáveis — os critérios da spec são asserts de linhas.
- Custo é **estimativa** (preço × tokens), não billing da Anthropic; recalcular
  quando o preço mudar é trivial porque os tokens brutos estão na linha.
- As tabelas são de **sistema, não de usuário**: não entram em flush de fixtures
  de usuário, mas o `onDelete: Cascade` vale (excluir conta apaga eventos —
  coerente com LGPD; o histórico do **tracker** não é coberto por isso — nota no
  ADR-0016).
- `schedule-core` permanece intocado (telemetria é I/O); nenhuma decisão de
  negócio muda de lugar; nenhuma fala do bot muda.
- Renúncia aceita: sem UI web nesta fase (consulta é API), sem expurgo
  automático, sem dashboard de custo. Se a retenção "para sempre" incomodar, o
  caminho é agregado mensal + expurgo da crua (decisão futura).
- Reversão (log JSON efêmero no lugar das tabelas) exigiria abrir mão de
  "consultável por usuário" — contra o requisito do roadmap; improvável.
