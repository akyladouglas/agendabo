# Regra — `schedule-core` é domínio puro

**Escopo:** `packages/schedule-core`. A regra mais dura do projeto; é onde mora o valor
do produto (conflito e notificação não podem ter bug).

1. **Zero I/O, zero framework**: sem Nest, sem Prisma, sem BullMQ, sem `fs`/`net`, sem
   `fetch`, sem dependência de `@agendabo/contracts` (domínio independente; quem integra
   mapeia formas).
2. **Determinístico e total**: mesma entrada ⇒ mesma saída. Tempo entra **sempre** por
   parâmetro (`now`), nunca `new Date()` dentro da lógica. Funções não lançam para fluxo
   normal (retornam resultado discriminado); lançam só para entrada impossível (ex.:
   `before_hours: 0`).
3. **Intervalos half-open** `[startsAt, endsAt)`: encostado (fim == início) **não** é
   conflito. Isso está certo e não muda sem ADR.
4. **Datas em UTC** no domínio; timezone do usuário é aplicado **na borda** (bot/web)
   usando os helpers de `dates.ts` com offset injetável (o domínio não carrega tz database).
5. **Regra de decisão do LLM (ADR-003)**: nada aqui consulta ou depende de LLM. O LLM
   produz um candidato de compromisso; `schedule-core` decide o conflito. Ponto.
6. **Testes** (regra de testing.md): todo comportamento novo nasce com teste
   (conflito: mesma hora, sobreposição parcial, encostado, passado, ignoreId; notificação:
   24h, N dias, 3-2-1, combinação, dedupe, descartes no passado; datas: roundtrips com
   offset). Branch novo sem teste = reprovação.
7. Build **CommonJS** (`tsc -b`) porque o Nest consome sem bundler; a web consome o fonte
   via alias (ADR-005).
8. ESLint (`eslint.config.js` do package) trava imports proibidos — não "contorne" com
   disable; se precisar de algo novo, discuta e atualize esta regra via ADR.
