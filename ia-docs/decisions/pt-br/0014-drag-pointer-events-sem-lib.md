# ADR-0014 — Drag-and-drop com Pointer Events próprios (sem lib nova)

- **Status:** Aceite
- **Data:** 2026-10-09
- **Contexto:** Fase 8, Etapa 2 (insumo do ADR-0015, que é da Etapa 0)

## Contexto

O drag-and-drop de compromissos (Fase 8, Etapa 2) precisa funcionar em **mouse
e toque** num único caminho, sem adicionar dependência ao bundle, e as opções
existentes não fecham o requisito:

- **radix-vue 1.19** não expõe nenhum composable de drag-and-drop;
- **HTML5 DnD API** (`draggable`/`dragstart`) simplesmente **não dispara eventos
  de toque** na maioria dos browsers mobile — obrigaria uma segunda
  implementação paralela para toque;
- bibliotecas dedicadas (dnd-kit, vuedraggable, interact.js) são peso novo no
  bundle e abstraem justamente a parte que o projeto quer controlar: o **hit-test
  determinístico da célula-alvo** e o **zero optimistic update** (a posição só
  muda quando o server confirmar — regra de produto da Etapa 2).

## Decisão

Implementar o drag com **Pointer Events nativos** num hook próprio
`useDragAppointment` (`apps/web/src/app/composables/useDragAppointment.ts`),
sem nenhuma biblioteca nova:

- `pointerdown` no bloco → `setPointerCapture`; movimento **acima de ~4px** vira
  drag (abaixo disso = clique normal → abre detalhes/edição — o caminho de
  acessibilidade continua sendo o modal);
- `touch-action: none` **somente no bloco arrastável** — o fundo da grade
  mantém o scroll da página;
- o arrasto é um **overlay fantasma** (`pointer-events-none`, clonado do bloco)
  que segue o ponteiro; o bloco original fica esmaecido no lugar;
- a célula-alvo é resolvida por hit-test via `data-cell-key` (registry das
  células de cada visão: Dia = `hour:<ISO-meia-noite-local-da-hora>`, Semana e
  Mês = `day:<YYYY-MM-DD>` — na Semana a COLUNA inteira é a célula, ajuste de
  hora por drop ficou no backlog) lido com `document.elementFromPoint` sob o
  ponteiro;
- `pointerup` **na célula de origem** = no-op; **fora de qualquer célula** ou
  **ESC** = cancela (fantasma some, bloco volta ao lugar, **zero pedido à API**);
- o novo intervalo é **sempre transladação determinística no `schedule-core`**
  (`dropTargetFromKey` + `dropTargetRange`): o drop diz só o deslocamento, a web nunca recalcula
  duração nem data; o payload do drop cai direto no fluxo da Etapa 0
  (`check-conflict` → `reschedule` transacional) — **sem optimistic update**.

## Consequências

- ✅ mouse + toque + caneta por um único caminho de código;
- ✅ zero dependência nova; o bundle cresce só o tamanho do hook (~150 linhas);
- ✅ o hit-test e o cancelamento ficam sob nosso controle e sob testes
  (vitest dispara PointerEvents reais no happy-dom);
- ➖ é código nosso para manter — por isso a superfície é pequena: o hook cuida
  APENAS da mecânica (threshold, capture, fantasma, alvo, cancelamento) e não
  conhece regra de agenda nenhuma (nem conflito, nem horário: recebe callbacks);
- ➖ acessibilidade por drag continua inexistente por natureza; o caminho
  equivalente teclado/leitores de tela é o modal de edição (clique no bloco),
  reforçado por `aria-live` no anúncio do reagendamento.
