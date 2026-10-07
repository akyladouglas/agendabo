# O que o bot entende 🤖

> Guia rápido + roteiro de teste. Fale normal — **nada de /comando**.
> Precisa de conta confirmada primeiro. Sem ela, o bot só manda o link de cadastro.

**Única regra pra lembrar:** se o bot não entendeu, ele **pergunta**. Ele nunca chuta.

---

## A. Marcar compromisso

### A1. Fluxo feliz ✅

```
você:  quero marcar uma consulta com a dentista
bot:   Como eu chamo esse compromisso?
você:  Consulta dentista
bot:   Em que dia?  [Hoje] [Amanhã] [08/10] [09/10] ...
você:  Amanhã
bot:   Que horas começa?  [14:00] [15:00] ... (ou digite 14:30)
você:  14:30
bot:   Que horas termina? Ou me diz a duração.
você:  1h
bot:   Tem algo pra eu anotar? (senão, "não")
você:  levar exame de imagem
bot:   Quer lembretes desse compromisso? Pode escolher:
       [30 min antes] [1 hora antes] [2 horas antes] [1 dia antes] [vários] [não]
       (ou digite, ex: "30min e 2h antes")
você:  30 min antes e 1 dia antes
bot:   Fechando: Consulta dentista — qui 08/10 14:30–15:30 📝 levar exame
       🕐 30min antes · 1 dia antes
       [confirmar] [alterar]
você:  confirmar
bot:   Prontinho! Criei "Consulta dentista" de qui 08/10 14:30–15:30 ✅
```

Funciona como duração: `1h` · `1h30` · `15min` · `90` · ou o horário de fim (`15:30`).

Depois do "Prontinho", cada antecedência escolhida virou um lembrete agendado (pode ter
mais de um por compromisso). Ele chega sozinho no horário certo — detalhes na
**seção C1**. Escolheu "não"? Nada de lembrete; o resumo diário (**C2**) chega de qualquer
jeito, se estiver ligado.

### A2. Conflito de horário ✅

```
você:  (escolhe 14:30 às 15:30, mas já tem algo às 14:00)
bot:   Deu conflito 😬 Você já tem "Consulta dentista" de qui 08/10 14:30–15:30.
       [remarcar] [abortar]
você:  remarcar → escolhe outro horário → ele confere de novo
você:  abortar  → nada é salvo
```

- Encostado **pode**: termina 15:00 / começa 15:00 → sem conflito.
- Compromisso passado não bloqueia.
- 3 tentativas de remarcar → ele sugere abortar. Você pode insistir.
- Você vê no seu fuso; ele guarda em UTC.

### A3. Desistir no meio ✅

Fale: `deixa pra lá` · `melhor não` · `cancela` · `para` → nada é salvo.

Ele ficou na dúvida? Pergunta: _"Quero cancelar, certo?"_
Responda `não` → volta **exatamente** de onde parou, nada se perde.

### A4. Começar outro sem terminar o atual

```
(meio do fluxo) você: na verdade quero marcar outra coisa
bot:  Já tem um em andamento. Descartar e começar novo? (sim/não)
```

### A5. Errar no meio

| Errou                    | Ele faz                                                                          |
| ------------------------ | -------------------------------------------------------------------------------- |
| fim antes do início      | re-pergunta só o fim                                                             |
| resposta sem sentido     | repete a pergunta do passo                                                       |
| quer mudar algo no final | `alterar o título` / `o dia` / `o horário` / `as notas` → volta só naquele passo |

---

## B. Consultar agenda

### B1. Perguntas que funcionam ✅

| Fale                             | Ele mostra                           |
| -------------------------------- | ------------------------------------ |
| "o que tenho hoje?"              | o dia inteiro (até o que já passou)  |
| "amanhã?"                        | amanhã                               |
| "esta semana" / "semana que vem" | segunda a domingo                    |
| "este mês" / "mês que vem"       | o mês                                |
| "e no fim de semana?"            | sábado + domingo                     |
| "dia 12?" / "de 10 a 12?"        | as datas ditas                       |
| "ano que vem"                    | contagem geral, aí você pede detalhe |

### B2. A resposta vem assim ✅

```
você: o que tenho amanhã?
bot:  Isto é o que você tem em qui 08/10:
      • 09:00–10:00 — Daily da equipe
      • 14:30–15:30 — Consulta dentista 📝 levar exame
```

- Ordenado por horário. Vários dias → agrupado por dia.
- ⚠️ _conferindo_ = ele não entendeu direito, vale revisar no site.
- Vazio = "Você não tem nada nesse período". **Só isso.** Ele nunca inventa compromisso.
- Passou de 10 → lista 10 e oferece o resto.

### B3. Consultar no meio de um agendamento ✅

```
(meio do fluxo) você: aliás, o que tenho amanhã?
bot:  Isto é o que você tem em qui 08/10: ...
bot:  (volta sozinho) Tem algo pra eu anotar?
```

### B4. Ele não pegou o período

```
você: meus compromissos
bot:  Pra qual período? Ex.: hoje, amanhã, semana que vem, dia 10 a 12
você: tanto faz  → ele encerra, sem insistir
```

Máximo 2 perguntas. Depois ele desiste com educação.

### B5. Etapa `lembrete` — escolha de lembretes (Fase 3)

Quando o fluxo chega na etapa `lembrete` (depois das notas), o bot pergunta assim:

```
bot:  Quer lembretes desse compromisso? Pode escolher:
      [30 min antes] [1 hora antes] [2 horas antes] [1 dia antes] [vários] [não]
      (ou digite, ex: "30min e 2h antes")
```

| Você responde                             | O que acontece                                          |
| ----------------------------------------- | ------------------------------------------------------- |
| um botão (ex.: `30 min antes`)            | esse lembrete, e só ele                                 |
| `vários`                                  | pergunta livre: "30min e 2h antes", "1h e 1 dia antes"… |
| `não` / `sem lembrete`                    | zero lembretes                                          |
| frase livre direto ("me lembra 2h antes") | o LLM extrai as antecedências                           |

Regras que valem aqui:

- **Atalhos determinísticos** (não passam pelo LLM): `não`/`sem lembrete` → zero; os
  4 botões → exatamente a antecedência do botão; "1 dia antes" → 24h. O resto vai ao
  LLM, que devolve `{rules, confidence}`; parse falho ou confiança baixa → o compromisso
  entra **em revisão** (fila da web) e o bot avisa — nada de lembrete inventado.
- **"2 horas antes" é EXATAS 2h** (`before_hours: 2`), não "2 slots de 1h".
- **Antecedência maior que o compromisso** (ex.: 1 dia antes de algo em 4h) → o bot avisa
  na escolha e descarta essa antecedência; as outras continuam. Múltiplas inválidas são
  listadas de uma vez.
- **"agora"/"já"** → o lembrete fica **retrasado e não dispara** (a regra vale para outros
  compromissos).
- **Na etapa `lembrete` nada vira cancelamento**: "cancela", "deixa pra lá"… são tratados
  como resposta do passo (inválida → repete a pergunta, máx. 2 tentativas). Pra desistir
  de vez, diga com as palavras: "cancelar agendamento" / "abandonar agendamento" /
  "cancelar este agendamento".
- **"alterar lembretes"** na confirmação → volta pra essa etapa, com as escolhas atuais
  preenchidas. Repetir a mesma antecedência não duplica.
- No **web** não tem aviso de atraso: regra retrassada é guardada silenciosamente e nunca
  dispara (o aviso é só no bot).

---

## C. Sem cadastro ✅

Qualquer mensagem → só o passo a passo de cadastro. Nada mais funciona.

---

## D. Ainda NÃO faz (próximas fases)

| Falta                                                             | Vem na    |
| ----------------------------------------------------------------- | --------- |
| Marcar solto: "quinzena que vem uns 14h" (hoje o quando é guiado) | Fase 4    |
| Editar/cancelar compromisso já criado pelo chat                   | Fase 4    |
| Site: calendário, revisão, cadastro                               | Fases 5–7 |

(Já faz desde a Fase 3: lembretes com escolha no chat — **C1** — e resumo diário
automático — **C2**. Editar/criar pelo web e regra `needs_review` na fila recalculam
os lembretes sozinhos.)

---

## C1. Lembrete chegou sozinho ✅ (Fase 3)

Na hora marcada (ex.: 30min antes), você recebe:

```
bot:  ⏰ Lembrete: "Consulta dentista" — qui 08/10 14:30–15:30
      Falta(m) 30min.
```

- A **conta de quando** dispara é determinística (`schedule-core`): `start − antecedência`.
  Sem LLM nessa parte.
- **Compromisso em revisão nunca lembrete**: se a reavaliação mudou o quando/notas e o
  levou pra fila, os lembretes param até você aprovar na web.
- Cancelou/apagou o compromisso (ou mudou o horário) → os lembretes antigos somem; novos
  são criados no lugar.
- Bot fora do ar na hora do lembrete → ele chega atrasado; mais de `NOTIFY_STALE_MINUTES`
  de atraso (default 30) → o lembrete vence sem enviar (você não recebe coisa velha).
- Reenvio automático até 3x em backoff; depois vira `failed` com o erro guardado.

## C2. Resumo diário automático ✅ (Fase 3)

Todo dia, no horário que **você escolheu no seu perfil** (web; default 07:00 — pode
desligar), chega:

```
bot:  📋 Resumo de 08/10 — seu dia (fuso America/Sao_Paulo):
      • 08:30–09:15 — Entrega relatório mensal
      • 14:00–16:00 — Aula de inglês
      Até mais!
```

Dia vazio:

```
bot:  ☀️ Hoje você está livre! Bom dia.
```

- São os compromissos do **SEU dia local** (data local com `utcOffset`), mesmo critério
  da web. Compromissos `needs_review` não entram.
- Se o bot estava fora, o resumo atrasado é enviado quando ele volta (dentro da janela
  de atraso); nunca sai duplicado.
- Mudou o fuso/timezone do perfil? O resumo daquele dia ainda usa o horário já marcado.

---

## E. Como o bot classifica sua fala

| Você fala                              | Ele entende                       |
| -------------------------------------- | --------------------------------- |
| "quero marcar X"                       | começar agendamento               |
| "o que tenho amanhã?"                  | listar agenda                     |
| "deixa pra lá"                         | cancelar o que estava fazendo     |
| "e às 16h?" (no conflito)              | remarcar                          |
| "marca outra coisa" (com fluxo aberto) | começa novo, perguntando antes    |
| "alterar lembretes" (na confirmação)   | volta a etapa de lembretes        |
| qualquer resposta ao passo             | seguir o fluxo                    |
| qualquer coisa na etapa `lembrete`     | resposta do passo (NUNCA cancela) |
| "me conta uma piada"                   | fora do escopo → resposta padrão  |

---

## F. Testar na sua máquina (≈5 min)

```bash
pnpm infra:up                              # Postgres + Redis
pnpm dev:api                               # API em :3001 (inclui o cron do resumo)
pnpm --filter @agendabo/api run dev:bot    # o bot
pnpm dev:worker                            # worker de notificações (Fase 3)
```

> Os três processos de cima são separados de propósito: long-polling único (gotcha 5)
> e o worker pode viver tanto quanto um lembrete (ADR-009). Sem o worker, lembretes e
> resumo ficam na fila sem sair.

1. Confirme sua conta (signup + código, ou direto no banco em dev).
2. Mande os cenários ✅ na ordem: **C0 → A1 → A2 → B1 → B2 → B3 → A3**.

**Deu esquisito?** Não é o modelo decidindo — é regra. Rode de novo ou mande
"o que tenho hoje?" pra ver o estado da agenda.
