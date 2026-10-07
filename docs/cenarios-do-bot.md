# Cenários do bot — onboarding e roteiro de testes

> O que o bot **já entende hoje** e como cada fluxo se comporta. Atualizado ao fim de
> cada fase do roadmap (Fase 1: criar compromisso · Fase 2: consultar agenda).
> Serve como roteiro de smoke-test: rode os cenários marcados com ✅ na ordem.
> Lembrete: o bot só atende telegramId **cadastrado com email confirmado** — sem isso,
> ele só responde com a orientação de cadastro (cenário A0).

---

## Regra de ouro (vale para tudo)

**Nada de comando de barra.** Você fala normal; o bot classifica a intenção. Se ele não
tiver certeza do que você quis, ele **pergunta** em vez de agir no chute (ADR-008). E o
que ele **decide** (conflito, datas, lembretes) é regra determinística — o LLM só
interpreta (ADR-004).

---

## A. Criar compromisso (Fase 1)

### A1. Fluxo feliz ✅

```
você:  quero marcar uma consulta com a dentista
bot:  Bora marcar! Como eu chamo esse compromisso?   (ou usa a própria fala como título)
você: Consulta dentista
bot:  Em que dia vai ser?  [Hoje] [Amanhã] [08/10] [09/10] ...
você: Amanhã            (ou clica no botão, ou digita 08/10)
bot:  Que horas começa?  [09:00] [10:00] ... (ou digite 14:30)
você: 14:30
bot:  Que horas termina? Ou me diz a duração ("1h30", "15min").
você: 1h                (ou "15:30" — aceita os dois; fim antes do início re-pergunta)
bot:  Tem alguma informação importante pra eu anotar? (senão, "não")
você: levar exame de imagem
bot:  Fechando então: Consulta dentista — qui 08/10 14:30–15:30, 📝 levar exame...
      Confirmo? [confirmar] [alterar]
você: confirmar
bot:  Prontinho! Criei "Consulta dentista" de qui 08/10 14:30–15:30 ✅
```

Também funcionam como duração: `1h`, `1h30`, `15min`, `90`, ou o horário de fim.

### A2. Deu conflito (1.1) ✅

```
você:  quero marcar um café com a Ana
... (título, hoje, 14:30, 1h)
bot:  Deu conflito com o que você já tem 😬
      Você já tem "Consulta dentista" de qui 08/10 14:30–15:30.
      Quer remarcar pra outro horário ou abortar?  [remarcar] [abortar]
você: remarcar → escolhe outro horário → ele checa de novo
você: abortar  → "Nada foi salvo."
```

- O horário é sempre exibido **no seu fuso**; guardado em UTC.
- Encostado **não** é conflito (termina 15:00 / começa 15:00 → pode).
- Compromisso já passado não bloqueia nada.
- Até **3 tentativas** de remarcar; depois ele sugere abortar (mas você pode insistir).

### A3. Desistir no meio (fala natural, sem comando) ✅

```
você: deixa pra lá        → cancela na hora, nada é salvo
você: melhor não          → idem
bot (se ficou na dúvida): "Quero cancelar este compromisso, certo? (sim/não)"
você: não                 → volta exatamente de onde parou (nada se perde)
```

### A4. Começar outro sem terminar o atual

```
(meio do fluxo) você: na verdade quero marcar outra coisa
bot:  Você já tem um compromisso em andamento aqui.
      Quer descartar ele e começar um novo? (sim/não)
```

### A5. Errar dados no meio

- Fim antes do início → re-pergunta só o fim.
- Resposta que ele não entendeu no passo → repete a pergunta do passo.
- No resumo final: `alterar o título` / `alterar o dia` / `alterar o horário` /
  `alterar as notas` → ele volta direto naquele passo, mantendo o resto.

---

## B. Consultar agenda (Fase 2)

### B1. Perguntas que ele entende ✅

| Você diz                                                       | Ele mostra                                             |
| -------------------------------------------------------------- | ------------------------------------------------------ |
| "o que tenho hoje?" / "minha agenda de hoje"                   | o **dia inteiro** (até o que já passou)                |
| "amanhã?"                                                      | amanhã                                                 |
| "depois de amanhã"                                             | depois de amanhã                                       |
| "esta semana" / "semana que vem"                               | semana civil (segunda a domingo)                       |
| "este mês" / "mês que vem"                                     | mês civil                                              |
| "ano que vem"                                                  | ano inteiro (resumo com contagem se tiver muita coisa) |
| "e no fim de semana?"                                          | sábado + domingo                                       |
| "o que tenho dia 12?" / "de 10 a 12?" / "dia 5 do mês que vem" | datas explícitas                                       |

### B2. Como vem a resposta ✅

```
você: o que tenho amanhã?
bot:  Isto é o que você tem em qui 08/10:
      • 09:00–10:00 — Daily da equipe
      • 14:30–15:30 — Consulta dentista 📝 levar exame
```

- Ordenado por horário, agrupado por dia quando o período pega vários dias.
- Compromisso que o bot ainda não confirmou aparece com ⚠️ _conferindo_.
- Vazio: "Você não tem nada nesse período" — e **só** isso (ele nunca inventa).
- Passou de 10 itens: lista 10 e pergunta se quer o resto / período menor.
- Período gigante (ex.: "ano que vem") com muita coisa: contagem + oferta de detalhar.

### B3. Perguntar no meio de um agendamento ✅

```
(meio do criar, passo das notas) você: aliás, o que tenho amanhã?
bot:  Isto é o que você tem em qui 08/10: ...
bot:  (volta sozinho) Tem alguma informação importante pra eu anotar?
```

### B4. Ele não entendeu o período

```
você: meus compromissos
bot:  Para qual período você quer ver? Ex.: hoje, amanhã, semana que vem, dia 10 a 12
você: tanto faz          → "beleza, encerro aqui" (não fica insistindo)
```

(ele no máximo pergunta 2 vezes, depois encerra educadamente)

---

## C. Quem não pode usar o bot

### C0. Sem cadastro ✅

```
qualquer mensagem → "passa no site e cria sua conta" (e nada mais acontece)
```

---

## D. O que o bot ainda NÃO faz (próximas fases)

| Ainda não                                                                         | Vem na fase                           |
| --------------------------------------------------------------------------------- | ------------------------------------- |
| Lembretes ("me lembra 1 dia antes")                                               | Fase 3 (notificações + resumo diário) |
| Resumo diário automático (ex.: 07:00)                                             | Fase 3                                |
| Marcar em data 100% livre ("quinzena que vem uns 14h") — hoje o "quando" é guiado | Fase 4 (LLM avançado)                 |
| Editar/cancelar compromisso **já criado** pelo chat                               | Fase 4                                |
| Site: calendário, tela de revisão, cadastro web                                   | Fases 5–7                             |

---

## E. Tabela rápida de intenções (como o bot classifica)

| Intenção         | Exemplo de fala                              | O que acontece                |
| ---------------- | -------------------------------------------- | ----------------------------- |
| criar            | "quero marcar X", "bora agendar Y"           | abre o fluxo guiado           |
| consultar        | "o que tenho amanhã?", "minha semana"        | lista o período               |
| cancelar         | "deixa pra lá", "cancela", "para"            | descarta o que estava fazendo |
| remarcar         | "e às 16h?", "melhor de manhã" (no conflito) | re-checa conflito             |
| substituir_atual | "não, marca outra coisa"                     | pergunta antes de descartar   |
| continuar_fluxo  | responder a pergunta atual do bot            | avança o passo                |
| fora_do_escopo   | "me conta uma piada"                         | resposta padrão, sem efeitos  |

**Dica de teste:** se o bot parecer "burro" numa frase, não é o modelo decidindo — é
ele seguindo a regra. Rode o cenário de novo ou pergunte "o que tenho hoje?" pra ver o
estado da sua agenda.

---

## F. Como testar na sua máquina

```bash
pnpm infra:up                              # Postgres + Redis
pnpm --filter @agendabo/api prisma:migrate # se ainda não rodou
pnpm dev:api                               # API em :3001
pnpm --filter @agendabo/api run dev:bot    # o bot (long-polling)
```

Contas: cadastre seu telegramId pela API (signup + código) ou pelo banco em dev.
Depois rode os cenários ✅ acima, na ordem: **C0 → A1 → A2 → B1 → B2 → B3 → A3**.
