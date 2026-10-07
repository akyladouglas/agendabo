# Plano — Fase 4: LLM avançado (extração livre + editar/cancelar pelo chat + needs_review real)

- Data: 2026-10-07 | Status: concluída (etapas 1–11 feitas; gates verdes; ver Log)
- Spec: `.ia/specs/agendamento/llm-avancado-extracao-edicao-revisao.spec.md` (aprovada) | Fase do roadmap: 4
- Orquestrador: feature-orchestrator | v2 (fechamento)

## 1. Objetivo

Encurtar o criar quando a fala já traz o quando ("consulta quinta que vem umas 14h"),
permitir editar/cancelar compromisso pelo chat com localização determinística e
confirmação explícita, e tornar `needs_review` real (criado pelo bot com aviso no chat,
sem lembrete, com endpoints de revisão para a futura tela web). Régua única: LLM
interpreta; `schedule-core`/services decidem (ADR-004/008).

## 2. Análise de profundidade (o que já existe — inspecionado pela spec)

- `contracts`: `extrairAgendamentoSchema/Tool` (consumido como está), `api/review.ts`
  (shapes prontos, **controller não existe**), `classifyIntentSchema` (enum a estender).
- `modules/ai`: 3 interpretadores no mesmo trilho (tool+safeParse+limiar+cascata+
  cache_control) — o 4º (extração do criar) e o 5º (edição) seguem o molde.
- Máquina (`scheduling-flow.machine.ts`) recebe `classified` da borda — recebe agora
  também `extracted`/`editIntent`/`candidates` pelo mesmo desenho. Passos de proteção com
  `prevStep` já existem (padrão para `confirmar_edicao`).
- `AppointmentsService.update/remove` — update já invalida/recria outbox (Fase 3); o bot
  reusa (D7). `listOverlapping` aceita statuses (Fase 2).
- Prisma: `rawText`/`reviewReason` no Appointment **já existem** — zero migração no
  caminho aprovado. Enum `AppointmentStatus` continua sem `cancelled` (decisão #2: apagar).
- `schedule-core`: `findConflict` com `ignoreId` (edição), helpers de data/digest; **a
  criar**: `findMatchingAppointments` (candidatas) e cálculo de deslocamento — puros, TDD.

## 3. Decisões

| #   | Decisão                                                                                                                                               | Alternativa descartada                                            | Por quê                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| D1  | Régua: fraco (conf. baixa **com** título+início) ⇒ needs_review; parse falho ou sem quando ⇒ re-pergunta; aceito-no-passado ⇒ needs_review "suspeito" | needs_review para todo parse falho (llm.md literal)               | conversa viva: persistir hipótese sem data não ajuda a fila; decisão registrada em ADR novo (spec regra 23) |
| D2  | Atalho na máquina única (retoma no `conflito`; notas/lembrete seguem; sem "confirmo?" extra)                                                          | máquina paralela de extração                                      | uma máquina testada; falha cai no guiado naturalmente                                                       |
| D3  | Intents novas `editar_compromisso`/`cancelar_compromisso`                                                                                             | fundir com `cancelar`/`remarcar`                                  | `cancelar` = desistir do fluxo; fundir destruiria "nunca descarta no chute"                                 |
| D4  | Localização determinística (`findMatchingAppointments` no schedule-core; descrição+quando do LLM só como filtro)                                      | LLM escolhe o compromisso por id                                  | decisão é regra; ambiguidade ⇒ lista (máx 5) e escolha determinística                                       |
| D5  | Editar/cancelar SEMPRE mostram diff legível + "sim" antes (`confirmar_edicao`)                                                                        | aplicar direto                                                    | decisão de produto da Fase 4; edição errada é pior que criar errado                                         |
| D6  | Cancelar = apagar (`remove`+cascade)                                                                                                                  | status `cancelled` no enum                                        | zero migração/filtros novos; lixeira = ADR futuro (spec 15)                                                 |
| D7  | needs_review: cria sem notas/lembrete, avisa com evidência, zero outbox; confirm/dismiss via API (outbox só no confirm)                               | perguntar tudo antes de jogar na revisão                          | não se coleciona detalhes de horário duvidoso (decisão #6)                                                  |
| D8  | Endpoints `GET /review`, `POST /review/:id/confirm                                                                                                    | dismiss` nesta fase (controller fino); tela web fica pra fase web | adiar API junto com a tela                                                                                  | a fase "entrega o contrato"; destrava a fase web e permite smoke via curl |

## 4. Etapas

| #   | Etapa                                                                                                                                                                                                                                                                                  | Worker           | Status              | Saída (condição de pronta)                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | `contracts`: intents `editar_compromisso`/`cancelar_compromisso` (+tool); `interpretarEdicaoSchema/Tool` novo (flat, sem `.strict`); testes de parse                                                                                                                                   | feature-builder  | feita               | build+test contracts ok                                                                                        |
| 2   | `schedule-core`: `findMatchingAppointments(candidatos, {texto, intervalo})` + cálculo de deslocamento (delta→novo intervalo) — puros, TDD (acento, período, empate, zero/1/N)                                                                                                          | feature-builder  | feita               | testes unitários verdes                                                                                        |
| 3   | `modules/ai`: `SchedulingInterpreterService` (4º, consome `extrairAgendamentoSchema`; injeta "hoje no tz" no prompt; valida offset contra tz da conta) + `AppointmentEditInterpreterService` (5º, `interpretarEdicaoSchema`)                                                           | feature-builder  | feita               | testes com stub (payloads: aceito/fraco/sem-quando/parse-falho/passado; edição: alvo+delta, ambíguo, cancelar) |
| 4   | Máquina: atalho do criar (extrato → passo `conflito`; sem-quando → ponto faltante; quando incompleto → pula dia pergunta hora; régua D1 aplicada), passos `confirmar_edicao`/`confirmar_cancelamento_compromisso`/`escolher_candidata`, aviso retroativo de revisão                    | feature-builder  | feita               | testes da máquina cobrindo Gherkin A e edição (máx. 3 tentativas no conflito da edição)                        |
| 5   | `SchedulingFlowService`: bordas do atalho (classificar→extrair→máquina), localização (query futuras 90d confirmed+needs_review → `findMatchingAppointments`), aplicar editar via `AppointmentsService.update` (conflito→re-pergunta), cancelar via `remove`+`invalidateForAppointment` | feature-builder  | feita               | testes de serviço (stubs): fluxos completos + negativas                                                        |
| 6   | needs_review real: `persist` cria `needs_review` (rawText= fala, reviewReason + dateEvidence, zero outbox) e aviso no chat cita evidência; sessão encerra                                                                                                                              | feature-builder  | feita               | testes: fraco→needs_review sem outbox; suspeito (passado) idem; ⚠️ na consulta segue                           |
| 7   | `ReviewController` + service fino: GET/confirm/dismiss (confirm: zod, findConflict 409, →confirmed + materializa outbox na transação; dismiss: remove)                                                                                                                                 | feature-builder  | feita               | testes do service; rotas com guard JWT; smoke curl opcional                                                    |
| 8   | Textos PT-BR em `messages.ts` (atalho entendeu, aviso needs_review, diff de edição, lista de candidatas, cancelado)                                                                                                                                                                    | bot-flow-builder | feita               | strings centralizadas; humano revisa no PR                                                                     |
| 9   | `.dependency-cruiser.cjs`: arestas novas se houver (review fica em modules/appointments; bot→ai já existe); env sem novos segredos                                                                                                                                                     | feature-builder  | feita               | `pnpm lint:arch` verde                                                                                         |
| 10  | Testes mínimos (Gherkin da spec inteiro) + smoke manual sugerido                                                                                                                                                                                                                       | test-writer      | feita com ressalvas | `pnpm test` verde; mapa critério→teste no relatório                                                            |
| 11  | Gate + docs: ADR novo (régua D1 + cancelar=apagar), `docs/cenarios-do-bot.md` (seções "marcar solto"/"editar e cancelar no chat", tabela D atualizada), `architecture-overview` (review endpoints), plano v2                                                                           | code-reviewer    | feita               | 4 gates verdes; ADR aceito; docs no mesmo commit                                                               |

Status: pendente | em execução | feita | bloqueada | feita com ressalvas

## 5. Próxima ação

Deparo humano: revisar o diff (nada commitado), rodar o smoke manual de
`docs/cenarios-do-bot.md` (A6–A9) com LLM real, e aprovar o fechamento da Fase 4 antes
de começar a Fase 5 (tela web de revisão consome a API `GET /review` já pronta).

## 6. Riscos

- **Custo por turno do criar**: até 2 chamadas LLM (classificar+extrair) — aceitável
  (llm.md #7); teclado/callback continua zero. Prompt do extrator deve ser enxuto.
- **Divergência llm.md #2**: documentada na spec (regra 6) e vai para ADR antes do merge —
  não deixar virar regra oral.
- **Regressão da máquina**: muitas etapas novas num arquivo grande (`machine.ts` ~700
  linhas) — manter máquina pura, cobrir com testes ANTES de mexer (etapa 4 começa pelos
  testes), e não mudar assinatura de `handleTurn` sem ajustar todos os chamadores.
- **Candidatas**: busca é substring/normalizada — "cancela aquilo" sem descrição ⇒
  re-pergunta (não listar o mundo). Testar.

## 7. Log

- 2026-10-07 — spec aprovada (6 decisões). Plano v1 escrito; aguardando aprovação (não
  implementar antes).

- 2026-10-07 — plano aprovado; execução 1→11 na ordem. Etapas 1–3 (contracts,
  schedule-core, ai) com TDD antes do uso.
- 2026-10-07 — etapa 4: máquina estendida (`criar_aberto`, `edit_descricao`, `edit_propor`,
  `escolher_candidata`, `confirmar_edicao`, `confirmar_cancelamento_compromisso`);
  vereditos entram por parâmetros (`extracted`/`editLocation`/`editPicked`/`editChange`/
  `editConflict`), padrão do `classified` (ADR-008). 45 testes novos de máquina (vitest).
- 2026-10-07 — etapa 5/6: borda `SchedulingFlowService` (régua `extraction-ruler.ts` pura
  `classificarExtracao`/`classificarEdicao`; localização via `findMatchingAppointments`;
  needs_review com rawText/evidência e zero outbox; update com reabertura da sessão em
  conflito; cancelar via `remove`). Borda é a dona do predicado "espero re-interpretação"
  (a máquina só limpa a flag) — decisão tomada em execução, documentada no código.
- 2026-10-07 — etapa 7: `ReviewService`/`ReviewController` (GET /review; confirm: zod →
  findConflict 409 → confirmed + materializa outbox na MESMA tx + jobs pós-commit;
  dismiss: apaga). 9 testes jest.
- 2026-10-07 — etapas 8–11: strings PT-BR em `messages.ts`; sem arestas novas no
  dependency-cruiser (review fica em modules/appointments); ADR **0010** escrito e
  indexado; `docs/cenarios-do-bot.md` (A6–A9 + tabela D/E) e `architecture-overview`
  atualizados; plano v2.
- 2026-10-07 — **gates**: `pnpm build` ✓ | `pnpm test` ✓ (contracts 30, schedule-core 73,
  api vitest 101, api jest 110 em 13 suítes, web 3) | `pnpm lint` 0 errors ✓ |
  `pnpm lint:arch` 0 violações ✓. Ressalvas: (a) cancelar pelo chat usa `remove` puro
  (cascade limpa o outbox — sem chamada explícita de invalidate); (b) conflito pós-"sim"
  reabre sessão NOVA em `edit_propor` (a máquina não tem canal pós-done); (c) off-flow
  "criar" sem candidato roda a extração 1x além da classificação (aceito no plano, D
  de custo). Nada commitado.
