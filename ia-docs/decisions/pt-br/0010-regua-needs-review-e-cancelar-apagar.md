# 0010 — Régua do needs_review no criar; cancelar pelo chat apaga; editar nunca vira revisão

- Status: Aceito
- Data: 2026-10-07
- Contexto da fase: Fase 4 (LLM avançado: extração livre, editar/cancelar pelo chat, needs_review real)

## Contexto

A Fase 4 coloca o LLM para extrair o compromisso inteiro de uma fala livre ("marca uma
consulta quinta umas 14h") e para interpretar pedidos de edição/cancelamento. A regra
central (ADR-004) continua valendo — o LLM interpreta, regras decidem — mas a Fase 1
não definiu **o que fazer quando a interpretação é dudosa**: confiança baixa, quando
inconsistente, data no passado. Também não estava decidido se cancelar pelo chat
"cancela" (status) ou apaga, e se a edição interpretada mal poderia cair na fila de
revisão como o criar.

Riscos na mesa: (a) aceitar extração duvidosa cria compromissos errados confirmados com
lembretes falsos; (b) re-perguntar sempre destrói o atalho que a Fase 4 quer criar;
(c) editar/cancelar virar `needs_review` poluiria a fila com itens que têm dono e
contexto e travaria o fluxo do chat.

## Decisão

- **Régua do criar (função pura `classificarExtracao`, testada no vitest)**: veredito
  `aceito` exige confiança ≥ `MIN_CONFIDENCE_TO_ACCEPT` **e** offset do modelo coerente
  com o tz da conta. Casos:
  - confiança baixa **com** título+início ⇒ `fraco` → **needs_review** (nunca descartar
    informação do usuário);
  - parse falho / sem quando utilizável / offset inconsistente ⇒ `sem_quando` → o bot
    **re-pergunta** (zero persistência);
  - quando resolvido **no passado** ⇒ `suspeito` → needs_review com o motivo
    `data_no_passado` ("salvo como suspeito", nunca confirmado).
  - O vocabulário de `reviewReason` de `llm.md` foi estendido com `parse_falho`
    (offset inconsistente no criar) e `data_no_passado`; os anteriores
    (`confianca_baixa`, `data_ambigua`, `sem_data`) continuam válidos.
- **needs_review do bot**: `rawText` = a fala original do usuário; `reviewReason` +
  evidência vão no aviso do chat; **zero linhas de outbox** (lembretes só nascem quando
  a revisão confirmar na web); a sessão do fluxo **encerra** (sem notas, sem lembrete,
  sem conflito — o item espera o site). needs_review **não é editável pelo chat**
  (aponta o site); cancelar um needs_review pelo chat **pode** (apagar sempre possível).
- **Cancelar pelo chat APAGA** (`deleteMany` + cascade do Prisma derruba o outbox; jobs
  na fila viram no-op — regra 12 da Fase 3). Um status `cancelled` novo foi rejeitado:
  nada no produto consome histórico de cancelamento e o "desfazer" do chat já é coberto
  pela recriação.
- **Editar pelo chat NUNCA vira needs_review** (spec regra 20): o interpretador de edição
  rejeita confiança baixa e a régua do quando re-pergunta no chat; nada é persistido na
  dúvida. Conflito ao gravar a edição re-pergunta o horário novo (máx 3 tentativas).
- **Localização do alvo (editar/cancelar) é 100% determinística** (`findMatchingAppointments`
  novo em schedule-core + símbolos de data da Fase 2): o LLM só extrai descrição/período
  candidatos; quem escolhe o compromisso é a regra (0 ⇒ "não encontrei", 1 ⇒ apresenta,
  N ⇒ lista numerada com escolha "1/2/..." sem LLM).
- **Confirmação de edição/cancelamento é sim/não determinístico** (`parseYesNo`, zero LLM
  no turno de dado) e a gravação passa pelos mesmos `AppointmentsService.update/remove`
  da web — o chat não tem caminho de escrita próprio.
- A régua vive na **borda** (apps/api, função pura `extraction-ruler.ts`) e entra na
  máquina por parâmetros (`extracted`/`editLocation`/`editChange`), como o `classified`
  do ADR-008; schedule-core continua sem saber o que é LLM.

## Consequências

- O atalho do criar ("marca X dia Y às Z") custa 1 chamada de LLM e, quando aceito,
  pula dia/hora/fim **e** a confirmação final; quando dudoso, cai na fila com a fala
  original preservada — nada é perdido nem fabricado.
- A fila needs_review ganhou um segundo produtor (o bot, `origin: 'bot'`) e a API
  `GET /review`, `POST /review/:id/confirm` (conflito ⇒ 409; confirmar materializa o
  outbox na MESMA transação) e `POST /review/:id/dismiss` (apaga).
- "Cancelar" tem um significado único no produto (apagar). Se um dia precisarmos de
  histórico de cancelamento, um ADR novo supersede este ponto.
- A máquina de estados cresceu (`criar_aberto`, `edit_descricao`, `edit_propor`,
  `escolher_candidata`, `confirmar_edicao`, `confirmar_cancelamento_compromisso`), mas
  toda decisão de dados continua em funções puras testadas (régua, matching, applyShift).
