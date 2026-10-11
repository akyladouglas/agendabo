# Plano — Fluxo de criação robusto (intervalo completo, título curto, incremental, lembrete sem loop)

- Data: 2026-10-10 | Status: concluído (aguardando commit do humano)
- Spec: .ia/specs/agendamento/fluxo-criacao-robusto.spec.md (Aprovada pelo humano em 2026-10-10) | Fase do roadmap: hardening pós-Fase 8
- Orquestrador: feature-orchestrator (subagent feature-builder) | v1 do plano

## 1. Objetivo

Corrigir a degradação real de produção de 2026-10-10 (fala multi-dia virou título + 1h de chute +
loop no passo lembrete via botão): extrair e materializar **intervalo completo** (`endsAt`), nunca
usar a frase inteira como título, ecoar o que entendeu perguntando só o que falta, e dar callback
estruturado ao teclado de lembrete (clique ≠ fala, anti-loop com 2 tentativas).

## 2. Análise de profundidade

- **Contratos** (`packages/contracts/src/llm/extrairAgendamento.ts`): só `startsAt` + `durationMinutes?`
  (máx 1440) + `confidence` + `dateEvidence?`; tool JSON sem `.strict()` (gotcha 4) — adicionar
  `endsAt?: string` com a MESMA regex de offset de `startsAt` + campo na tool. Não há spec de contrato
  para este schema hoje (testing.md #2 ⇒ criar cobrindo os payloads do schema alterado).
- **Régua** (`apps/api/src/modules/bot/extraction-ruler.ts`): `classificarExtracao` materializa
  `endUtc = start + durationMinutes|60` (`materialize`, :143-155). Sem noção de fim explícito.
  `resolveInstante` valida offset ↔ tz da conta (reuso para `endsAt`).
- **Prompt** (`apps/api/src/modules/ai/scheduling-interpreter.service.ts:31-45`): não fala de
  intervalos "de X até Y", nem de título curto, nem da regra dia-da-semana ≥ hoje. `cache_control`
  no system estável (preservar; volátil = "hoje" já existe no bloco do usuário).
- **Service** (`apps/api/src/modules/bot/scheduling-flow.service.ts`): `titleHint = texto.slice(0,200)`
  no veredito `falhou` (:524); portão `openCreate` calculado só por flags (`!deterministic && texto`),
  e `handleCallback` (:1338-1358) reaproveita `handleText(label)` para tudo que não é dia/hora ⇒
  clique pode re-disparar o portão e o "personalizado" vira fala pro LLM.
- **Máquina** (`scheduling-flow.machine.ts`): `applyShortcut` caso `falhou` aceita `titleHint` cego
  (:641-656); `aceito` vai direto a `checkConflict` com `endUtc` materializado pela régua; passo
  `lembrete` re-pergunta sem contador (:1385-1396). Máquina é pura — contador vai no candidato.
- **Mensagens** (`messages.ts`): `lembreteAtalhos` são labels; `send()` gera `callback_data: flow:<label>`
  — teclado de lembrete precisa de payload estruturado.
- **schedule-core**: intocado (`findConflict` consome `[startsAt, endsAt)` puro; multi-dia OK).
- **Prisma**: zero migration.
- **Testes vizinhos**: `classificar-extracao.spec.ts` (vitest, régua), `scheduling-flow.machine.phase4.spec.ts`
  (vitest, máquina), `scheduling-flow.service.spec.ts` (jest, bordas). Teste que valida "atalho aceito
  pula fim com default 60" (`service.spec :160`, `phase4.spec :71`) precisa ser ATUALIZADO para a
  decisão 5 (perguntar `fim`) — mudança deliberada e aprovada.
- **Docs**: ADR novo = **ADR-0018** (próximo livre; 0017 existe). `docs/gotchas.md` + `docs/cenarios-do-bot.md`.

## 3. Decisões

| #   | Decisão                                                                                                                                                                                                                                                                | Alternativa descartada                            | Por quê                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| D1  | `endsAt` opcional no schema/tool; régua dá precedência a `endsAt` sobre `durationMinutes` (inconsistente ⇒ ignora duração com log debug)                                                                                                                               | calcular duração no modelo                        | decisão 2 da spec; ADR-004 (modelo copia, borda calcula)                                    |
| D2  | `endsAt` inválido (≤ início) ⇒ veredito novo `fim_invalido` ⇒ máquina re-pergunta (passo `fim` quando início ok; guiado senão); NUNCA needs_review                                                                                                                     | reusar `sem_quando` (perderia o início bom)       | regra A2 + decisão "pergunta só o que falta" (C1)                                           |
| D3  | Atalho `aceito` SEM fim explícito na régua ⇒ flag `endExtracted:false` na máquina ⇒ pergunta `fim` (decisão 5)                                                                                                                                                         | pular `fim` com 60 min (spec avançada decisão #4) | substituição explícita e aprovada; default 60 sobrevive só no teclado/falado do passo `fim` |
| D4  | Heurística B2 (título ≈ fala ≥ 0.8 ou prefixo de intenção) mora em `messages.ts` (`usableTitle`) — lista de prefixos exportada e testável                                                                                                                              | heurística no prompt só                           | B2 é regra determinística de borda; spec notas técnicas                                     |
| D5  | Lembrete: `BotReply` ganha `buttonPayloads?` (label→callback_data) e `send()` usa quando presente; `handleCallback` decodifica `flow:lembrete:*` → evento determinístico novo `reminderChoice` na máquina                                                              | um passo novo na máquina por atalho               | mínimo change na renderização existente; zero LLM no clique (D1/D2 da spec)                 |
| D6  | Portão `openCreate` recebe flag `fromCallback` (turno originado de clique) ⇒ nunca roda extração; fallback de callback restrito a whitelist de labels (`sim/não/confirmar/alterar/remarcar/abortar/1..N`)                                                              | rotear todos os labels por handleText             | D4 da spec (regra geral callback ≠ fala)                                                    |
| D7  | Contador de tentativas do lembrete vive em `FlowCandidate.reminderTries` (memória) — 1ª falha re-pergunta com exemplo; 2ª adiciona `lembreteConviteCustom` + teclado fixo e pára de chamar LLM até texto livre seguinte (flag `reminderSkipLlm` no service por sessão) | contador no banco                                 | spec notas técnicas: sessão em memória                                                      |

## 4. Etapas

| #   | Etapa                                                                                                                                                                                                                                                                             | Worker          | Status                                     | Saída (condição de pronta)                                                            | Relatório                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Contrato: `endsAt` no `extrairAgendamentoSchema` + tool JSON + spec vitest dos payloads (presente/ausente/sem offset/extra fields sem `.strict()`)                                                                                                                                | feature-builder | **concluída**                              | `pnpm --filter @agendabo/contracts test` verde (7/7 no spec novo)                     | RED→GREEN; tool sem `additionalProperties` e `endsAt` fora de `required`; zod `.optional()` com a mesma regex/mensagem do `startsAt`                                                                                                                                                                                                                                                                                      |
| 2   | Régua TDD: `endsAt` presente/inválido/fim==início/fim<início/multi-dia/offset divergente/inconsistente com duration (vitest `classificar-extracao.spec.ts`) + implementação `extraction-ruler.ts`                                                                                 | feature-builder | **concluída**                              | vitest régua verde (30/30)                                                            | Veredito novo `fim_invalido` (NUNCA needs_review); gate de offset do `endsAt` antes de confiança (fraco/parse_falho); `materialize` decide endsAt > duration > 60; máquina (etapa 4) ainda não consome `fim_invalido` — switch tem default, compila                                                                                                                                                                       |
| 3   | Prompt do extrator: intervalo "de X até Y", título curto, dia-da-semana ≥ hoje, nunca calcular duração; `cache_control` preservado                                                                                                                                                | feature-builder | **concluída**                              | build+lint verde; jest do interpretador (se existir) verde                            | SYSTEM_PROMPT +3 regras (endsAt copia-não-calcula, título curto, dia-da-semana ≥ hoje); jest `scheduling-interpreter.service.spec.ts` 5/5; cache_control preservado                                                                                                                                                                                                                                                       |
| 4   | Máquina TDD: `falhou` pergunta título (sem hint), heurística B2, eco incremental C1, `fim_invalido`⇒passo `fim`, atalho sem fim⇒passo `fim` (decisão 5), contador lembrete (2 falhas⇒teclado fixo; sucesso zera), `reminderChoice`                                                | feature-builder | **concluída (máquina; service = etapa 5)** | vitest máquina (phase4+main) verde, testes antigos da decisão #4 atualizados          | vitest phase4+main 57/57; `endExtracted` obrigatório, `fim_invalido` na entrada, `falhou` sem hint, `reminderTries`, `reminderChoice`, passo `fim` aceita startUtc sem `day`                                                                                                                                                                                                                                              |
| 5   | Service: remover `titleHint`-frase, aplicar `usableTitle`, materializar `endExtracted`, portão não-dispara-por-callback (`fromCallback`), `handleCallback` decodifica `flow:lembrete:*`, convite "personalizado" (zero LLM), skip-LLM pós-2-falhas, `send()` com `buttonPayloads` | feature-builder | **concluída**                              | jest `scheduling-flow.service.spec.ts` verde com fluxo A1 completo (multi-dia criado) | jest bot 62/62 + vitest api 149/149 + tsc verde; transição mínima `sem_titulo` na máquina (TDD, phase4 59/59); D7: sem flag skip-LLM — clique nunca roda LLM (`rawLabel`/roteamento por família de label)                                                                                                                                                                                                                 |
| 6   | `messages.ts`: falas novas (eco parcial, convite personalizado, teclado fixo anti-loop) + `callback_data` estruturado do teclado de lembrete                                                                                                                                      | feature-builder | **concluída**                              | covered pelos testes das etapas 4/5                                                   | `usableTitle`/`INTENTION_PREFIXES` (teste próprio 6/6), `perguntaFimAposAtalho`, `ecoParcialHora`, `lembreteConviteCustom`, `lembreteRecuperacao`, `lembreteAtalhosCallback`; `BotReply.buttonPayloads` fica na etapa 5                                                                                                                                                                                                   |
| 7   | Testes de regressão da spec mãe (conflito multi-dia, notas, confirmação) + spec de contrato + gates completos                                                                                                                                                                     | test-writer     | feita                                      | `pnpm build && pnpm test && pnpm lint && pnpm lint:arch` verdes                       | 10 testes novos (Gherkin 540min, B2 prefixo via service, spy handleText, portão por clique, contador zera por clique, "2h antes" sem LLM, contracts confidence). Gates: build ok · test 765 verdes (contracts 76, core 202, api vitest 153, api jest 235, web 106) · lint 0 erros (warnings CRLF legados) · lint:arch ✔                                                                                                   |
| 8   | Docs: ADR-0018, gotcha "callback reaproveitado como fala", `docs/cenarios-do-bot.md`, `pnpm sync:ia`                                                                                                                                                                              | feature-builder | feita                                      | docs coerentes com o código                                                           | ADR-0018 criado; gotcha #23; cenários A6/B5 atualizados (incl. correção factual do B5); status da spec → implementada; sync:ia limpo                                                                                                                                                                                                                                                                                      |
| 9   | Review final (code-reviewer) + resolver Crítico/Médio                                                                                                                                                                                                                             | code-reviewer   | feita                                      | pendências Crítico/Médio zeradas                                                      | Round 1: 0 críticos, 2 médios + 5 leves. M1/L3/L4/L6 corrigidos (ver log); M2 (falsos positivos da heurística B2) aceito pela spec ("fora de escopo: heurística aprendida") — mitigação sugerida registrada p/ iteração futura; L1/L5 levados como decisão/documentados. Reviewers especializados (bot-llm/testes/segurança) bloqueados por permissão nesta sessão — cobertura fica no code-reviewer geral + test-writer. |

## 5. Próxima ação

Feature concluída na working tree (NADA commitado); humano revisa o diff, faz o smoke manual do bot (prompt real: fala multi-dia + "segunda") e comete (sugestão: `feat(bot): intervalo completo, título curto, incremental e lembrete sem loop (fluxo-criacao-robusto)`).

## 6. Log

- 2026-10-10 — plano criado a partir da spec aprovada; inspeção de código confirmou o diagnóstico
  da spec (titleHint cego, sem endsAt, callback vira fala, lembrete sem contador). ADR = 0018.
- 2026-10-10 — Etapas 1–6 implementadas em 3 lotes (contrato+régua / prompt+messages+máquina /
  service). Transições extras aprovadas no caminho: kind `sem_titulo` + marcador `startFromShortcut`
  (B2/B3 com quando reaproveitado). Decisão D7 revisada: SEM flag skip-LLM — o texto livre
  pós-teclado-fixo volta a ser interpretado (Gherkin D literal); anti-loop é UX da máquina.
- 2026-10-10 — Etapa 7: +10 testes de cobertura; gates raiz todos verdes (build/test/lint 0 erros/
  lint:arch). Rodei prettier --write só nos arquivos tocados.
- 2026-10-10 — Etapa 8: ADR-0018, gotcha 23, cenários A6/B5, spec marcada implementada, sync:ia.
- 2026-10-10 — Etapa 9 (review): `code-reviewer` → APROVADO COM RESSALVAS (0 críticos). Round de
  fixes M1/L3/L4/L6 (ver próximo log). M2 (falsos positivos de prefixo/piso 0.8 da heurística B2)
  é aceito — a spec exclui heurística aprendida; mitigação anotada p/ iteração futura. Gates finais
  na raiz APÓS fixes: build ✔ · test 768 verdes (contracts 76, core 202, api vitest 156, api jest
  235, web 106) · lint 0 erros · lint:arch ✔. Tudo na working tree (sem commit, combinado).
- 2026-10-10 — **fixes do review M1/L3/L6/L4 aplicados**: **M1** — `setDay` zerava o fim
  extraído em silêncio (atalho multi-dia → conflito → remarcar perdia "até 17h segunda"):
  candidato ganha `shortcutDurationMs` (só `applyShortcut`, só com `endExtracted`; casos
  `aceito`/`sem_titulo` guardam `endUtc−startUtc`, `fim_invalido`/novo atalho limpam);
  `setStart` reaplica a duração (`endUtc = start + duration` → `checkConflict`, sem
  re-perguntar o fim); passo `fim` responde ⇒ supersede (limpa); guiado clássico nunca vê
  o campo (TDD: 2 testes phase4 — 46h preservadas; sem fim extraído continua perguntando).
  **L3** — campo decorativo `HandleTurnInput.fromCallback` removido da máquina + do call
  site (veto real vive no service via `origin`). **L6** — log de drift endsAt×duration
  promovido `debug`→`log` no `runExtraction`. **L4** — Gherkin A5 literal na máquina:
  multi-dia `endExtracted:true` (10/10 22:00Z→12/10 20:00Z) sobre Reunião confirmed
  11/10 12:00–13:00Z ⇒ passo `conflito` citando "Reunião" + botões remarcar/abortar.
  `setStart` ficou async (único called via `return` em contexto async). Vitest bot 120/120,
  jest bot 67/67, tsc --noEmit verde.
- 2026-10-10 — etapas 1–2 concluídas (TDD): contrato `endsAt` + tool + spec vitest (7/7); régua com
  veredito `fim_invalido` + precedência endsAt>duration>60 (30/30 no classificar-extracao.spec.ts).
  Contrato da máquina (etapa 4): ver `fim_invalido` em ExtracaoVeredito. Builds parciais verdes;
  gates globais (etapa 7) pendentes.
- 2026-10-10 — lote 2 (etapas 3/4/6, máquina+prompt+mensagens): prompt com endsAt/título curto/
  dia-da-semana; máquina com `endExtracted` obrigatório, `fim_invalido`, `falhou` sem hint (B1),
  eco C1 (`ecoParcialHora`), decisão 5 (atalho sem fim ⇒ passo `fim`), `reminderTries` (2 falhas ⇒
  recuperação+teclado) e `reminderChoice` determinístico; vitest máquina 57/57 + usableTitle 6/6.
  **Call sites do service para a etapa 5**: `runExtraction` :524 (titleHint morto — remover),
  :570 (anexar `endExtracted: data.endsAt !== undefined` no veredito `aceito`), :517 (switch sem o
  caso `fim_invalido` ⇒ mapear p/ `{ kind: 'fim_invalido', data: v.candidate }`), :551 (payload sem
  `endsAt` — repassar), :924 (`openable` não inclui `fim_invalido`), `send()`/`handleCallback`
  (buttonPayloads + `flow:lembrete:*` ⇒ `reminderChoice`).
- 2026-10-10 — lote 3 (etapa 5, bordas do service) concluída: `runExtraction` sem `titleHint`
  (B1 — fala longa ≥ `OPEN_FLOW_MAX_TITLE_WORDS` (6) palavras que falha a extração NUNCA vira
  título; curta vira como na spec mãe), `usableTitle` aplicado na SAÍDA (B2: régua valida com o
  title bruto; `aceito`+título inutilizável ⇒ veredito novo `sem_titulo`, `quando_parcial`
  sem título, needs_review mantém a hipótese em rawText), `endsAt` repassado à régua (A3:
  endsAt > duration > 60; divergência só log DEBUG), `endExtracted: data.endsAt !== undefined`
  (decisão 5), `fim_invalido` mapeado p/ a máquina (A2). **Transição mínima autorizada na
  máquina**: `sem_titulo` (candidato com início materializado SEM título) + marcador
  `startFromShortcut` no candidato (atalho ≠ guiado nos passos `dia`/`fim`/título; título
  respondido com intervalo pronto ⇒ `checkConflict` direto, C1). Callback≠fala (D1–D4):
  `turn` com `origin`/`rawLabel`; portão do criar e re-interpretação de edição vetados p/
  clique; teclado de lembrete ⇒ `reminderChoice` (zero LLM; `custom` só responde o convite);
  `handleCallback` roteia por família (`flow:lembrete:*` decodificado com whitelist de 5
  sufixos — desconhecido = log silencioso; hoje/amanhã/dd-MM/hh:00 como antes; números e
  sim/não/confirmar/alterar/remarcar/abortar como DADO `rawLabel`; QUALQUER outro label =
  pediuEsclarecimento sem LLM); clique sem sessão = fallback, nunca off-flow LLM. `send()`
  usa `buttonPayloads` (`flow:lembrete:*` no teclado de lembrete). D3 anti-loop já na máquina
  (2 falhas ⇒ recuperação+teclado; sucesso zera). **D7**: sem flag skip-LLM — o portão de
  intenção já é pulado nos caminhos determinísticos e clique nunca classifica. Gates: jest
  api 230/230 (bot 62/62), vitest api 149/149 (máquina 59/59), tsc --noEmit verde. Etapas
  7–9 (gates globais, docs/ADR-0018, review) pendentes.
