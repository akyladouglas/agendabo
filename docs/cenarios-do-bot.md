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
bot:   Fechando: Consulta dentista — qui 08/10 14:30–15:30 📝 levar exame
       [confirmar] [alterar]
você:  confirmar
bot:   Prontinho! Criei "Consulta dentista" de qui 08/10 14:30–15:30 ✅
```

Funciona como duração: `1h` · `1h30` · `15min` · `90` · ou o horário de fim (`15:30`).

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

---

## C. Sem cadastro ✅

Qualquer mensagem → só o passo a passo de cadastro. Nada mais funciona.

---

## D. Ainda NÃO faz (próximas fases)

| Falta                                                             | Vem na    |
| ----------------------------------------------------------------- | --------- |
| Lembrete ("me lembra 1 dia antes")                                | Fase 3    |
| Resumo diário automático (07:00)                                  | Fase 3    |
| Marcar solto: "quinzena que vem uns 14h" (hoje o quando é guiado) | Fase 4    |
| Editar/cancelar compromisso já criado pelo chat                   | Fase 4    |
| Site: calendário, revisão, cadastro                               | Fases 5–7 |

---

## E. Como o bot classifica sua fala

| Você fala                              | Ele entende                      |
| -------------------------------------- | -------------------------------- |
| "quero marcar X"                       | começar agendamento              |
| "o que tenho amanhã?"                  | listar agenda                    |
| "deixa pra lá"                         | cancelar o que estava fazendo    |
| "e às 16h?" (no conflito)              | remarcar                         |
| "marca outra coisa" (com fluxo aberto) | começa novo, perguntando antes   |
| qualquer resposta ao passo             | seguir o fluxo                   |
| "me conta uma piada"                   | fora do escopo → resposta padrão |

---

## F. Testar na sua máquina (≈5 min)

```bash
pnpm infra:up                              # Postgres + Redis
pnpm dev:api                               # API em :3001
pnpm --filter @agendabo/api run dev:bot    # o bot
```

1. Confirme sua conta (signup + código, ou direto no banco em dev).
2. Mande os cenários ✅ na ordem: **C0 → A1 → A2 → B1 → B2 → B3 → A3**.

**Deu esquisito?** Não é o modelo decidindo — é regra. Rode de novo ou mande
"o que tenho hoje?" pra ver o estado da agenda.
