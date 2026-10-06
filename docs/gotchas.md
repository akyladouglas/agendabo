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
