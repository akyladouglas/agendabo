# Spec — LLM avançado: extração livre ao criar + editar/cancelar pelo chat + needs_review real

- Domínio: agendamento / bot / llm | Data: 2026-10-07 | Status: aprovada
- ADRs relacionados: ADR-002 (UTC + tz na borda), ADR-003 (LLM interpreta, regras decidem; confiança → needs_review), ADR-004 (candidato + `MIN_CONFIDENCE_TO_ACCEPT`), ADR-008 (LLM classifica a intenção da conversa, sem barra). **Novo ADR necessário** (decisão não-óbvia, ver regra 23): a **régua needs_review vs. re-pergunta** (regra 6) e a **modelagem de cancelar pelo chat** (regra 15).
- Pedida por: usuário | Fase do roadmap: Fase 4 (no counting do PROMPT.md: "LLM avançado" aplicado à escrita — extração livre do criar, editar/cancelar pelo chat, fila de revisão alimentada de verdade). A **tela web 3.3 NÃO entra** nesta fase (fica na fase web); a fase entrega o **contrato de API** que ela consome.
- Estado acoplado (não re-descrito aqui): máquina de estados da Fase 1/3 (`scheduling-flow.machine.ts`), atalho determinístico de lembrete (`reminder-interpreter.service.ts`), consulta ⚠️ da Fase 2, outbox invalidado/recriado no update da Fase 3 (`AppointmentsService.update`), `contracts/api/review.ts` (shapes prontos), colunas `rawText`/`reviewReason` do Prisma (existentes).

## Objetivo / dor do usuário

Hoje o bot coleta o **quando** só pelo teclado guiado e não consegue editar nem cancelar um
**compromisso** já criado pelo chat — o usuário que diz "quero marcar consulta quinta que vem
umas 14h" ainda é questionado dia a dia, e quem quer mover ou apagar algo precisa da web.
Nesta fase o bot entende o **quando livre** ao criar (encurtando o fluxo), entende
"cancela a consulta de quinta" e "muda a reunião pra sexta 16h" — localizando o
**compromisso** deterministicamente e pedindo **confirmação explícita** antes de qualquer
alteração — e a **revisão** (`needs_review`) deixa de ser teoria: extração plausível mas
incerta nasce em revisão com aviso no chat, sem lembrete, com ⚠️ na consulta. Regra central
preservada: o LLM interpreta, `schedule-core` decide (ADR-004/008).

## Comportamento esperado

### A. Extração livre do "quando" ao criar (atalho na máquina única)

1. **Quando o atalho roda**: fora do fluxo, a intenção `criar` vier com confiança ≥
   `MIN_CONFIDENCE_TO_ACCEPT`, o bot chama o extrator de agendamento em linguagem natural com
   a fala do usuário (novo `SchedulingInterpreterService` em `modules/ai`, quarto interpretador,
   padrão fiel dos outros três: tool calling + `safeParse` + limiar + cascata haiku→sonnet +
   `cache_control` no system prompt estável). O prompt injeta a **data de hoje no tz do
   usuário** no bloco volátil (padrão da Fase 2).
2. **Contrato**: reusa `extrairAgendamentoSchema`/`extrairAgendamentoTool`
   (`contracts/llm/extrairAgendamento.ts`) — `{ title, startsAt (ISO-8601 com offset),
durationMinutes?, confidence, dateEvidence? }`. Sem schema novo. Duração ausente ⇒ default
   da borda **60 min** (já documentado no contrato).
3. **Datas na borda, nunca no modelo** (ADR-002/004): o LLM devolve ISO com offset no tz do
   usuário; a **borda** valida o offset contra o tz real da conta (inconsistência ⇒ tratada
   como falha de parse) e materializa o candidato como `startUtc = new Date(startsAt)` e
   `endUtc = startUtc + durationMinutes`. O bot não faz aritmética de calendário própria; a
   resolução de "quinta que vem" é do modelo ancorada no "hoje" do prompt, e **a régua da
   regra 6 protege o chute**: incerteza de calendário vira revisão ou re-pergunta, nunca
   `confirmed`.
4. **Preencher e pular (atalho, não máquina paralela)**: extração **aceita** (regra 6) ⇒ o
   candidato da sessão é preenchido (título, dia, `startUtc`, `endUtc`, `dateEvidence`
   guardada na sessão) e a máquina **retoma no passo `conflito`**: `findConflict` roda contra
   os `confirmed` futuros, e o bot responde com **resumo do que entendeu** + a pergunta de
   **notas** (sem conflito) ou a pergunta de **conflito** (com conflito). Os passos `dia`,
   `hora`, `fim` e a **confirmação final** são pulados: as fases 1/3 decidiram que a única
   confirmação é no fim, e aqui a fala do usuário **já é** essa confirmação — o atalho não
   re-pergunta "confirmo?" (regra A5 do cenários continua valendo para o fluxo guiado).
   Passos `notas` e `lembrete` seguem idênticos (atalho determinístico + interpretador), e o
   create passa pelo mesmo `buildCreate`/`appointmentInputSchema`/`persist` de sempre.
5. **Fala sem quando, ou quando não aceito**: fluxo guiado de sempre (regra 3 da Fase 1:
   título → dia → hora → fim…). Especificamente:
   - extração **falhou** (parse/`no_tool_use`/cascata esgotada, ou título vindo vazio) ⇒
     se a fala trouxe título mas não o quando ("quero marcar consulta"), o candidato entra só
     com o título e a máquina retoma no passo `dia`; caso contrário o fluxo abre em `titulo`
     como hoje;
   - extração com **confiança baixa** (regra 6, caso re-pergunta) ⇒ o bot mostra o que
     pareceu ter entendido e pergunta só o que falta (ex.: sem hora ⇒ pula `dia`, pergunta
     `hora`). Nunca descarta o que extraiu com confiança só por causa de um campo faltante.
6. **A régua (coração da spec)** — vale para criar (A) e para o "quando" do editar (C):

   | Situação na extração                                                                                         | Veredito     | Ação                                                                                                                                                                                                                                     |
   | ------------------------------------------------------------------------------------------------------------ | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `safeParse` falhou, `no_tool_use`, ou cascata esgotada (parse/timeout)                                       | **falhou**   | re-pergunta (volta ao guiado no ponto do dado faltante); **nenhum** needs_review — falha de parse na criação livre nunca persiste hipótese sem quando confirmado (ver **Aberto** #6 para o motivo de divergir de llm.md #2 literal aqui) |
   | `confidence < MIN_CONFIDENCE_TO_ACCEPT` com **título E início extraídos** (candidato plausível, mas incerto) | **fraco**    | **cria `needs_review`** (bloco D) — extraiu algo provável de existir na agenda                                                                                                                                                           |
   | `confidence < MIN_CONFIDENCE_TO_ACCEPT` **sem quando** (não há candidato de data)                            | **vazio**    | re-pergunta; nunca precisa de revisão porque não há hipótese de horário                                                                                                                                                                  |
   | confidence ≥ limiar e datas válidas/futuras                                                                  | **aceito**   | segue confirmado                                                                                                                                                                                                                         |
   | confidence ≥ limiar mas o instante resolvido está no **passado**                                             | **suspeito** | cria `needs_review` com `reviewReason` correspondente (o usuário pode querer registrar passado, mas nunca em silêncio)                                                                                                                   |

   Justificativa da simetria com Fase 1: em Fases 1–3 confiança baixa em **roteador** ⇒
   perguntar (não há hipótese a persistir); na **extração** há uma hipótese plausível ⇒ vale
   mais salvá-la em revisão do que perdê-la (llm.md #2: "parse falho OU confiança baixa ⇒
   needs_review + rawText + reviewReason" — aqui "parse falho" no primeiro turno do criar
   vira re-pergunta porque ainda há conversa viva e nada a persistir; needs_review por parse
   só faria sentido sem conversa possível, o que não é o caso do fluxo do bot). Em edição,
   "fraco" **nunca** cria nada (bloco C).

7. **Auditoria**: `dateEvidence` da extração vai para `rawText`/`reviewReason` no needs_review
   (regra 16) e é logada no aceite (debug da fila). Uma linha por turno no logger: veredito da
   régua + modelo que respondeu.
8. **Custo**: no máximo 2 chamadas de LLM no turno do criar (classificador + extrator, em
   série); turnos de teclado/callback seguem com zero. A classificação de intenção continua
   sendo o portão: o extrator **só** roda com `criar` aceita.

> **Divergência deliberada de llm.md #2** (registro para o ADR da regra 23): llm.md lê "parse
> falho OU confiança baixa ⇒ needs_review". Aqui, **parse falho** na criação livre vira
> **re-pergunta** (a conversa está viva e persistir um candidato sem data válida não ajuda a
> fila); **confiança baixa com candidato plausível** é que vira needs_review. É a leitura que
> llm.md #8 já sugere ("toda frase que o LLM não entendeu deve ser **recuperável**").

### B. Editar/cancelar pelo chat — classificação e localização

9. **Intents novas em `classifyIntentSchema`**: `editar_compromisso` e
   `cancelar_compromisso` (decisão técnica; segue ADR-008 — intent é roteador). Rejeita-se o
   reuso de `cancelar` (hoje = desistir do que está em andamento; fundir os dois destruiria a
   regra "nunca descarta no chute" da Fase 1) e o reuso de `remarcar` (escopo: ramo de
   conflito do criar). Tool JSON Schema e descrições atualizadas espelhando o zod (sem
   `.strict()`, gotcha 4); enum estendido com testes de parse (testing.md #2). Fluxo aberto de
   criar: essas intents ganham a proteção existente "descartar o atual? (sim/não)" antes de
   trocar de assunto.
10. **Interpretador do pedido** (novo `AppointmentEditInterpreterService` em `modules/ai`):
    chamado quando a intenção aceita é `editar_compromisso` ou `cancelar_compromisso`. Padrão
    dos três interpretadores. Contrato novo em `contracts/llm` (ex.:
    `interpretarEdicaoSchema`/Tool — nomes da implementação), saída no mínimo:
    `{ acao: editar | cancelar, descricao?: string, alvoData?: simbolo|intervalo à la
interpretarConsulta, novoInicio?: ISO com offset, novaDuracaoMin?, deslocamentoMin?,
confidence, evidence }`.
    - **Localizar ≠ extrair datas**: o campo de localização é **descrição** (palavras do
      título) + **quando aproximado**; a busca é determinística (regra 11).
    - **Deslocamento** ("adianta 1 hora", "joga pra mais tarde 30min"): o LLM devolve o delta
      em minutos; a nova data é `startsAt + delta` calculada na borda/schedule-core, nunca pelo
      modelo.
    - Editar com "quando" livre usa a **mesma régua da regra 6** para o novo horário;
      extração **fraca** ⇒ re-pergunta o horário novo (não existe needs_review de edição —
      bloco D).
11. **Localização determinística (regra, não LLM)**: o bot busca nos compromissos **futuros**
    do usuário (janela de 90 dias, como `existingConfirmedFuture`), statuses `confirmed` +
    `needs_review`; `cancelled`/passado nunca aparece. A fila de candidatas é filtrada em
    `schedule-core` (função pura nova, ex.: `findMatchingAppointments(candidatos, { texto,
intervalo })` — normalização de acento/minúsculas no título + restrição de período quando
    a fala deu quando; nomes e assinatura da implementação, com testes):
    - **1 candidata** ⇒ vai à confirmação (regra 12);
    - **2 a N candidatas** ⇒ lista numerada **com título + data/hora no tz do usuário** e pede
      a escolha ("1", "2" ou texto; ambiguidade nunca resolve sozinha); a resposta da escolha é
      passo determinístico da máquina (sem LLM);
    - **0 candidatas** com descrição clara ⇒ "não encontrei nada assim" + o bot oferece a
      consulta da Fase 2; sem descrição, re-pergunta qual compromisso.
    - Nº máximo de candidatas listadas: **Aberto** #4 (recomendação: 5, como o truncamento da
      consulta).

### C. Editar — proposta, confirmação e aplicação

12. **Mostrar e confirmar antes de alterar**: com a candidata única e a mudança extraída, o bot
    responde com o diff legível no tz do usuário — `"mudo Consulta dentista de qui 08/10
14:30–15:30 para sex 09/10 16:00–17:00. Confirmo? (sim / não)"` — e **nada** é alterado
    até "sim" (`parseYesNo`, padrão das perguntas de proteção). "não" ⇒ nada muda e o turno
    encerra educadamente; texto ambíguo ⇒ re-pergunta a confirmação. `confirmarEdicao` vira
    passo novo da **mesma máquina** (com `prevStep`, como `confirmar_cancelamento`).
13. **Aplicar = um só caminho (D7 da Fase 1)**: o "sim" chama
    `AppointmentsService.update(userId, id, patch)` — mesma mutação da web. Conflito é
    re-checado lá (`findConflict` com `ignoreId` do próprio compromisso, impossível editar
    para dentro de conflito) e o outbox é invalidado/recriado pela Fase 3. A resposta do bot:
    - sucesso ⇒ "Prontinho! Consulta dentista agora é sex 09/10 16:00–17:00 ✅" (datas no tz);
    - `AppointmentConflictError` ⇒ mostra **qual** compromisso choca (título + horário, tz do
      usuário) e **re-pergunta o horário novo** (volta ao passo de proposta com a candidata
      intacta; máx. 3 tentativas como no criar, depois sugere desistir);
    - edição pedida em compromisso `needs_review` ⇒ o bot avisa que ele está em revisão e
      orienta a corrigir pelo site (**Aberto** #3 para a alternativa "editar pelo chat também").

### D. Cancelar pelo chat

14. **Fluxo**: localiza (regra 11) ⇒ mostra `"Vou cancelar Consulta dentista de qui 08/10
14:30–15:30. Posso? (sim / não)"` ⇒ "não" ⇒ nada muda ⇒ "sim" ⇒ cancela e confirma no
    chat. Os lembretes do compromisso **param de existir** na mesma hora: linhas `pending` do
    outbox viram `cancelled` (reuso de `OutboxService.invalidateForAppointment`, mesma
    transação), jobs na fila viram no-op (regra 12 da Fase 3).
15. **Modelo do cancelar**: duas opções em jogo — apagar (`remove`, já existe, com cascade do
    Prisma) ou status `cancelled` no compromisso (o enum Prisma `AppointmentStatus` **não tem**
    `cancelled` hoje; quem tem é o outbox; exigiria migração + filtros em `listOverlapping`,
    consulta, digest, conflito). Decisão em **Aberto** #2 (recomendação: **apagar** — zero
    migração, comportamento já testado, e o produto não pediu histórico de lixeira).

### E. needs_review de verdade

16. **Criação em revisão** (régua da regra 6, caso "fraco"/"suspeito"): o compromisso nasce
    `status: needs_review`, `origin: bot`, com **`rawText`** = a fala original do usuário e
    **`reviewReason`** = `confianca_baixa` | `parse_falho` (vocabulário llm.md #2) enriquecido
    com a `dateEvidence` quando houver (colunas já existem — sem migração). Regras de lembrete:
    as que o usuário respondeu (ou o default "perguntar" ainda não respondido ⇒ zero regras)
    são **gravadas**, mas **nenhuma linha de outbox é materializada** (confirma o estado atual:
    só `create` confirmado materializa; mesmo assim, o worker revalida `confirmed` no disparo
    — defesa em profundidade da regra 11 da Fase 3). Conflito: um `needs_review` **não bloqueia**
    novos (`findConflict` só vê `confirmed` — invariante vigente).
17. **Aviso no chat**: ao criar em revisão, o bot avisa na hora — texto novo em
    `messages.ts` no estilo `docs/cenarios-do-bot.md` (algo como "Anotei X como ⚠️ conferindo:
    entendi mais ou menos QUI… mas não tenho certeza. Confirma ou corrige no site"). O texto
    exato é decisão de produto (**Aberto** #1). O aviso cita o que foi entendido e a evidência
    da fala. Depois do aviso, o fluxo **termina** (sessão fechada) — não segue para notas e
    lembrete (a conversa sobre esse compromisso continua na fila de revisão).
18. **Consulta (Fase 2) e resumo diário**: `needs_review` já aparece com ⚠️ na consulta (sem
    mudança) e continua **fora** do resumo diário (só `confirmed` — vigente, sem mudança).
19. **Contrato da futura tela 3.3** — `contracts/api/review.ts` **já existe** com os shapes; os
    endpoints **não existem** (nenhum `ReviewController`). A fase entrega:
    - `GET /review` → `reviewListResultSchema` (itens needs_review do usuário com `rawText` e
      `reviewReason`);
    - `POST /review/:id/confirm` (`reviewConfirmInputSchema`: usuário corrigiu
      título/início/fim) ⇒ compromisso vira `confirmed` **neste momento** e **só neste
      momento** o outbox é materializado (regras 6/9 da Fase 3, mesma transação); conflito é
      checado com `findConflict` antes de confirmar (chocou ⇒ 409 com o compromisso que choca,
      como `POST /appointments`);
    - `POST /review/:id/dismiss` ⇒ compromisso é apagado (`remove`, mesmo caminho do cancelar
      da regra 14), zero outbox a invalidar por definição da regra 16.
    - **Aprovar sem correção** = `confirm` com os mesmos valores ⇒ confirmado + outbox
      materializado (mesmo caminho). `reviewReason` não é limpo na confirmação (auditoria).
20. **Editar/cancelar ambíguo ou fraco JAMAIS produz needs_review** — não se cria compromisso
    novo ao tentar editar um que não se sabe qual é. A falha de edição termina em pergunta ou
    em "não encontrei", nunca em registro em revisão.

### F. Invariantes e textos

21. Tudo que vale das fases anteriores **continua valendo**: gate de conta antes de qualquer
    fluxo; handler fino (nenhuma regra no handler do bot — máquina pura + services); zod em
    toda borda (contracts); UTC no banco, tz na borda; gotchas 4 (sem `.strict()` nas tools),
    5 (segunda instância Telegram) e 6 (HTML escapado — títulos listados na ambiguidade têm
    `escapeHtml`). Textos novos em PT-BR só em `messages.ts`, e `docs/cenarios-do-bot.md` é
    atualizado no mesmo commit (regra 8 da documentação): seções "marcar solto",
    "editar/cancelar pelo chat", mover da tabela "ainda NÃO faz".
22. **Custo/latência** (llm.md #7): editar/cancelar gastam no máximo 2 chamadas de LLM no
    turno (classificador + interpretador); escolha de candidata e sim/não de confirmação são
    determinísticos (zero LLM). Cascata escala só em parse/timeout, uma tentativa extra.
23. **ADR novo** (ao fim da fase): "Régua needs_review vs. re-pergunta na extração livre" e o
    modelo do cancelar (regra 15), por serem decisões não-óbvias que a próxima sessão não deve
    re-erguer sozinha.

## Fora de escopo

- **Tela web 3.3** (fila de revisão em Vue) — fica na fase web; esta fase entrega apenas o
  contrato de API (regra 19).
- Recorrência, anexos não-texto, fuso multiusuário, agendamento de terceiros.
- Edição pelo chat de campos além de **título/notas/início/duração** (lembretes de um
  compromisso continuam editáveis só pela web; editar lembrete pelo chat é fase web/futura).
- Lixeira/desfazer do cancelar (depende da decisão do **Aberto** #2).
- Reordenação de múltiplos compromissos em um turno ("move tudo de sexta pra sábado").
- Edição do `timezone`/`resumoDiarioHora` pelo chat.
- Substituir os teclados guiados: eles continuam como caminho padrão e de recuperação.

## Fronteiras e dados

- **Entidades/contratos tocados**:
  - `contracts/llm/classifyIntent.ts` — enum `INTENTS` ganha `editar_compromisso` e
    `cancelar_compromisso` (+ tool espelhada);
  - `contracts/llm/extrairAgendamento.ts` — **sem mudança** (criar livre consome como está);
  - `contracts/llm/interpretarEdicao.ts` — **novo** schema + tool do interpretador de
    edição/cancelamento (flat como `interpretarConsultaTool`, sem `.strict()`, com
    `normalize` se necessário);
  - `contracts/api/review.ts` — shapes prontos; sem mudança esperada (validar que
    `reviewConfirmInputSchema` basta; se a tela quiser "editar depois de confirmado", é outra
    feature);
  - Prisma — **sem migração** no caminho recomendado (regra 16 usa `rawText`/`reviewReason`
    existentes; regra 15 apagar). Cancelar por status `cancelled` exigiria migração do enum +
    filtros (só com **Aberto** #2 nesse sentido).
- **Onde mora a regra**:
  - filtragem/busca de candidatas, normalização de texto, cálculo do diff de deslocamento e
    resolução símbolo→intervalo: **`schedule-core`** (funções puras novas, `now`/offset por
    parâmetro, testes mínimos: escolha ambígua, acento, período, encostado, ignoreId na
    re-checagem de conflito da edição);
  - conflito: **`findConflict`** vigente (create, update com `ignoreId`); nada novo;
  - máquina de transições (atalho do criar, passos `confirmar_edicao`/`confirmar_cancelamento_
compromisso`/`escolher_candidata`, régua aplicada ao estado): `scheduling-flow.machine`
    (domínio puro, `classified`/`extracted`/`candidates` entram por parâmetro — mesmo
    desenho do `classified` de ADR-008);
  - chamadas LLM: `modules/ai` (nada de SDK fora dali);
  - persistência: `AppointmentsService` (create/update/remove) + `OutboxService` — edição pelo
    chat **reusa**, não reimplementa;
  - `ReviewController` novo em `modules/appointments` (controller fino → service).
- **Migrating/legado**: `offFlowTurn` ganha os casos das intents novas; o fluxo `criar`
  existente ganha um ramo de entrada (atalho) sem nova máquina.

## Critérios de aceite (Gherkin)

### Criar com extração livre

- **Dado** hoje qui 08/10 no tz do usuário (America/Sao_Paulo), conta confirmada, sem conflito
  **Quando** ele escreve "quero marcar consulta quinta que vem umas 14h por 1 hora" **E** a
  extração vem aceita (confidence ≥ limiar) **Então** o candidato sai com `startUtc` = qui
  15/10 14:00-03:00, duração 60min, título "consulta" **E** os passos dia/hora/fim são pulados
  **E** o bot mostra o que entendeu e pergunta notas **E** `findConflict` roda antes de salvar
  **E** após notas+lembrete o compromisso nasce `confirmed` (sem "confirmo?" extra).
- **Dado** uma fala com quando mas **sem hora** ("quero marcar consulta quinta que vem")
  **Quando** a extração não traz `startsAt` utilizável **Então** o bot pula só o `dia` e
  pergunta a **hora** com o teclado de horas (candidato de título/dia preenchido).
- **Dado** a mesma fala **E** o extrator devolve `confidence < MIN_CONFIDENCE_TO_ACCEPT` com
  título e início plausíveis **Então** nasce um compromisso `needs_review` com `rawText` = a
  fala e `reviewReason` = `confianca_baixa` **E** o bot avisa no chat (texto `Aberto` #1)
  **E** **nenhuma** linha de outbox é criada **E** a consulta da Fase 2 mostra o item com ⚠️
  **E** nenhum lembrete jamais dispara para ele.
- **Dado** o extrator com parse falho nas duas tentativas (haiku e sonnet) **Então** **nenhum**
  compromisso é criado **E** o bot segue o fluxo guiado do ponto faltante (pergunta).
- **Dado** extração aceita **E** o horário cai sobre "Daily da equipe" `confirmed` **Então** o
  bot mostra título + horário do conflitante e dá remarcar/abortar **antes** de perguntar notas.
- **Dado** fala sem quando algum ("quero marcar uma consulta") **Então** o fluxo guiado roda
  exatamente como na Fase 1 (teclado de dias no passo seguinte).

### Editar pelo chat

- **Dado** um único compromisso `confirmed` "Consulta" na quinta **Quando** "cancela a consulta
  de quinta" é aceita **Então** o bot mostra a candidata com data/hora no tz e pede confirmação
  **E** com "sim" o compromisso é cancelado **E** as linhas `pending` do outbox viram
  `cancelled` **E** o bot confirma no chat.
- **Dado** "muda a reunião pra sexta 16h" com candidata única extraída com confiança **Então**
  o bot mostra "mudo Reunião de qui 08/10 14:00–15:00 para sex 09/10 16:00–17:00. Confirmo?"
  **E** nada muda antes do "sim" **E** com "sim" `AppointmentsService.update` é chamado com o
  patch **E** o outbox é invalidado/recriado (linhas novas `pending` com os `firesAt` novos).
- **Dado** o "sim" produz conflito com outro compromisso **Então** nada muda **E** o bot mostra
  o conflitante (título + horário, tz) **E** re-pergunta o horário novo.
- **Dado** "adianta 1 hora a reunião" **Então** a proposta mostra o novo intervalo deslocado
  exatamente 60min do atual (cálculo fora do LLM) e segue a confirmação.
- **Dado** dois compromistos que casam com "a reunião" **Então** o bot lista os dois com
  data/hora e pede a escolha **E** "1" é resolvida sem nova chamada de LLM.
- **Dado** o usuário negar ("não") na confirmação **Então** nada muda e nenhum outbox é tocado.
- **Dado** "move a reunião pra semana que vem mais ou menos" com extração fraca do novo
  horário **Então** o bot **re-pergunta** o horário **E** **nenhum** needs_review é criado.
- **Dado** "cancela meu compromisso de amanhã" com 3 compromissos amanhã **Então** o bot lista
  os 3 com data/hora e pede a escolha antes de qualquer confirmação de cancelamento.

### needs_review via API

- **Dado** um needs_review do bot **Quando** `POST /review/:id/confirm` com valores corrigidos
  sem conflito **Então** o status vira `confirmed` **E** as linhas de outbox das regras gravadas
  são materializadas (gatilhos no futuro ⇒ `pending`) e os jobs entram na fila **E** `GET
/review` não lista mais o item.
- **Dado** um needs_review **Quando** `confirm` com horário que choca **Então** 409 com o
  compromisso conflitante **E** o status permanece `needs_review` **E** zero outbox.
- **Dado** um needs_review **Quando** `POST /review/:id/dismiss` **Então** o compromisso some da
  agenda, da consulta e da fila, sem lembrete.

### Arquitetura

- **Então** nenhum diff toca `modules/ai` fora do padrão interpretador (SDK só ali) **E**
  nenhuma regra de data/conflito/busca de candidata existe fora de `schedule-core` **E** as
  intents novas têm testes de parse dos 4 payloads (testing.md #2) **E** `pnpm lint:arch`
  continua verde **E** handler do bot continua fino (só roteia para serviços).

## Decisões (aprovadas pelo usuário em 2026-10-07)

| #   | Decisão                                       | Escolhida                                                                                                                                                   |
| --- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Texto do aviso de needs_review                | **(a)** cita o que foi entendido + a evidência da fala; texto final em `messages.ts`, humano revisa no PR                                                   |
| 2   | Cancelar pelo chat                            | **(a) apagar** de verdade (`remove` + cascade, zero migração; enum do Appointment continua sem `cancelled`) — se um dia vier "desfazer/lixeira", é ADR novo |
| 3   | needs_review editável pelo chat               | **(a) não** nesta fase — bot avisa e aponta o site; edição pela tela 3.3 (fase web)                                                                         |
| 4   | Candidatas na ambiguidade                     | **5** + "veja mais com a consulta"                                                                                                                          |
| 5   | Quando incompleto ("quinta que vem" sem hora) | **(a)** preenche o dia e pergunta só a hora (teclado); nada extraído se perde                                                                               |
| 6   | needs_review pergunta notas/lembrete?         | **(a) não** — o fluxo termina no aviso; a confirmação pela web materializa as regras                                                                        |
