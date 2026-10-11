# 0018 — Extração aproveita o que foi dito: `endsAt` explícito, dia-da-semana ≥ hoje, título ecoado

- Status: Aceito
- Data: 2026-10-10
- Contexto da fase: hardening do fluxo do bot (pós-Fase 8), feature
  "fluxo-criacao-robusto". Incidente de produção em 2026-10-10: a fala real
  _"Tenho um novo compromisso, uma viagem para lucena de 19h hoje e vai até 17h
  na segunda"_ degradou em três frentes — a frase inteira virou o título, o
  fim "17h na segunda" foi perdido (o bot criou 19:00–20:00, o chute de 1h) e
  o clique em "personalizado" no passo do lembrete virou fala pro LLM em loop.
- Relacionado: ADR-0004 (LLM interpreta, regras decidem — aqui: o modelo
  **copia** instantes, a borda faz aritmética), ADR-0002 (UTC no banco, tz na
  borda — o dia-da-semana é resolvido no tz do usuário), ADR-0010 (régua
  needs_review vs. re-pergunta — `fim_invalido` é re-pergunta, nunca fila),
  ADR-0015 (`findConflict` consome `[startsAt, endsAt)` puro — multi-dia não
  pede código novo)
- Spec: `.ia/specs/agendamento/fluxo-criacao-robusto.spec.md`

## Contexto

O atalho de extração (Fase 4) só conhecia `startsAt` + `durationMinutes`
(default 60 min). Não havia como o usuário dizer o FIM numa frase — "de 19h
hoje até 17h na segunda" perdia o fim por construção, e a régua preenchia 1h
em silêncio. O `titleHint` da extração falha era `texto.slice(0, 200)`: a fala
inteira virava título sem pergunta nem eco. E `handleCallback` reaproveitava
`handleText(label)` como fallback genérico, transformando clique de botão em
fala (o loop do "personalizado"). As três falhas são a mesma doença: o bot
**chutava em silêncio** em vez de **aproveitar o que foi dito ou perguntar o
que falta**.

## Decisão

Uma decisão com três faces — "aproveitar o que o usuário disse sem chute
silencioso":

1. **`endsAt` opcional no contrato do extrator**
   (`extrairAgendamentoSchema`): quando o usuário dá início E fim, o modelo
   devolve os DOIS instantes ISO com offset. O modelo **copia os instantes que
   o usuário disse, nunca calcula** duração (ADR-004); `durationMinutes` vira
   **fallback** — `endsAt` presente e inconsistente com a duração ⇒ a régua
   ignora a duração (o fim dito é a verdade). **Sem fim na fala ⇒ o bot
   PERGUNTA o passo `fim`** (`endExtracted = false` na máquina): isso
   **substitui a decisão #4 da spec avançada**, que pulava `fim` com default
   60 min no atalho aceito; o 60 min sobrevive só como fallback do teclado de
   horas. Fim dito ilegível ou ≤ início ⇒ veredito novo **`fim_invalido`**:
   re-pergunta o fim reaproveitando o início bom, **nunca** needs_review
   (ADR-010: hipótese ilegível na criação é re-pergunta). Multi-dia é natural:
   nenhum cap de duração para `endsAt` explícito (o cap 1440 é só da
   `durationMinutes`).
2. **Dia-da-semana = próxima ocorrência ≥ hoje no tz do usuário** (decisão
   humana 2026-10-10): dita numa segunda, "segunda" **é hoje**; "próxima
   segunda"/"que vem" continua +7 dias. A resolução é **ancorada no prompt**
   (a "data de hoje no tz do usuário" já injetada — padrão da Fase 2), com a
   **régua ADR-010 como rede de segurança** (confiança baixa com candidato
   plausível ⇒ needs_review, nunca confirmado no chute) e **eco obrigatório**
   da data resolvida ("sáb 10/10 19:00 → seg 12/10 17:00"): interpretar ≠
   assumir em silêncio. Nenhuma função de calendário nova.
3. **Título é sugestão ecoada, nunca a frase**: o `titleHint`-fala-inteira
   **morreu** — extração falha em fala longa (`OPEN_FLOW_MAX_TITLE_WORDS = 6`)
   cai no guiado **perguntando o título**. O `title` do modelo passa pela
   heurística determinística B2 na borda (`usableTitle` em `messages.ts`:
   título ≥ 80% da fala normalizada ou iniciando por verbo de intenção
   (`INTENTION_PREFIXES`) ⇒ título ausente, veredito `sem_titulo`: o início é
   reaproveitado e a máquina pergunta SÓ o título). Título curto válido
   preenche o candidato **sem turno extra de pergunta**, mas é **sempre
   ecoado** na fala de pulo e no resumo, com `alterar título` disponível; na
   fila de needs_review o título é hipótese como qualquer campo (vive em
   `rawText`).

## Consequências

- Novo veredito `fim_invalido` na régua do criar (e na tipologia da máquina):
  re-pergunta o fim no ponto faltante, nunca needs_review; o candidato
  carrega o início bom sem `endUtc`.
- Passo `lembrete` sem loop: teclado com `callback_data` estruturada
  (`flow:lembrete:*` → evento determinístico `reminderChoice`, zero LLM);
  "personalizado" responde convite de texto livre e mantém o passo; 2 falhas
  consecutivas de texto livre (`reminderTries`, anti-loop, decisão humana) ⇒
  teclado de atalhos fixo + fala de recuperação. O fallback de
  `handleCallback` fica restrito à whitelist `CALLBACK_TEXT_WHITELIST`
  (sim/não/confirmar/alterar/remarcar/abortar — custo zero) e o portão da
  extração livre **nunca** roda por clique (`origin: 'callback'`). Gotcha 23.
- Multi-dia livre do cap 1440: "viagem sáb 19h → seg 17h" (1320 min) é lícito;
  o conflito já funciona (`findConflict` em intervalo puro, ADR-0015) — zero
  migration, `schedule-core` intocado.
- Prompt do extrator cresce (instrução de intervalo, título curto,
  dia-da-semana) — custo marginal por turno; `cache_control` no system estável
  preservado.
- O default 60 min deixa de ser comportamento visível do atalho: falar só o
  início ⇒ sempre há a pergunta do fim (um turno a mais em falas sem fim —
  preço aceito da honestidade sobre o chute).
- Reversão (voltar a chutar fim/título) exigiria ADR novo: o eco obrigatório e
  o "perguntar o que falta" passam a ser premissa do fluxo.
