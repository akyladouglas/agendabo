# 0015 — Sobreposição é invariante do produto (fim do override de conflito)

- Status: Aceito
- Data: 2026-10-08
- Contexto da fase: Fase 8, Etapa 0 "Reagendamento Assistido" (base do drag da
  Etapa 2; fecha o bug C.11 do form web)
- Relacionado: ADR-0004 (LLM só interpreta; regra determinística decide),
  ADR-0002 (datas UTC), ADR-0011 (aviso de gatilho retroativo — reaproveitado)
- Spec: `.ia/specs/agenda/reagendamento-assistido.spec.md`

## Contexto

Desde a Fase 5 o form web exibia a mensagem de conflito ao criar um compromisso
mas **não oferecia ação nenhuma** (bug C.11), e por baixo dos panos existia um
caminho de gravação que permitia **sobrepor compromissos** (a checagem era cega
a `needs_review`, e a ideia de "criar mesmo assim" estava embutida no produto).
Ao desenhar o drag-and-drop da Fase 8, o humano decidiu (2026-10-08):

> "não é para ter [confirmar = força]. Ou muda o horário de algum compromisso
> ou não deixa salvar o que está sendo movido. (...) no final, se não quiser
> alterar nada, aborta e volta o que estava sendo realocado para sua origem."

Ou seja: o conflito nunca é fim de linha — é uma **escolha assistida** entre
mover um dos dois, e o estado nunca fica sobreposto.

## Decisão

- **Sobreposição é invariante do produto**: nenhuma fronteira de escrita
  (`POST /appointments`, `PATCH /appointments/:id`, `POST /appointments/reschedule`,
  `POST /review/:id/confirm`, bot) grava dois compromissos
  `confirmed`/`needs_review` futuros sobrepostos. Conflito ⇒ **409 e nada
  escrito**. Não existe, em lugar nenhum, "salvar mesmo assim".
- **`force` não existe nem entra**: os schemas de escrita nunca aceitam a chave
  (payload antigo que a envie não salva — e o conflito continua 409).
  **D9a (revisão 2026-10-09/R10):** os inputs da fase são `.strict()` — o
  default do zod era _descartar em silêncio_; agora chave desconhecida é
  **rejeitada** (um `force` retrabalhado aparece na cara do cliente, com teste).
- **Conflito vira Reagendamento Assistido**: a regra pura `planRelocation`
  (schedule-core, TDD) oferece **uma jogada por vez** — mover o existente para
  o primeiro slot livre ≥ fim do candidato, ou mover o movido para o primeiro
  slot livre ≥ destino (durações preservadas) — cada jogada só vale se não
  esbarrar em terceiros. Sem jogada ⇒ `options: []` ⇒ a UI **não salva** e
  explica. Cancelar aborta: tudo volta exatamente como estava (zero escrita).
- **A checagem considera `confirmed + needs_review`** (a antiga via só
  `confirmed` era o vetor real da sobreposição). Consequência aceita: sobreposição
  **legada** no banco (entradas antigas da fila sobrepostas) precisa ser
  resolvida pelo próprio fluxo — confirmar da fila com sobreposição é 409 e a
  web oferece as jogadas; cancelar mantém o item na fila (decisão humana no
  Aberto #1 da spec).
- **Atomicidade da jogada dupla**: `POST /appointments/reschedule` move os dois
  lados numa única transação Prisma com revalidação `findConflict` **dentro**
  dela (servidor recomputa a jogada, nunca grava horário sugerido por client
  obsoleto). Criar com conflito usa a variante `create` do mesmo input — nunca
  dois requests do client (janela de sobreposição proibida).
- Corrida de escrita tratada com dupla revalidação (pré-tx + in-tx), **sem**
  exclusion constraint no Postgres (custo/benefício; janela residual declarada
  na spec F.2).
- **D9 (revisão multi-agente 2026-10-09, decisão humana)**: a revalidação in-tx
  com `findMany` não fechava a corrida sob `READ COMMITTED` (snapshot de
  statement — duas txs concorrentes podiam ambas gravar). A carga in-tx de
  `reschedule` passou a ser `SELECT ... FOR UPDATE` sobre as linhas futuras do
  usuário: a transação concorrente bloqueia na trava de linha até o commit e a
  invariante passa a valer também sob escrita simultânea. Sem exclusion
  constraint (a trava cobre o acesso serializado pelo usuário; custo/benefício
  inalterado).
- **Aberto registrado (R1 da revisão)**: o pré-check do BOT ainda olhava só
  `confirmed`; foi alinhado a `confirmed + needs_review` (a escrita já rejeitava
  na hora de gravar, e o handler do bot respondia com mensagem de conflito sem
  botões e sessão encerrada). Alinhado em 2026-10-09; se algum fluxo futuro do
  bot montar conflito "tarde", esta é a origem provável.

## Consequências

- O form web (criar/editar) deixa de ter beco sem saída: conflito mostra
  botões de jogada com horário formatado no fuso do usuário. Bug C.11 fechado.
- O bot mantém o comportamento vigente (re-pergunta o "quando") — a mesma
  invariante vale para ele, sem fala nova.
- A Etapa 2 (drag) consome `relocation-options` + `reschedule` sem regra nova:
  soltar em conflito é o mesmo diálogo.
- Custo aceito: mais duas rotas na API e uma regra pura nova com testes;
  checagens de escrita ficam **mais estritas** (itens em revisão contam como
  obstáculos), o que pode expor sobreposições legadas como 409 até resolvidas.
- Reversão (permitir sobreposição de novo) exigiria ADR novo — a invariante
  passa a ser premissa de design do calendário inteiro.
