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
`deleteWebhook` e chamado no boot. Em prod (Coolify): o modo webhook (`TELEGRAM_WEBHOOK_URL`)
e o padrao — o Telegram POSTa na API (rota `/telegram/webhook`, handler do BotGatewayService
via token `BOT_WEBHOOK_HANDLER`), o que elimina o long-polling e o 409 por completo e nao
depende de conexao longa de saida. Sem a env (dev), o polling roda so no binario `bot-main.js`.
A API HTTP nunca faz getUpdates, entao nunca ha dois consumidores.
**Se acontecer de novo:** confira se nao ha outro processo/instancia com o mesmo token, e
no prod confirme que `TELEGRAM_WEBHOOK_URL` esta definida (getWebhookInfo deve mostrar a url).

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

## 16. `Set-Content`/`Get-Content` do PowerShell corrompem UTF-8 do source (mojibake + BOM)

Reescrever `.vue`/`.ts` pelo PowerShell é armadilha dupla: `Set-Content -Encoding
utf8` escreve **com BOM**, e `Get-Content` lê UTF-8 como CP1252 quando não
especificado — os acentos viram mojibake (`só` → `sÃ³`, `em dash` → `_â€”`) e o
vitest para de casar as strings (`toContain('Nada neste mÃªs.')`). Aconteceu de
verdade no pacote de correções do review 2026-10-09 (AgendaPage.vue; recuperado com
`git checkout --` + reaplicação dos patches via edite). **Correção:** nunca round-trip
de source pelo PowerShell — use o tool de edite (ou `node` com `fs`); se corrompeu,
restaure do git e refaça o patch cirúrgico. (Corolário do mesmo dia: `pnpm exec <bin>`
da RAIZ não acha binário de `apps/*` — use `pnpm --filter <pkg> exec`.)

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

## 18. happy-dom: patch do watcher re-escreve `v-bind` por CIMA dos atributos imperativos do gesto

No drag (Etapa 2), mudar o `ref` do item em drag dispara o watcher da view NO
MESMO tick do harness: o patch re-aplica o `v-bind`/`:class` e **apaga** os
atributos que o hook tinha posto no nó (`data-dragging`, `touch-action`), e o
`dragging` lido via `defineExpose` chega como Ref cru (só refs de topo são
desembrulhadas). **Correção:** dirigir a classe da view por PRIMITIVO
(`draggingId: Ref<string|null>` — o patch só troca a string da classe) e, ao
abrir/mudar estado, reler o nó por id e re-aplicar a vestimenta imperativa
(pós-patch). **Se acontecer de novo:** atributo que o teste vê antes do
`nextTick` e some depois = culpado é o patch do watcher; atributo via
`el.style.x` não aparece no `getAttribute('style')` do happy-dom (use um
atributo-dados de trilha em teste). E o happy-dom NÃO sintetiza `click` de
`pointerup` — o harness despacha o `click` real como o browser faria.

## 19. radix Select no happy-dom: popper abre mas o DismissableLayer morre em `null.closest`

A troca do ir-para da agenda para AppSelect (radix) abriu esta caixa: o popper
CHEGA a montar no happy-dom (`role=listbox` + options), mas fechar a interacao
sem um blur limpo deixa o `focusin` do DismissableLayer com `event.target` null
quando o body e trocado no teste seguinte - o helper da lib faz
`target.closest(...)` SEM o guard que o @radix-ui/dom-utils tem e vira
rejeicao nao-tratada (vitest fecha com codigo 1 a despeito de tudo verde).
Setas do teclado tambem nao andam o highlight sem layout real (o
posicionamento do popper falha). **Correcao:** nao simular a interacao do
Select no unit-test - assert estrutural no gatilho (BUTTON + `aria-expanded` +
rotulo) e a funcionalidade no SMOKE E2E-browser (ir-para do Mes, verificado
2026-10-09). **Se acontecer de novo:** "Vitest caught N unhandled errors" +
stack `dismissableLayer` = popper/foco deixado aberto no teste anterior.

## 20. Fixture de data ABSOLUTA em teste com relógio real = teste-bomba

`findConflict`/`existingFor`/`ReviewService` ignoram compromisso **passado** e
usam o relógio real como `now` quando o caller não injeta. Um teste que monta o
"outro" compromisso com data literal (`2026-10-09T15:30:00Z`) vira uma bomba de
efeito retardado: ele PASSA hoje e FALHA em ~3 dias sem nenhum bug no código —
o fixture virou passado e a regra (corretamente) deixou de vê-lo como conflito.
Aconteceu duas vezes no gate de 2026-10-09: `review.service.spec` (confirm com
conflito) passou a falhar no `pnpm test` inteiro, e o mesmo padrão rondava os
specs de reschedule (que sobrevivem porque o mock da tx devolve linhas
independentes de filtro de tempo). **Correção:** em teste que toca relógio real,
derive as datas de `new Date()` (ex.: `base = hoje 12:00Z + 2 dias`); datas
literais só onde o `now` é injetado (as suítes com `svc.now = () => NOW`).

## 21. `$queryRaw` com uuid: `::uuid` explicito (ou a API quebra em runtime)

`tx.$queryRaw` manda string como `text`; o Postgres NAO tem operador
`uuid = text` — `WHERE "userId" = ${userId}` compila, roda no jest (mock) e quebra
SOMENTE em producao com `42883 operator does not exist`. Escreva `${userId}::uuid`
(de mesma forma, datas vao como `Date` e funcionam). Pegadinha dobrada: o teste
unitario mocka `$queryRaw` e nunca ve isso — o smoke do FOR UPDATE (review
2026-10-09) e que encontrou. **Correcao:** todo raw com coluna uuid/enum faz cast
explicito; sempre ha de haver ao menos um smoke contra o Postgres real tocando o
SQL cru.

## 22. SDK Sentry: `beforeSend` NAO ve anexos — e o `void promise.create()` pode derrubar o processo

Dois furos achados no review da Fase 9 (2026-10-09):

1. **Anexos do envelope**: `beforeSend` so ve o EVENTO; anexos (plugin pinia do
   @sentry/vue = estado dos stores com e-mail; `extraErrorData`/zod-anexos no
   node) viajam pelo envelope e contornariam o scrub inteiro. **Correcao:**
   `hint.attachments` zerado dentro do `scrubEvent` + produtores desligados na
   fonte (jamais registrar `createSentryPiniaPlugin`; os defaults do node/nestjs
   v11 nao incluem os integrations de anexo — verificar ao upgradar o SDK).
2. **`void prisma.x.create().catch()`**: se o `create` REJEITA de forma
   SINCRONA (input invalido, validacao local do Prisma), o `.catch` nunca roda e
   vira unhandled rejection — o OnUncaughtException do SDK derruba o processo
   por um LOG. **Correcao:** telemetria best-effort embrulha o DISPARO em
   try/catch, alem do `.catch`.

## 23. callback de botão reaproveitado como fala (loop do "personalizado")

**Problema:** o fallback genérico do `handleCallback` do fluxo roteava todo
clique não-decodificado por `handleText(telegramId, label)`. O botão
"personalizado" do teclado de lembrete não era atalho reconhecido ⇒ a palavra
solta virou FALA pro interpretador LLM, falhou na régua, e o passo re-perguntou
**sem contador** — loop de "não tenho certeza se entendi" até desistência
(incidente de produção 2026-10-10). Um clique de botão tem significado
estruturado; tratá-lo como texto livre paga LLM por botão e degrada o fluxo.
**Fix aplicado:** teclado de lembrete com `callback_data` estruturada
(`flow:lembrete:*` em `messages.ts` → `lembreteAtalhosCallback`), decodificada
no `handleCallback` direto no evento determinístico `reminderChoice` da máquina
(zero LLM); "personalizado" só responde o convite de texto livre e mantém o
passo; fallback residual restrito à whitelist `CALLBACK_TEXT_WHITELIST`
(sim/não/confirmar/alterar/remarcar/abortar — labels já roteáveis por fala e de
custo zero), qualquer outro label é logado e ignorado; e o portão da extração
livre nunca roda para origem `callback` (a flag `origin`/`fromCallback` fecha o
`openCreate`).
**Se acontecer de novo:** NUNCA roteie label de teclado por `handleText` —
botão com significado estruturado tem handler próprio (família de prefixo na
`callback_data`); label novo sem handler cai na whitelist ou é ignorado, jamais
vira fala.

## 24. negacao de cabeca engole frase (notas comecadas com "nao")

**Problema:** `parseNotesAnswer` reusava `parseYesNo`, que decide negativa por
PRIMEIRA PALAVRA. Em producao (2026-10-10), "nao tenho nada pra falar sobre"
(4+ palavras, nota literal do usuario) virou notes=null e a frase se perdeu;
o mesmo padrao no passo `notas` da maquina re-perguntava em vez de aceitar.
**Fix aplicado (spec notas-e-fim-na-web A):** `startsWithNegation` (exportada
em `messages.ts`) so decide negativa com < `NOTES_MIN_PHRASE_WORDS` (4)
palavras normalizadas; NO_WORDS multi-palavra ("agora nao") e comparado no texto
normalizado inteiro; desistencia (`givesUp`) continua negativa. O passo
`notas` da maquina tem o ramo ANTES do re-pergunte de ruido (1-3 caracteres),
senao "nao" puro virava re-pergunte em vez de notes=null -> lembrete.
`parseYesNo` esta blindado por testes (demais passos dependem da regra de
cabeca) -- NAO "conserta-lo" sem auditarem os call sites.
**Se acontecer de novo:** em qualquer passo de texto-livre, "comeca com nao" NAO
implica negativa; a borda entre negativa e conteudo e o NUMERO DE PALAVRAS, e a
regra mora num puro exportado com teste proprio, nunca inline no handler.

## 25. `list` continha, nao tocava (multi-dia invisivel em todas as visoes)

**Problema:** producao 2026-10-11: viagem 10/10 23:00 -> 12/10 17:00 (America/Sao_Paulo)
nao aparecia em Dia/Semana/Mes. A `list` da web filtrava por CONTENCAO
(`startsAt >= from AND endsAt <= to`): um item comecado ANTES do periodo comecado
ou terminando DEPOIS dele era sumido da carga — e as visoes so agrupavam pelo dia de
`startsAt` (`groupByLocalDay`), entao mesmo o dia 10 dependia do item caber inteiro
na query. As cargas de conflito (`existingFor`/`existingForInTx`/`existingConfirmedFuture`)
tinham o MESMO genero de buraco com `endsAt > now`: multi-dia comecado antes de `now`
nao era visto como obstaculo, e um candidato dentro dele passava sem conflito (o
pre-check do bot so pegava na gravacao, ou nada).
**Fix aplicado (spec web/multi-dia-nas-visoes):** `list` espelhou `listOverlapping`
(intersecao meia-aberta `startsAt < to AND endsAt >= from`); cargas de conflito
(`existingFor`/`existingForInTx` do service, `existingConfirmed` do review, e o
pre-check do bot) passaram a janela de INTERSECAO com o candidato expandido
`[min(now, cStart), max(cEnd, now+HORIZONTE))` — sem o corte de `endsAt` (a filtragem
fina e do `findConflict`, puro); web recorta por dia com `sliceItemToRange`/
`sliceTimelineItems` e agrupa por DIAS TOCADOS (`groupByLocalDayTouched`).
**Se acontecer de novo:** qualquer query de "o que aparece/choxa no periodo" usa
INTERSECAO meia-aberta, nunca contencao; e corte por `now` em carga de conflito so e
seguro se o par de condicoes for `startsAt < limite AND endsAt >= now` (o contrario
esconde quem comecou antes). O teste de WHERE (mock na fronteira) e obrigatorio nos
dois sentidos: tocando pela esquerda E pela direita do periodo.

## 26. refreshOnce sem dedupe por chamada = N rotacoes de cookie numa rajada de 401

**Problema:** spec sessao-24h (web): o refresh ROTACIONA o cookie no servidor
(delete+create). N queries que tomam 401 ao mesmo tempo chamavam `refreshOnce`
cada uma → N POSTs `/auth/refresh` concurrentes no MESMO cookie: a segunda
rotacao em diante ve hash ja revogado e MORRE a sessao (o teto de 24h nem
precisa chegar). Pior: sem propagar a falha, a web ficava "logada com token
morto" (o erro era engolido e as queries só repetiam o 401).
**Fix aplicado:** `refreshOnce` dedupa pela DURACAO DO POST (`inflightRefresh ??=`
com `finally` limpando) — N queries = 1 rotacao = 1 `sessionExpiredHandler`. O
dedupe NAO pode ser memoizado permanentemente: a promessa do bootstrap (sessao
morta no boot) reutilizada depois de um login novo refresha com o cookie
PRE-LOGIN e o login nao navega (gotcha herdado do financas — continua valido).
**Se acontecer de novo:** qualquer chamada que REVOLVER estado no servidor
(rotacao, one-time token, logout) precisa de dedupe com escopo = duracao da
chamada, nunca cache permanente nem ausente. E falha de sessao nunca e engolida:
propaga via handler registrado (inversao de dependencia: api.ts nao importa
pinia/router).

## 27. Parse de strip na query apaga campo extra do backend - a fonte da agenda pediu 403

**Problema:** bug da fonte compartilhada (spec B.12, web): o seletor de fonte montava
opcoes com `value: l.id` (id do VINCULO) e a query de compromissos mandava
`owner=<id do vinculo>` - a API espera o **ownerId** (uuid do DONO) e dava 403 sempre.
Ao corrigir, achado pior: o `queryFn` era `schema.parse(await api.list())` - o zod de
STRIP destroi campos extras do OBJETO PARSEADO, entao um `ownerId` que o backend mande
no payload fica INLEGIVEL para a pagina (o contrato e intocavel): a pagina nao tem como
ler o dono a partir do `data` ja validado.
**Fix aplicado:** o `queryFn` guarda o wrapper `{ data, raw }` no cache (MESMO fetch,
zero requests extras) - `data` = o contrato validado (shape de sempre), `rawData` = a
resposta crua de onde a pagina le `ownerId` (com fallback documentado para o shape
antigo: sem uuid do dono, usa-se o id do vinculo - nunca se inventa). Dimensoes
diferentes NUNCA se misturam: `sourceOwner` = valor do seletor = `owner=` da query =
dimensao de `qk.appointments(from, to, owner)` = o DONO.
**Se acontecer de novo:** quando a UI precisar de um campo que o contrato ainda nao
lista, o parse de strip NAO e a unica copia - ou o campo entra no contrato, ou o
`queryFn` preserva o cru junto (`{data, raw}`); e o valor que vai para query/cache tem
que ser a MESMA dimensao que a API espera na borda (testado com uuids diferentes de
proposito: dono != vinculo).
