# Regra — LLM em runtime (bot + consultas)

**Escopo:** tudo que toca o Anthropic SDK (`modules/ai`), o fluxo do bot e a fila de revisão.

## Princípios

1. **O LLM só interpreta, nunca decide (ADR-003).** Data "livre" do usuário vira um
   _candidato_ a compromisso; conflito, disparos de lembrete e elegibilidade de notificação
   são 100% `schedule-core` determinístico.
2. **Toda resposta do LLM é validada por zod** (`extrairAgendamentoSchema`,
   `interpretarConsultaSchema` em `@agendabo/contracts/llm`). Parse falho OU
   `confidence < MIN_CONFIDENCE_TO_ACCEPT` ⇒ cria com `status: needs_review` +
   `rawText` + `reviewReason`. **Nunca chute silencioso.**
3. **Function calling com tool JSON Schema escrita à mão** espelhando o zod (padrão
   financas): sem `minimum`/`maximum` no schema, sem `additionalProperties: false` quando
   houver campos opcionais (strict do Anthropic exige todos os campos obrigatórios — o
   contrato real é o zod em modo strip, gotcha 4).
4. **Cascata de modelo**: primário (haiku) → escala (sonnet) em falha de parse/timeout.
   Prompt cache só no bloco estável do system prompt; data de hoje/histórico ficam em bloco
   volatile sem cache.
5. **Contexto de conversação** do bot vive em memória por chat (máquina de estados do
   fluxo de agendamento), com TTL; nada de estado de conversa no banco por mensagem.
6. O bot **só atende** telegramIds cadastrados com email confirmado; qualquer outro chat
   recebe apenas a orientação de cadastro (e isso é logado, nunca cria conta).
7. Preços/latência: prompt curto, respostas em JSON de tool, máx. 1 tentativa extra por
   request. Nunca mandar dados sensíveis de outros usuários no prompt.
8. Toda frase que o LLM "não entendeu" deve ser recuperável: `rawText` + motivo
   (`parse_falho` | `confianca_baixa` | `fora_do_escopo`) ficam no `needs_review` para a
   tela de revisão (3.3).
