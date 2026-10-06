# 0008 — LLM classifica a intenção da conversa (sem comando de barra), regras continuam decidindo

- Status: Aceito
- Data: 2026-10-06
- Contexto da fase: Fase 1 (criar compromisso no bot) / UX conversacional

## Contexto

O fluxo de agendamento é uma conversa. Exigir comandos (`/cancelar`, `/abortar`) ou
dependurar a interpretação de linguagem natural **inteira** à Fase 3 tornaria a Fase 1 um
formulário com cara de chat: o usuário teria que digitar `/cancelar` para desistir, e o bot
não entenderia "melhor não", "deixa pra lá", "quero mudar isso". O usuário pediu que o bot
entenda desistência, cancelamento, remarcação e substituição a partir da **fala natural**.

Ao mesmo tempo, a regra central do produto (ADR-004) é inegociável: o LLM não decide
conflito, data nem elegibilidade de notificação. Precisamos de LLM na conversa **sem**
mover o poder de decisão para o modelo.

## Decisão

- Na Fase 1 o bot usa o LLM **apenas para classificar a intenção** do turno do usuário
  dentro da máquina de estados: `criar` | `cancelar` | `continuar_fluxo` |
  `remarcar` | `substituir_atual` | `fora_do_escopo`. Isso é **entender**, não **decidir**.
- A **classificação** passa por zod (`contracts/llm`) com campo `confidence`. Se o parse
  falhar ou `confidence < MIN_CONFIDENCE_TO_ACCEPT`, o bot **pergunta de volta**
  ("é isso que você quer?") em vez de agir no chute — consistente com a regra llm.md.
- A **extração de data/hora em linguagem natural** ("pra quinzena que vem umas 14h")
  continua **fora da Fase 1** (é Fase 3). Aqui a coleta do horário ainda é guiada/determinística.
- Conflito, intervalo, notas e criação permanecem 100% determinísticos (`schedule-core` +
  zod na borda). A intent LLM **escolhe qual transição da máquina de estados** executar;
  ela nunca fabrica um `confirmed`, nunca escolhe horário e nunca diz se há conflito.
- Nenhum caminho cria/altera compromisso sem a máquina de estados + validação zod. A intent
  é um roteador, não uma fonte de dados de agenda.

## Consequências

- Conversa natural (sem barra) já na Fase 1, sem abrir mão da garantia determinística.
- O custo de LLM entra mais cedo (1 chamada de classificação por turno ambíguo), com
  modelo primário barato (haiku) e janela de histórico limitada (regra llm.md nº 7).
- A máquina de estados passa a ter transições dirigidas por intent **e** por dados de passo
  (horário/notas). Cada transição tem teste com `AnthropicMessagesClient` stubado
  (payloads: intenção clara / duvidosa / parse falho / fora do escopo).
- A Fase 3 reutiliza este mesmo trilho (LLM → zod → confiança) só que para extrair o
  candidato de agendamento; nada aqui precisa ser jogado fora.

## Modelos (confirmado com o humano em 2026-10-06)

- **Primário:** `claude-haiku-4-5-20251001` ($1/$5 por MTok). **Escalada:** `claude-sonnet-5-5`
  ($2/$10). Escala só em falha de parse/timeout. Definido em `LLM_MODEL_PRIMARY` /
  `LLM_MODEL_ESCALATION` (env + default em `env.validation.ts`). Prompts estáveis usam
  `cache_control` para baratear a entrada (regra llm.md nº 4).
