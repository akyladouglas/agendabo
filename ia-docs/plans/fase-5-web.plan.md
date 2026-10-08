# Plano — Fase 5: visão web completa (agenda, revisão, perfil — responsiva)

- Data: 2026-10-07 (v2: 2026-10-08) | Status: **concluída** (etapas 1–13 feitas; gates verdes; aguarda review/commit do humano)
- Spec: `.ia/specs/web/calendario-perfil-revisao-web.spec.md` (aprovada, 10 decisões) | Fase do roadmap: 5
- Orquestrador: feature-orchestrator | v2
- **Referência visual**: protótipo OpenDesign (11 imagens, 2026-10-08) — telas + viewports + design tokens; decisão 10 da spec: vinculativo p/ visual, spec manda no comportamento

Fechar a visão web do Agendabô: **agenda** (abas Dia|Semana no fuso do usuário,
criar/editar/excluir com conflito decidido pela API, editor de regras de lembrete),
**revisão** (fila `needs_review` com fala original, aprovar 1-clique, corrigir,
descartar) e **perfil** (timezone, hora do resumo, ligar/desligar resumo) — tudo
**responsivo** (360/768/≥1280) incluindo as páginas de auth existentes.

## 2. Análise de profundidade (inspecionado pela spec)

- `apps/web`: rotas `/agenda` e `/revisao` são **placeholders** (14 linhas cada);
  auth/layout/`qk`/authStore (`timezone`+`resumoDiarioHora`) prontos; **nenhum**
  composable de appointments/review, nenhum editor de regras, nenhuma tela de perfil.
- API pronta e testada: appointments (list/create/PATCH 409/DELETE/check-conflict com
  `ignoreId`), review (GET/confirm/dismiss). **`PATCH /me` NÃO existe** — a fase cria
  (contracts `api/user.ts` novo). `users.module.ts` é um esqueleto com TODO.
- `appointmentInputSchema.notificationRules` + materialização de outbox no
  create/update (Fase 3) ⇒ editor de lembretes é **só UI**.
- Prisma: adicionar `resumoDiarioAtivo` (boolean default true) = migração trivial;
  guarda em `DigestSchedulingService` (1 `if`).
- `schedule-core`: `userDayRange`/`userWeekRange`/`userNextWeekRange`/`shiftDayRange`
  prontos; falta `shiftWeekRange` (pura, TDD) para navegar semanas.
- Responsivo hoje: header não quebra em 360px — páginas de auth entram no checklist.

## 3. Decisões

| #   | Decisão                                                                              | Alternativa descartada | Por quê                                                                |
| --- | ------------------------------------------------------------------------------------ | ---------------------- | ---------------------------------------------------------------------- |
| D1  | Abas Dia+Semana (mês/ano depois)                                                     | grade mês inteira      | mês é o item mais caro e menos usado; dia+semana reusa helpers prontos |
| D2  | Semana = lista compacta por dia                                                      | grade horária 0–24     | responsivo trivial, zero overpositioning                               |
| D3  | Header ≥md + gaveta hambúrguer <md                                                   | sidebar/bottom-nav     | header já existe; gaveta é radix Dialog com foco                       |
| D4  | `useAppointmentForm` único (criar/editar/corrigir-revisão) em modal/bottom-sheet     | 3 formulários          | um zod, um fluxo, aprovar-com-correção = confirm                       |
| D5  | **Web avisa gatilho retroativo** (toast) — decisão humana #3                         | silencioso (Fase 3)    | alinha com bot; exige ADR de substituição                              |
| D6  | skeleton + toast + bloco de erro com retry                                           | spinners soltos        | padrão vue.md #8                                                       |
| D7  | `<input date/time>` nativos + zod                                                    | libs datepicker        | zero dependência, UX nativa mobile                                     |
| D8  | Responsivo = checklist manual 3 viewports assinado no PR + testes estruturais vitest | snapshot de pixels     | happy-dom não mede layout; comportamento sim                           |
| D9  | `PATCH /me` em `modules/users` (controller fino + zod)                               | espalhar em auth       | users.module já existe como dono do território                         |

## 4. Etapas (v2)

| #   | Etapa                                                                                                                                                                                                                                                                                                                                                                                                          | Worker                                                                                                                                               | Status              | Saída (condição de pronta)                                                                                                                                                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | contracts: `api/user.ts` (`updateProfileInputSchema`: name/timezone/hour/`resumoDiarioAtivo`) + `signupInputSchema.name` + `loginResult.user.name`/`resumoDiarioAtivo`/`name`; testes                                                                                                                                                                                                                          | feature-builder                                                                                                                                      | feita               | build+test ok (39 testes contracts)                                                                                                                                                                                                                                                             |
| 2   | api: migração Prisma única **`name` + `resumoDiarioAtivo`** + `PATCH /me` (users controller fino→service) + signup aceita name + guarda no DigestScheduling + teste "desligado não agenda"                                                                                                                                                                                                                     | feature-builder                                                                                                                                      | feita               | jest 119 + vitest 101 verdes; migração aplicada local e comitável                                                                                                                                                                                                                               |
| 3   | bot: `messages.ts`/resumo usam `name` quando existir ("Bom dia, Ana"); fallback sem nome = texto vigente; testes                                                                                                                                                                                                                                                                                               | bot-flow-builder                                                                                                                                     | feita               | saudação só na abertura do fluxo ("Oi, Ana! Bora marcar!"); resumo: helpers `greetingPtBr` + testes — pendência: ligar `greeting` no dispatch.service (revertido p/ build verde; ver log)                                                                                                       |
| 4   | schedule-core: `shiftWeekRange` pura + TDD (cruza mês/ano, now/offset por parâmetro)                                                                                                                                                                                                                                                                                                                           | feature-builder                                                                                                                                      | feita               | vitest 78 verdes                                                                                                                                                                                                                                                                                |
| 5   | web base VISUAL: design tokens do protótipo (CSS vars, tema escuro default + toggle claro persistido, Space Grotesk, raios/ espaçamentos/movimento `prefers-reduced-motion`); `ui/` wrappers radix (Sheet, Tabs, Dialog bottom-sheet<md, Select, Switch, Skeleton, Badge, Dropdown, Textarea) com alvos ≥44px; `AppLayout` header (`Nome · e-mail` + badge Revisão + toggle tema) + gaveta <md; rota `/perfil` | feature-builder                                                                                                                                      | feita com ressalvas | wrappers + layout + tokens prontos; testes estruturais `AppNav`/toggle ficam na etapa 12                                                                                                                                                                                                        |
| 6   | web auth redesign: login / **cadastro com nome + telegramId + tutorial @userinfobot** / confirmação (código 6 dígitos) no visual do protótipo + zod                                                                                                                                                                                                                                                            | feature-builder                                                                                                                                      | feita               | zod dos contracts (signup estende só `confirmPassword`); tutorial @userinfobot; código 6 quadradinhos + paste + quota 429; vue-tsc limpo                                                                                                                                                        |
| 7   | web agenda: queries/mutations, abas Dia                                                                                                                                                                                                                                                                                                                                                                        | Semana (`userDayRange`/`userWeekRange`/`shiftWeekRange`), badge `pendente de revisão`, chips origem `via bot`/`via web`, estados skeleton/erro/vazio | feature-builder     | feita                                                                                                                                                                                                                                                                                           | linha com hora/range, badge warning + borda esquerda warning, chip origem, esmaecido p/ passados, skeleton/erro+retry/vazio; ← hoje → por `shiftDayRange`/`shiftWeekRange`; testes de composable com `now` fixo na etapa 12 |
| 8   | web `useAppointmentForm`: modal/bottom-sheet compartilhado (criar/editar/corrigir), check-conflict com `ignoreId`, 409→erro inline, editor de regras de lembrete (chips), toast de gatilho retroativo (D5)                                                                                                                                                                                                     | feature-builder                                                                                                                                      | feita               | `computeAllTriggers` nova no schedule-core (TDD, 80 verdes) p/ contar gatilhos passados sem duplicar regra; contracts: `appointmentSchema.notificationRules` opcional; detalhes+excluir 2-passos na agenda; saudação do resumo LIGADA no dispatch (119 jest verdes); testes do form na etapa 12 |
| 9   | web revisão: fila com card (título+quando, citação `rawText`, motivo `reviewReason`), aprovar 1-clique, corrigir (modal), descartar 2-passos, contador, vazio "Nada para conferir ✅"                                                                                                                                                                                                                          | feature-builder                                                                                                                                      | feita               | mais-recente-primeiro, badge contador, skeleton/erro/vazio; testes na etapa 12                                                                                                                                                                                                                  |
| 10  | web perfil: Nome + fuso IANA + switch resumo + **hora condicional (só com resumo ligado)** → `PATCH /me` → authStore                                                                                                                                                                                                                                                                                           | feature-builder                                                                                                                                      | feita               | select IANA comum, hora condicionada ao switch, 409→erro inline, toggle de tema no perfil, `dirty` gateia salvar; testes na etapa 12                                                                                                                                                            |
| 11  | responsivo: checklist nos 3 viewports em TODAS as páginas (auth incluídas); corrigir achados (header 360px etc.)                                                                                                                                                                                                                                                                                               | feature-builder                                                                                                                                      | **feita**           | checklist assinado no relatório — `​.ia/tmp/responsive-check.cjs​`: 24/24 linhas (8 telas × 360/768/1280) com `scrollWidth−clientWidth = 0`                                                                                                                                                     |
| 12  | testes mínimos (Gherkin da spec) + mapa critério→teste                                                                                                                                                                                                                                                                                                                                                         | test-writer                                                                                                                                          | **feita**           | `pnpm test` verde: web vitest 41 (tz/sorting/appointment-form/theme/app-nav/login-page) + api jest 119 + api vitest 101 + contracts 39 + schedule-core 80; mapa no relatório final                                                                                                              |
| 13  | gate + docs: **ADR novo** (web avisa gatilho retroativo — substitui Fase 3 #1) + README; `architecture-overview` (rotas web, PATCH /me, nome/tema); `cenarios-do-bot.md` se o nome mudar texto visível no chat; plano v2 fechada; sync:ia                                                                                                                                                                      | code-reviewer                                                                                                                                        | **feita**           | 4 gates verdes (build/test/lint 0E0W/lint:arch); ADR-011 aceito pelo humano; overview com seção Web (Fase 5)+PATCH /me+ADR-011; gotcha 7 (vee-validate multi-cópia); cenarios-do-bot com nota da saudação; sync:ia rodado                                                                       |

Status: pendente | em execução | feita | bloqueada | feita com ressalvas

## 5. Próxima ação

Humano: revisar o diff (nada comitado — working tree) e propor commit convencional.
Pendências de ambiente dev: linhas de seed em `checklist.fase5@test.dev` (7 compromissos
out/2026 + linha needs_review), scripts Playwright em `.ia/tmp/`.

## 6. Riscos

- **Volume de UI**: 3 telas + base de componentes — maior fase em arquivos até hoje;
  mitigar mantendo componentes burros e o form único (D4).
- **Responsivo é requisito, não enfeite**: checklist (etapa 9) é portão de saída, não
  opcional; registrar desvios como ressalva explícita.
- **Toast de gatilho retroativo** depende de a API informar o que foi descartado: se o
  response do create/update não trouxer isso, o form calcula localmente `firesAt` no
  passado via schedule-core (regra é pura, permitida) — decidir na etapa 6 sem duplicar
  regra de materialização.
- **Migração Prisma** nova (flag): aplicar local e comitar; lembrar do padrão do índice
  parcial (regerar em ambiente limpo).

## 7. Log

- 2026-10-07 — spec aprovada (6 decisões; D5 inverte Fase 3 ⇒ ADR novo). Plano v1
  escrito; aguardando aprovação (não implementar antes).
- 2026-10-08 — etapas 1–6 feitas (contratos, api+migração, bot nome, `shiftWeekRange`,
  base visual web, auth redesign). Ressalvas: (a) saudação do resumo (`greetingPtBr`)
  com testes escritos mas **não ligada** no `dispatch.service` (ligar + rodar jest na
  etapa 13); (b) testes estruturais AppNav/toggle-tema movidos para a etapa 12.
  Web: rotas de auth apontam para `/login` (existente), páginas usam `/cadastro`.
- 2026-10-08 — protótipo OpenDesign (11 imagens) revisado com o humano: aprovado com
  adições → decisões 7–10 da spec (nome do usuário; telegramId no cadastro + tutorial
  @userinfobot — a API já exige, a tela não existia; tema escuro default + toggle;
  protótipo vinculativo p/ visual). Perfil: hora do resumo só aparece com o resumo
  ligado. Plano v2 (13 etapas: + bot usa nome, + redesign auth, migração única).
  Humano aprovou implementação.

- 2026-10-08 — etapas 7–10 feitas (agenda, modal/form único+regras, revisão,
  perfil); saudação do resumo LIGADA no dispatch.service (ressalva (a) quitada; jest 119
  verdes); ADR-011 escrito e aceito; termos "Choque" → "Conflito" na UI/API.
- 2026-10-08 — saga vee-validate (bloqueador enterrado): vite dev E vitest servem
  `vee-validate` em cópias múltiplas → `validationSchema` não vê o form, `field.value` devolve Ref
  aninhado, template não faz unwrap. dedupe/alias/pin NÃO resolvem (probe de várias rounds).
  Fix adotado como arquitetura (gotcha 7 em `docs/gotchas.md`): `useForm({ validate })` com
  zod dos contracts + `achata()` + bindings `:model-value`/`@update:model-value` + `Input.vue`
  sincroniza nó DOM e repassa `onUpdate:modelValue`; rede de segurança revalida no submit
  (LoginPage usa `<p role=alert>` por campo; SignupPage mostra banner consolidado porque os
  computeds `errorMessage` da cópia da página não veem o form da outra cópia). E2E browser
  confirmado: login → agenda → revisão aprovar → perfil; cadastro 201 → /confirmar.
- 2026-10-08 — proxy dev `/api` com rewrite → '' (API não tem prefixo global; antes 404).
- 2026-10-08 — etapa 11: checklist responsivo automatizado (Playwright, `scrollWidth−clientWidth`)
  24/24 telas×viewports overflow 0 — `.ia/tmp/responsive-check.cjs`. Mojibake: árvore 100% limpa
  (scan `.ia/tmp/scan-mojibake-all.cjs`; fixes via scripts .cjs, nunca PowerShell com acento).
- 2026-10-08 — etapa 13: gates `pnpm build && pnpm test && pnpm lint && pnpm lint:arch` todos
  verdes (lint 0 erros 0 warnings; eslint .vue ganhou `no-unused-vars` com `ignoreRestSiblings`);
  docs fechadas (overview seção Web Fase 5 + PATCH /me + ADR-011; gotcha 7; cenarios-do-bot
  nota da saudação com nome). Plano fechado.

## 8. Protótipo (referência visual)

O humano trouxe 11 imagens do OpenDesign (2026-10-08): login, cadastro, confirmação,
agenda, perfil, revisão, viewports (360/768/≥1280), preview mobile e design tokens
(2). **As imagens não estão versionadas no repo** — ficam na conversa; o resumo dos
tokens/medidas vive na spec (regra 16c). Salvar em `ia-docs/design/` é opcional e é
coisa do humano (ele pode adicionar depois).
