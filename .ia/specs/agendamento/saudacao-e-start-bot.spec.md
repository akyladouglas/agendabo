# Spec — Saudação `/start` e abertura acolhedora do criar

- Domínio: agendamento (UX do bot) | Data: 2026-10-11 | Status: aprovada (decisões de produto já aprovadas pelo humano)
- Specs mãe (não reescritas aqui): **`.ia/specs/agendamento/criar-compromisso-bot.spec.md`**
  (regras 1–2: gate de conta e classificação de intenção) e
  **`.ia/specs/agendamento/fluxo-criacao-robusto.spec.md`** (atalho do criar, eco C1, B1).
  Esta spec **adiciona** duas regras de UX e **não** muda máquina, régua nem portões.
- ADRs relacionados: ADR-004/003 (LLM interpreta, regras decidem — `/start` é determinístico,
  zero LLM), ADR-008 (intenção roteadora — não roda para comando).
- Pedida por: usuário (bug real de produção 2026-10-11: `/start` não respondia nada)

## Objetivo / dor do usuário

1. **Bug**: usuário mandou `/start` no bot e **nenhuma mensagem veio**. O gateway só trata
   `message.text` genérico; `/start` caía no `offFlowTurn`, o classificador LLM respondia
   `fora_do_escopo`/confiança baixa → mensagem muda ou silêncio. Um comando de saudação é
   determinístico e **nunca deve gastar LLM**.
2. **UX**: quando o usuário **descreve** um compromisso (o criar abre por fala — guiado ou
   atalho), a primeira mensagem é técnica ("Bora marcar! Como eu chamo…"/eco direto).
   Falta uma frase de abertura acolhedora antes do que já existe.

## Comportamento esperado

### A — Comando `/start` (determinístico, zero LLM)

A1. O gateway (webhook **e** polling) reconhece `message.text` que é `/start` — aceitando o
alias com nome do bot (`/start@agendabo_bot`) e capitalização/whitespace ao redor — e
delega a `SchedulingFlowService.handleStart(telegramId)`. Nenhuma outra mensagem vira
comando (sem comando de barra na fala normal — regra 2 da mãe).
A2. **Zero LLM**: `/start` jamais chama o classificador de intenção nem qualquer
interpretador/extrator. É resposta fixa.
A3. **Gate de conta preservado** (regra 1 da mãe): telegramId sem cadastro confirmado
recebe `BOT_MESSAGES.cadastroNecessario` (comportamento de qualquer fala).
A4. Conta confirmada recebe a boas-vindas com menu (texto abaixo), com o nome quando
existir (helper `comNome`, `messages.ts`) e fallback sem nome:

    > Oi, {nome}! 👋 Eu sou o Agendabô, seu assistente de agenda. Posso:
    > 📌 Marcar compromissos — é só me contar (ex.: "marca consulta quinta 14h")
    > 📖 Consultar sua agenda ("o que tenho amanhã?")
    > ⏰ Te lembrar dos seus compromissos
    > ✏️ Editar ou cancelar pelo chat
    > Manda aí o que você precisa 🙂

A5. `/start` **não** abre fluxo, **não** zera sessão em andamento e **não** gasta estado:
resposta pura de borda. Não há sobreposição com a saudação do criar (regra B).

### B — Frase de abertura acolhedora quando o criar ABRE por fala

B1. Quando o criar **acaba de abrir naquele turno** por fala do usuário (descrição de
compromisso), a PRIMEIRA resposta do turno começa com:

    > Olá, {nome}! Entendi, vamos registrar esse compromisso 🙂
    > (sem nome: "Olá! Entendi, vamos registrar esse compromisso 🙂")

    e em seguida segue o que já existe (pergunta do título no guiado, ou eco do extraído
    no atalho). Implementação: a frase é **mensagem separada enviada antes** das replies da
    máquina (dois envios no turno), não prefixo na mesma mensagem.

B2. **Escopo restrito ao turno de abertura**: turnos seguintes do fluxo (passos dia/hora/
título/fim/notas/lembrete…) **não** repetem o "Olá". Cobertura dos caminhos de abertura
por fala: `criar`/`substituir_atual` off-flow (guiado curto, guiado longo B1, e atalho
aceito/parcial/`sem_titulo`/`fim_invalido`). Needs_review (`fraco`/`suspeito`) **não**
recebe a frase — nada foi "registrado" ali, o aviso E16 é a resposta em si.

B3. **Sem sobreposição**: se o turno é `/start`, só a saudação do `/start` (A) sai; a frase
de B1 jamais aparece junto no mesmo turno. Turno que **não** abriu o criar (fallback,
consulta, edição) também não recebe a frase.

B4. Nome via `comNome` (decisão 7 da Fase 5): conta sem nome → fallback sem tratamento.

## Critérios de aceite (testes)

- **Jest (`bot-gateway.service.spec.ts`)**: `handleUpdate` com `/start` e `/start@agendabo_bot`
  chama `flow.handleStart` e **nunca** `handleText`; texto normal continua `handleText`.
- **Jest (`scheduling-flow.service.spec.ts`)**:
  - `handleStart` sem conta → `cadastroNecessario`, zero LLM;
  - `handleStart` com conta → menu com nome (`name` da conta presente na mensagem);
  - `/start` no meio de um fluxo em andamento não abre/zera sessão;
  - guiado abre por fala → primeira mensagem enviada é "Olá … vamos registrar" seguida da
    pergunta do título;
  - atalho aceito → "Olá …" chega **antes** do eco "Entendi: …";
  - turno seguinte do fluxo → sem "Olá";
  - `/start` → nenhuma mensagem com "vamos registrar".
- **Vitest (máquina)**: invariância — a máquina não mudou; os testes existentes do atalho
  (phase4) passam sem alteração de asserções de texto.

## Fora de escopo

- Outros comandos de barra (`/ajuda`, `/menu`), deep-linking, `setMyCommands` do Telegram.
- Qualquer mudança na máquina, na régua, nos portões de extração ou no conteúdo do eco.
