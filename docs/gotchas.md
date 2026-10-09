# Gotchas do Agendabô

Armadiilhas reais ja encontradas (aqui ou no projeto-irmao `financas`, do qual este
repo herda a base tecnica). Formato: problema -> fix aplicado -> o que fazer de novo.

## 1. `tsc --incremental` + `deleteOutDir` do Nest = `dist/` quebrado

**Problema:** com `"incremental": true`, o Nest CLI apaga `dist/` mas o `.tsbuildinfo`
sobrevive e diz ao tsc que nada mudou; o proximo build gera um `dist/` incompleto.
**Fix aplicado:** `"incremental": false` explicito em `apps/api/tsconfig.json`.
**Se acontecer de novo:** apague `dist/` e o `*.tsbuildinfo` e rode `nest build` de novo.

## 2. Ordem dos `useGlobalFilters` e `useGlobalInterceptors` e invertida

**Problema:** no Nest, o ultimo filtro global registrado roda por ultimo na pilha —
um catch-all registrado por ultimo engole os especificos.
**Fix aplicado:** em `main.ts`, registrar o catch-all **primeiro** e os especificos depois.
**Se acontecer de novo:** teste enviando um erro conhecido e confira o payload.

## 3. Aliases do Vite para os packages precisam ficar sincronizados com o tsconfig da web

**Problema:** os packages constroem CJS para o Nest; a web consome o **fonte `.ts`**
via alias do Vite (`@agendabo/contracts -> ../../packages/contracts/src/index.ts`) para
evitar CJS no browser. Se so um dos lados for atualizado, o typecheck passa e o build
quebra (ou vice-versa).
**Fix aplicado:** alias em `vite.config.ts` + `paths` em `apps/web/tsconfig.json` com
comentario cruzado nos dois arquivos.
**Se acontecer de novo:** confira os dois arquivos juntos.

## 4. Zod rejeita campos extras por padrao em `strict()` — respostas do LLM variam

**Problema:** validar saida do LLM com `.strict()` faz qualquer campo a mais derrubar o
parse e mandar para `needs_review` sem necessidade.
**Fix aplicado:** `strip` padrao (nao usar `.strict()`) nos schemas de saida do LLM em
`packages/contracts/src/llm/`; confianca baixa e parse falho continuam indo para revisao.

## 5. Telegram `getUpdates` conflita com webhook/outra instancia

**Problema:** duas instancias consumindo long-polling do mesmo bot causem `409 Conflict`.
**Fix aplicado:** o bot roda num unico processo (dev: script `dev:bot`); antes de subir,
`deleteWebhook` e chamado no boot.
**Se acontecer de novo:** confira se nao ha outro processo/instancia com o mesmo token.

## 6. Telegram: `text` HTML com < & > derruba o sendMessage (bot fica mudo)

**Problema:** o `TelegramClientService.sendMessage` envia com `parse_mode: HTML`, mas
o bot repete texto digitado pelo usuario (titulo, notas) nas mensagens; um titulo tipo
`Nota <10>` faz a API devolver 400 e a resposta do fluxo nunca chega.
**Fix aplicado:** `escapeHtml()` em `modules/bot/messages.ts` aplicado as replies
em `scheduling-flow.service.send()` (`HTML` e so em rotulos controlados).
**Se acontecer de novo:** escape todo texto de usuario antes de mandar com parse_mode.

## 7. Vite serve vee-validate em copias multiplas no dev (forms Vue)

**Problema:** no dev server, a pagina importa 'vee-validate' direto e @vee-validate/zod usa
outra copia otimizada; `useField().value` devolve um Ref aninhado de outro runtime de
reatividade, o template nunca faz unwrap, e o `validationSchema` valida um form sem
registro e devolve {} no submit. Acontece no dev E no vitest; dedupe/alias/pin
(`resolve.dedupe`, `optimizeDeps.include`, versao exata no package.json) NAO resolvem.
**Fix aplicado:** pages de form usam `useForm({ validate })` (zod safeParse -> map de
erros) em vez de `validationSchema`; helper `achata()` achata Refs aninhados; bindings
`:model-value` + `@update:model-value` (nunca v-model); `Input.vue` sincroniza o no DOM
e repassa onInput; rede de seguranca re-valida com o zod dos contracts no onSubmit.
**Se acontecer de novo:** nao tente 'consertar' o dedupe; siga o padrao de LoginPage.vue.

## 8. Preencher campo por programa (rascunho) precisa de `initial`, nao de `setValue`

**Problema:** represencar um form por programa (ex.: "Voltar para o cadastro" do
ConfirmPage) com `useField().setValue()` ANTES da montagem nao chega ao DOM — em DEV
a copia do form que executa o setup e outra que o template observa, e o `local` do
`AppInput` (rede de seguranca do gotcha 7) nasce vazio e vence o display.
**Fix aplicado:** `AppInput` ganha prop `initial` (semente do `local` via
`watch(immediate)` — lint-clean com vue/no-setup-props); a pagina guarda o rascunho
em `sessionStorage` (router/index.ts) e passa `:initial` + `setValue` no form.
**Se acontecer de novo:** o valor programado TEM que chegar no AppInput direto; nunca
dependa do vee-validate ecoar `setValue` para o template.

## 9. kebab-case de prop que NAO existe vira attr silencioso (modal do calendário)

**Problema:** a página passou `:prestart-date` para `AppointmentModal`, cuja prop é
`presetDate`. Vue não reclama: `prestart-date` cai em `attrs` e a prop fica
`undefined` — o modal abriu com a data de HOJE em vez da célula clicada, e o
`v-if` + portal mascaram a origem (o vnode mostra o valor certo, o props proxy não).
**Fix aplicado:** binding corrigido para `:preset-date`.
**Se acontecer de novo:** desconfiança nº 1 quando uma prop "chega undefined" —
compare o nome do binding com `defineProps` (e o `declared=` do runtime). Não
"invente" nomes de prop novos sem editar o componente.

## 10. happy-dom + Vue: fragmento de `v-if` com irmãos `<template>` órfão trava o update

**Problema:** numa cadeia `v-if/v-else-if` de um bloco, branches `<template v-if>`
que contêm elementos e um irmão cujo conteúdo some por remontagem (portal radix)
deixam o âncora de um fragmento órfão no happy-dom; o update
seguinte morre em `removeFragment` (`nextSibling` de nó órfão é `null` e o
happy-dom NÃO lança NotFoundError no `removeChild` como o DOM real) e a UI congela
em teste no estado anterior. Reproduz só em happy-dom (browser não tem o caso).
**Fix aplicado:** (a) corpo da AgendaPage = UM ELEMENTO por branch (nada de
`<template>` no meio da cadeia; `v-if` de texto vazio nunca é irmão); (b) o
`<template v-if>` de irmãos `<label>+<select>` do jump-month virou `<div>`;
(c) nos testes, radix `FocusScope`/`FocusGuards` stubbados (o `focusin` assíncrono
do DismissableLayer roda com `activeElement` null entre testes e vira rejection que
faz o vitest fechar com código 1) e `unmount()` explícito no `afterEach`.
**Se acontecer de novo:** stack com `removeFragment` + `nextSibling` null em teste =
procurar FRAGMENTO (template/v-if de texto/v-for com `v-if` interno) ADJACENTE a
portal/componente remontado, não o portal em si. Traçar com throw dentro de
`removeFragment` (cur/end e parentesco) identifica o nó em 1 rodada.

## 11. Bolinha de densidade pintada em dia SEM compromisso (mini-calendario do Ano)

`dotClass` do `YearGrid` nao considerava `hasAppointment`: como todo dia do mes
tem `date` na grade 7 colunas (o pad `date?` so existe em leading/trailing), a
classe `bg-primary/70` caia em **todos** os dias e o mini-mes parecia lotado
quando havia 1 compromisso. Teste nenhum pegava (`daysWithAppointments` no
aria-label estava certo — a bug era so visual).
**Se acontecer de novo:** qualquer classe derivada que pinte `v-for` de grade
precisa do caso explicito `!hasAppointment -> bg-transparent`; e smoke visual
real (olhar o DOM renderizado, nao so o estado) e o que pega esse tipo de bug.

## 12. `isEmpty` global engolia a grade do Mes/Ano (nao dava p/ criar em mes vazio)

O ramo `bodyKind` compartilhava `isEmpty` (items.length === 0) com Dia/Semana:
num mes/ano sem compromissos a grade inteira sumia atras de "Nada neste mes." —
e a grade vazia e justamente o alvo de clique para CRIAR compromisso (spec B.7).
A propria spec era contraditoria (R.15 pedia texto no lugar da grade; B.7 pedia a
grade sempre). Corrigido: Mês/Ano sempre renderizam grade + aviso discreto
`role=status` acima; texto puro so em Dia/Semana.
**Se acontecer de novo:** estado de "vazio" e por visao, nao global — perguntar
sempre "o usuario consegue criar um item a partir desta tela vazia?"

## 13. Cookie de refresh com `Path=/auth` + proxy do vite = F5 deslogado

O cookie `agendabo_refresh` era gravado com `Path=/auth`. Em dev a web fala com a
API pelo proxy do vite (`/api/auth/...`), e o navegador scopa o cookie pelo caminho
que ELE viu: `Path=/auth` nao cobre `/api/auth/*` => o F5 mandava `refresh` SEM o
cookie, recebia 401 e caia no login. O teste manual `curl`/`fetch` no node NAO pega
(sao requests sem jar de navegador), so o browser real reproduz.
**Correcao:** `path: '/'` no `REFRESH_COOKIE_OPTS` (rotas de refresh sao publicas e
o token e opaco de uso unico — escopo raiz nao amplia ataque).
**Se acontecer de novo:** qualquer bug "loga e nao mantem sessao" = inspecionar o
`Set-Cookie` (Path/Domain/SameSite) contra o caminho REAL que o browser chama
(vite proxy reescreve: o browser ve `/api/...`, a API ve `/...`).

## 14. radix-vue: props/eventos proprios dos primitivos NAO sao `modelValue` (switch mudo + check fantasma)

Dois bugs visuais do perfil com a mesma raiz — chamar o primitivo radix com a API
"genérica" errada:

- `SwitchRoot` expoe `checked`/`update:checked` (NÃO model-value). Com
  `:model-value` o valor virava ATRIBUTO HTML (`modelvalue="true"`) e o switch
  ficava SEMPRE visualmente desligado — e o `v-if` da hora do resumo nunca
  reagia (o evento emitido era `update:checked`, o listener nunca chamava).
- `SelectItem` renderiza SO o slot `default`; um `<template #indicator>` e
  engolido em silencio (o check sumia do item selecionado). O `SelectItemIndicator`
  vai dentro do default, absolute p/ esquerda, e o rotulo em `SelectItemText`
  (typeahead le so ele — Check dentro do SelectItemText "comia" o lugar do texto).
  **Se acontecer de novo:** componente UI wrapper de primitivo radix = abrir o
  `*.d.ts`/docs do radix-vue e conferir o nome EXATO de props/emits/slots; teste
  de render deve assentar no ESTADO visivel (`aria-checked`/svg presente), nunca
  so no modelo.

## 15. Erro de dominio novo precisa de handler no controller (ou vira 500)

O smoke E2E da Fase 8 (Etapa 0) pegou `POST /appointments/relocation-options`
devolvendo **500** no ramo `blocked` (2+ conflitos): o service lancava
`AppointmentConflictError` mas so o create/reschedule tinham o try/catch que o
converte em 409 `{message, conflictWith}`. O mesmo valia para o `PATCH :id`
(o update lancava ConflictError sem handler e a web so tratava 409 de POST).
**Correcao:** extrair `conflict409()` no controller e envolver as QUATRO rotas
de escrita que podem conflitar (create, update, reschedule, relocation-options).
**Se acontecer de novo:** erro de dominio novo = testar a ROTAS (controller), nao
so o service; teste de service verde nao prova o HTTP. Corpo 409 canonico =
`{message, conflictWith}` (o `conflict.utils.ts` da web le exactly isso).

## 17. dev server servindo módulo transformado SEM o head (const de módulo vira ReferenceError)

A visão Dia da Etapa 1 abriu com `hourGrid` lançando `MINUTE is not defined` no
browser, com FONTE correta e testes vitest verdes. O transform do vite no dev
server serviu o arquivo sem as linhas de `const` do topo (cache `.vite` antigo
do pacote linkado após edição). `fetch` do módulo transformado na URL
`/@fs/...` mostrou o corpo sem o head.
**Correção na hora:** limpar `node_modules/.vite` (pacote + web) e recarregar.
**Se acontecer de novo:** ReferenceError de uma constante que EXISTE na fonte e
os testes passam = busque no browser o módulo transformado (fetch na URL /@fs/
ou DevTools Sources); nunca confie só no vitest pra confirmar o bundle do dev
server.
