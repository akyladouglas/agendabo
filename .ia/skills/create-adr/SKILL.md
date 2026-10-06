---
name: create-adr
description: Cria ADRs (Architecture Decision Records) no formato correto, bilíngue (PT-BR + EN), seguindo o template em ia-docs/decisions/. Use quando o usuário pedir "criar ADR", "documentar decisão", "registrar decisão de arquitetura" ou quando uma decisão de arquitetura não-trivial for tomada.
license: CC-BY-4.0 (base: Tech Leads Club)
metadata:
  author: Agendabo (adaptado de Tech Leads Club - github.com/tech-leads-club)
  version: '1.0.0'
---

# ADR Creator (Agendabo)

Você é um especialista em criar Architecture Decision Records (ADRs) — documentos concisos e duráveis que capturam o contexto, a decisão e as consequências de escolhas arquitetônicas significativas, permitindo que futuros membros da equipe entendam _por que_ as coisas são do jeito que são.

## Quando usar esta skill

Use esta skill quando:

- O usuário pedir para "escrever um ADR", "criar um ADR", "adicionar um architecture decision record"
- O usuário quiser "documentar por que escolhemos X", "registrar esta decisão", "capturar esta escolha arquitetônica"
- Uma decisão técnica significativa tiver sido tomada (ou estiver sendo finalizada) e precisar ser registrada
- A equipe quiser preservar o raciocínio por trás de uma escolha para engenheiros futuros
- O usuário perguntar "por que escolhemos X" e a resposta deve ser escrita permanentemente

**NÃO** use para:

- Decisões ainda não tomadas — use `create-rfc` para conduzir o processo de decisão primeiro
- Planejamento de implementação após a decisão — use o plano de trabalho (`ia-docs/plans/`)
- Escolhas de configuração simples ou decisões triviais de código
- Notas de reunião ou documentação geral

## ADR vs RFC — Distinção crítica

| Aspecto          | ADR                                         | RFC                                 |
| ---------------- | ------------------------------------------- | ----------------------------------- |
| **Timing**       | Decisão já tomada (ou sendo finalizada)     | Antes da decisão (buscando input)   |
| **Propósito**    | Registro para futuros membros da equipe     | Proposta buscando aprovação         |
| **Audience**     | Engenheiros que chegam meses ou anos depois | Stakeholders atuais                 |
| **Comprimento**  | Curto — 200–500 palavras                    | Longo — comparação aprofundada      |
| **Mutabilidade** | Imutável — superseded, nunca editado        | Iterativo — evolui durante a review |
| **Tom**          | Registro histórico                          | Proposta deliberativa               |

Se o usuário diz "preciso decidir se faço X" → use `create-rfc`.
Se o usuário diz "decidimos fazer X, deixa eu documentar" → use esta skill.

## Adaptação ao Agendabo

**CRÍTICO**: Esta skill foi adaptada do Tech Leads Club para o contexto do `agendabo`:

1. **Local dos ADRs**: `ia-docs/decisions/` (não `docs/adr/`)
2. **Idioma**: ADR em pt-br (`ia-docs/decisions/pt-br/`); versão EN opcional sob demanda
3. **Numeração global**: incremento sequencial (`0000`, `0001`, ...); ADR é imutável — decisão nova que o contradiz ganha número novo e `Supersede: NNNN`
4. **Template**: use o template em `ia-docs/decisions/TEMPLATE-pt-br.md`

## Fluxo interativo

### Passo 1: Coletar contexto (se não fornecido)

Se o usuário fornecer contexto mínimo, use **AskQuestion** para coletar informações essenciais:

```json
{
  "title": "Informações do ADR",
  "questions": [
    {
      "id": "adr_decision",
      "prompt": "Qual foi a decisão tomada? (ex.: 'Usar PostgreSQL para armazenamento primário')",
      "options": [
        { "id": "free_text", "label": "Descreverei na próxima mensagem" }
      ]
    },
    {
      "id": "adr_status",
      "prompt": "Qual é o status atual desta decisão?",
      "options": [
        { "id": "accepted", "label": "Accepted — decisão é final" },
        {
          "id": "proposed",
          "label": "Proposed — decisão está sendo finalizada"
        },
        {
          "id": "deprecated",
          "label": "Deprecated — esta abordagem não é mais recomendada"
        },
        {
          "id": "superseded",
          "label": "Superseded — substituída por uma decisão mais nova"
        }
      ]
    },
    {
      "id": "adr_supersedes",
      "prompt": "Este ADR substitui uma decisão anterior?",
      "options": [
        { "id": "yes", "label": "Sim — fornecerei o número/título do ADR" },
        { "id": "no", "label": "Não — esta é uma decisão nova" }
      ]
    }
  ]
}
```

### Passo 2: Validar campos obrigatórios

**Campos obrigatórios — pergunte se faltarem**:

- **Título da decisão** (frase nominal, não pergunta — ex.: "Usar Redis para armazenamento de sessão")
- **Data** da decisão (ou data de hoje)
- **Status** (Accepted / Proposed / Deprecated / Superseded)
- **Contexto** — as forças, restrições e situação que tornaram esta decisão necessária
- **A decisão em si** — o que foi escolhido e por quê
- **Consequências** — o que fica mais fácil, mais difícil ou diferente como resultado

**Campos recomendados**:

- **Drivers da decisão** — os critérios ou restrições-chave
- **Opções consideradas** — quais alternativas foram avaliadas
- **Prós/contras por opção** — avaliação honesta dos trade-offs
- **Racional do resultado da decisão** — por que esta opção em vez das outras
- **Links** — ADRs relacionados, RFCs, tickets ou documentação

Se qualquer campo obrigatório estiver faltando, pergunte **NA LÍNGUA DO USUÁRIO** antes de gerar o documento.

### Passo 3: Atribuir número do ADR

1. Liste os ADRs existentes em `ia-docs/decisions/pt-br/`:
   ```bash
   ls ia-docs/decisions/pt-br/
   ```
2. Encontre o maior número (ex.: `0005`)
3. Atribua o próximo número (ex.: se ADR-005 existe, este será ADR-006)
4. Se nenhum ADR existir, comece em ADR-0000 (o bootstrap já foi feito)

### Passo 4: Gerar o ADR em PT-BR

1. Copie o template:
   ```bash
   cp ia-docs/decisions/TEMPLATE-pt-br.md ia-docs/decisions/pt-br/NNNN-<título-curto>.md
   ```
2. Preencha as seções seguindo o template

### Passo 5 (opcional): Versão em EN

Só se o usuário pedir. Copie `ia-docs/decisions/TEMPLATE-en.md` para
`ia-docs/decisions/en/NNNN-<título-curto>.md` e traduza o PT-BR mantendo número e nome de arquivo.

### Passo 6: Atualizar o índice

1. Abra `ia-docs/decisions/README.md`
2. Adicione uma nova linha na tabela "Índice de ADRs":
   ```markdown
   | [NNNN](pt-br/NNNN-<título-curto>.md) | <Título curto> | Proposed | YYYY-MM-DD |
   ```

### Passo 7: Lembrete ao usuário

- "O ADR foi criado como `Proposed`. Após aprovação humana, mude o status pra `Accepted`."
- "Não esqueça de rodar `npm run sync:ia` se você editou arquivos em `.ia/` (não é o caso do ADR, mas é um bom hábito)."

## Checklist de qualidade do ADR

Antes de finalizar, verifique:

- [ ] **Título** é uma frase nominal descrevendo a decisão (não pergunta, não rótulo vago)
- [ ] **Data** está incluída (decisões sem data perdem contexto rapidamente)
- [ ] **Status** está definido corretamente — Accepted, Proposed, Deprecated ou Superseded
- [ ] **Contexto** explica as _forças_ que tornaram esta decisão necessária, não só o que foi feito
- [ ] **Decisão** está declarada diretamente e atrelada ao contexto
- [ ] **Consequências** inclui trade-offs honestos — não só positivos
- [ ] **Opções** inclui pelo menos 2 alternativas realmente consideradas
- [ ] **Supersedes / superseded by** links estão incluídos quando aplicável
- [ ] **Arquivo** segue a convenção de nomenclatura: `NNNN-kebab-case-title.md`
- [ ] **Número** é sequencial no diretório de ADRs
- [ ] **Bilíngue**: ambos os arquivos (PT-BR e EN) foram criados com o mesmo número

## Convenção de nomenclatura de arquivos

```
ia-docs/decisions/
├── pt-br/
│   ├── 0000-adopt-adr-process.md
│   ├── 0001-mvvm-clean-architecture.md
│   └── 0006-<novo-título>.md
└── en/
    ├── 0000-adopt-adr-process.md
    ├── 0001-mvvm-clean-architecture.md
    └── 0006-<novo-título>.md
```

- Números com zero à esquerda: `0000`, `0001`, ... `0099`, `0100`
- Título em kebab-case
- Extensão `.md`

## Anti-padrões comuns a evitar

### Título como pergunta

**RUIM**: `# ADR-0001: Devemos usar PostgreSQL?`

**BOM**: `# ADR-0001: Usar PostgreSQL para Armazenamento Primário`

Títulos devem registrar a decisão, não a pergunta. Leitores futuros precisam saber _o que foi decidido_, não o que foi considerado.

### Contexto vago

**RUIM**:

```
Precisávamos de um banco de dados e escolhemos PostgreSQL.
```

**BOM**:

```
Nossa aplicação requer um banco de dados relacional com garantias ACID fortes.
A equipe tem experiência profunda em PostgreSQL. MySQL foi avaliado, mas
não tem suporte nativo a colunas JSONB, que nosso design de schema requer.
Nosso provedor de nuvem (AWS) oferece PostgreSQL gerenciado via RDS a custo aceitável.
```

O contexto deve explicar as _forças_ — por que a alternativa não foi obviamente melhor?

### Consequências sem trade-offs

**RUIM**:

```
## Consequências
PostgreSQL é rápido e confiável.
```

**BOM**:

```
## Consequências
- Habilita colunas JSONB e indexação avançada para nossos padrões de query
- Expertise da equipe significa onboarding rápido e menos surpresas operacionais
- Adiciona fardo operacional comparado a um serviço NoSQL gerenciado
- Migrações de schema requerem planejamento cuidadoso em um modelo relacional
```

Trade-offs honestos é o que torna ADRs valiosos anos depois.

### Editar em vez de supersedar

**RUIM**: Editar um ADR antigo para mudar a decisão depois do fato.

**BOM**: Criar um novo ADR com `Status: Superseded by ADR-{NNN}` no antigo e link de volta.

ADRs são registros históricos. A decisão antiga estava correta _dado o que se sabia na época_. Supersedar preserva esse contexto.

### Falta do racional "por que não"

**RUIM**:

```
## Decisão
Usaremos Redis para armazenamento de sessão.
```

**BOM**:

```
## Decisão
Usaremos Redis para armazenamento de sessão. Consideramos armazenar sessões em
PostgreSQL (já no nosso stack), mas o suporte nativo a TTL do Redis e o
desempenho em memória o tornam significativamente mais adequado para leituras
de sessão de alta frequência. O custo operacional de um serviço adicional é
justificado pela lógica de expiração de sessão simplificada.
```

O racional é _por que esta opção e não as outras_ — não só o que foi escolhido.

## Notas importantes

- **ADRs são imutáveis** — nunca edite a decisão. Supersede com um novo ADR.
- **Curto é melhor** — 200–500 palavras é ideal. Se precisar ser mais longo, mova detalhes para um plano de trabalho linkado.
- **Contexto envelhece** — sempre date o ADR; o que parece óbvio agora não será em 3 anos.
- **Consequências honestas** — um ADR unilateral perde credibilidade. Engenheiros futuros vão enfrentar as desvantagens de qualquer jeito.
- **Ligue tudo** — ADRs relacionados, o RFC que conduziu a decisão, tickets, referências de PR.
- **Bilíngue** — sempre crie em ambos os idiomas (PT-BR e EN).
- **Numere sequencialmente** — verifique o diretório antes de atribuir um número.

## Exemplos de prompts que disparam esta skill

### Português

- "Escreva um ADR sobre a decisão de usar PostgreSQL"
- "Documente a decisão de adotar GraphQL no projeto"
- "Crie um ADR explicando por que escolhemos Kafka"
- "Preciso registrar por que escolhemos a abordagem X"
- "Adicione um architecture decision record para nossa abordagem de autenticação"

### Inglês

- "Write an ADR for using PostgreSQL as our primary database"
- "Document our decision to adopt GraphQL"
- "Create an ADR for moving our frontend to Next.js"
- "I need to record why we chose Kafka over RabbitMQ"
- "Add an architecture decision record for our authentication approach"
