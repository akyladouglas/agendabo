# Plano — Notas que começam com "não" + fim (período multi-dia) na web

- Data: 2026-10-11 | Status: implementada (gates verdes; aguarda commit/smoke humano)
- Spec: .ia/specs/agendamento/notas-e-fim-na-web.spec.md | Fase do roadmap: hardening pós-Fase 8
- Orquestrador: feature-builder (subagent) | v1 do plano

## 1. Objetivo

Corrigir o bug do bot (nota começando com "não" descartada por `parseNotesAnswer`) com a
fronteira ≥4 palavras aprovada, e trocar o modelo do form web de "início + duração" para
"início (data+hora) + fim (data+hora)" com duração derivada, fim multi-dia, erro inline
fim≤início e pergunta inline ao mudar só a data de início; garantir rótulo multi-dia na
agenda (C) — zero API nova, zero migration, `schedule-core` intocado.

## 2. Análise de profundidade

- **Bot**: `parseNotesAnswer` (`apps/api/src/modules/bot/messages.ts:73-78`) chama
  `parseYesNo` (casa `NO_WORDS` pela 1ª palavra, :51-53) ⇒ "não esquecer nada na volta" vira
  `null`. Consumidor: `case "notas"` da máquina (`scheduling-flow.machine.ts:1859-1890`,
  uso em :1880). `parseYesNo` NÃO pode mudar (passos confirmar/alterar/conflito dependem da
  cabeça). `NOTES_PREFIX_RE` já existe (:69-70). Ruído ≤3 chars já re-pergunta na máquina
  (:1867-1874). Testes vizinhos: `messages-usable-title.spec.ts` (vitest puro em
  messages.ts), `scheduling-flow.machine.spec.ts` (vitest, `now`/offset/existing injetados).
- **Web**: form em `useAppointmentForm.composable.ts` — campos `date`/`time`/
  `durationMinutes`; `resolveRange` (:173-199) deriva `endsAt = startsAt + dur`;
  `fromAppointment`/`fromAppointmentWithPreset` (:88-123) e `emptyValues` (:151-164)
  constroem valores; zod em `fieldsSchema` (:256-277); submit valida
  `appointmentInputSchema` em `buildInput` (:380-394). `AppointmentModal.vue` renderiza o
  campo Duração (:54-73). Helpers de borda em `tz.ts`: `localDateTimeToUtc`,
  `toLocalDateString/Time`, `formatRangeInTz` (já rótula fim que vaza o dia). Grade Dia/
  Semana já usa `layoutDayTimeline` + `formatRangeInTz` no tempo e no `ariaLabel`
  (AgendaPage.vue :495-550, :703) — C é garantir com testes, quase zero código novo.
  Testes web: vitest em `apps/web/tests/*.spec.ts` (`appointment-form.spec.ts`, `tz.spec.ts`
  são os vizinhos).
- **Contratos**: `appointmentInputSchema` inalterada (`{startsAt, endsAt}`) — asserção de
  contrato nos testes existentes preservada.
- **Gaps**: `resolveRange` novo modelo início↔fim bidirecional precisa de helper puro com
  `timezone` injetável; a "pergunta" da decisão 2 é estado do composable (opção inline),
  sem cálculo no `.vue`.

## 3. Decisões

| #   | Decisão                                                                                                                                                                                                                                                                                                                         | Alternativa descartada                                  | Por quê                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Fronteira como constante exportada `NOTES_MIN_PHRASE_WORDS = 4` em `messages.ts`; `parseNotesAnswer` decide sozinho (cabeça em `NO_WORDS` + ≥4 palavras normalizadas ⇒ nota literal; ≤3 ⇒ `null`), `parseYesNo` intocado                                                                                                        | Consertar `parseYesNo`                                  | Spec decisão #1: demais passos precisam da cabeça intacta; A3 pede constante testável na borda do bot                                              |
| D2  | Contagem de palavras sobre o texto normalizado (NFD sem acento, minúsculas, espaços comprimidos) — mesma normalização de fala usada em `normalize`/`normalizeB2`                                                                                                                                                                | Contar no texto cru                                     | "palavras normalizadas" é o termo da spec; evita divergir de `NO_WORDS`                                                                            |
| D3  | Form: `AppointmentFormValues` ganha `endDate`/`endTime`; `durationMinutes` sai dos valores e vira derivado (`range` → minutos) somente interno/exibição                                                                                                                                                                         | Manter `durationMinutes` como campo editável secundário | Spec decisão #4; evita fonte dupla de verdade                                                                                                      |
| D4  | `resolveRange` passa a validar início E fim (strings locais) e retorna `null` se fim ≤ início (erro inline vem do zod do form com a mensagem pt-BR)                                                                                                                                                                             | Manter resolveRange antigo + validação separada         | Spec B3; um único puro testável cobrindo o novo modelo (Gherkin B)                                                                                 |
| D5  | Helpers puros novos: `applyStartTimeChange` (hora do início ⇒ fim desliza preservando duração) e `applyStartDateChange` (data do início ⇒ desliza o fim) em `tz.ts`/composable; a escolha "manter intervalo vs definir novo fim" é estado `startDateChoice` do composable com `keepInterval()`/`defineNewEnd()`, default manter | Perguntar via window.confirm / sempre travar fim        | Spec B2 + decisão humana #2 (opção c); zero cálculo no `.vue`                                                                                      |
| D6  | Sem fim configurado (criação sem preset de fim) nunca pergunta; mudança de HORA de início sempre desliza o fim sem perguntar                                                                                                                                                                                                    | Perguntar em qualquer mudança de início                 | Literal da spec B2                                                                                                                                 |
| D7  | Rótulos C: reusar `formatRangeInTz` em grade/chip/aria-label/painel (já cobertos); teste novo asserting fim com dia em Dia e Semana; check-conflict/relocation multi-dia = testes de payload                                                                                                                                    | Criar formatador novo                                   | Spec decisão #6                                                                                                                                    |
| D8  | `AppointmentPreset.endsAt`/drop entram via fim absoluto derivado (`endDate`/`endTime` do instante) — exibição e payload idênticos ao path de duração antigo                                                                                                                                                                     | Converter preset em duração e derivar fim               | Presets "entram convertendo para início+duração como hoje e o fim é derivado" (B4) — resultado observável é o mesmo; o modelo novo é fim-explicito |

## 4. Etapas

| #   | Etapa                                                                                                                                                                                                                                                                 | Worker          | Status | Saída (condição de pronta)                                                                                    | Relatório                                                                                                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | A — TDD `parseNotesAnswer` (fronteira 3/4, "não" puro, "não tenho nada", "Não esquecer nada na volta", "anotar: X", sinônimos `NO_WORDS`) + fix em `messages.ts` + teste de máquina no passo `notas` (nota literal segue p/ lembrete; zero LLM)                       | feature-builder | feita  | vitest verde nos novos + máquina mãe ("não"→null, "anotar:"→strip) passando                                   | `messages-notes.spec.ts` 10 casos; máquina: 2 casos novos; fix: `NOTES_MIN_PHRASE_WORDS=4` + `parseNotesAnswer` próprio                                                                                                                    |
| 2   | B — TDD helpers do form (`resolveRange` início+fim, fim multi-dia, fim≤início→null; `applyStartTimeChange`/`applyStartDateChange` com tz injetável) + zod do form com erro "O fim precisa ser depois do início" + estado da pergunta inline (decisão 2) no composable | feature-builder | feita  | vitest do composable verde (Gherkin B); payload ainda `appointmentInputSchema`                                | resolveRange novo modelo; helpers `shiftEndToStart`/`endAfterStart`; composable: `endDate/endTime`, `durationMinutes` derivado, `endDatePrompt`/`resolveStartDateChoice`; submit bloqueado fim≤início (sem check-conflict)                 |
| 3   | B/C — `AppointmentModal.vue`: campos Data/Início/Fim(data+hora) + escolha inline + preview; grade Dia/Semana com rótulo multi-dia (testes de C: bloco sáb→seg na segunda, aria-label, check-conflict/relocation multi-dia)                                            | feature-builder | feita  | modal renderiza fim editável; testes de rótulo/conflito multi-dia verdes; lint:arch verde (zero data no .vue) | Modal: inputs ap-end-date/ap-end-time, prompt inline (data-end-prompt + testids), duração só leitura; AgendaPage `detailTime` já usava formatRangeInTz; testes: dia-grid aria-label multi-dia, calendar-views payload relocation multi-dia |
| 4   | Gates + docs: `pnpm build && pnpm test && pnpm lint && pnpm lint:arch`; gotcha novo em `docs/gotchas.md` (negação de cabeça engole frase); spec → status `implementada`; `pnpm sync:ia`                                                                               | feature-builder | feita  | 4 gates verdes (0 erros), docs consistentes                                                                   | build ✓; test ✓ (contracts 76, schedule-core 202, api vitest 165 + jest 23 suites, web 127); lint ✓ (0 erros); lint:arch ✓                                                                                                                 |

## 5. Próxima ação

Entrega para o humano: revisão do working tree (nada commitado de propósito), depois commit
convencional (ex.: `fix(bot,web): nota literal negada na cabeca + fim explicito multi-dia na web`)
e smoke manual do fluxo (bot: "não esquecer nada na volta"; web: criar com fim no dia seguinte).

## 6. Log

- 2026-10-11 — plano criado a partir da spec aprovada; análise read-only concluída (parseNotesAnswer→parseYesNo confirmado; form model date+time+duration confirmado; grade já usa layoutDayTimeline+formatRangeInTz).
- 2026-10-11 — Etapa 1 (bot) TDD: red confirmado (caso "Não esquecer nada na volta" falhou), verde após fix em `messages.ts`. Suite bot + máquina verdes.
- 2026-10-11 — Etapa 2 (web helpers) TDD: red (resolveRange novo modelo), verde: resolveRange início↔fim, `shiftEndToStart`, `endAfterStart`, composable com `endDate/endTime` + prompt de data de início. Suite web verde.
- 2026-10-11 — Etapa 3 (modal + agenda multi-dia): campos de fim no modal, escolha inline "manter intervalo / definir novo fim", testes de rótulo multi-dia (dia-grid) e payload multi-dia (check-conflict/relocation). vitest web completo verde.
- 2026-10-11 — Etapa 3 (correções de review dos gates): `Input.vue` precisou de `modelValue` como PROP declarada (com `:model-value` o valor caía em attrs e o `useAttrs` não fica reativo a trocas — campos nasciam vazios); ligação dos 4 campos de horário por listener nativo `@change` (fiel ao comportamento original de date/time); testes C de Semana ajustados ao bucketing por dia de início vigente (schedule-core intocado — o segmento nasce na coluna do início e carrega `formatRangeInTz` com o dia do fim).
- 2026-10-11 — Etapa 4: gotcha 24 adicionado; spec marcada `implementada`; gates da raiz VERDES (build, test completo, lint 0 erros, lint:arch). `sync:ia` executado.
