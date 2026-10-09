# 0016 — GlitchTip SaaS como error tracker (SDK Sentry, DSN trocável, PII = só userId)

- Status: Aceito
- Data: 2026-10-09
- Contexto da fase: Fase 9 "Observabilidade" (erros/perf da plataforma na API,
  worker, bot e web)
- Relacionado: ADR-0009 (worker/bot são processos próprios ⇒ init por processo),
  ADR-0001 (monolito modular ⇒ um módulo consumidor de telemetria), ADR-0002
  (UTC — irrelevante aqui, mas as events carimbam `createdAt` do fornecedor)
- Spec: `.ia/specs/observabilidade/observabilidade.spec.md` (seção A; D1/D5)

## Contexto

O roadmap pede Sentry "(ou similar)" na API, worker e web, com DSN em `.env` e
**sem dados pessoais na stack**. O Sentry SaaS cobra por evento e o humano não
quer pagar; as rotas gratuitas reais são: (a) tier grátis do próprio Sentry
(~1k eventos/mês, 1 usuário); (b) **GlitchTip** — reimplementação open-source do
protocolo do Sentry, com SaaS grátis (~5k eventos/mês, usuários ilimitados) e
opção self-hosted leve (~4 containers, 512 MB de RAM); (c) Sentry self-hosted —
**pesada demais** para o porte do projeto (stack com Kafka/ClickHouse/snuba,
dezenas de containers, ~16 GB de RAM) e descartada sem pena; (d) OTel puro +
backend (infra que o projeto não precisa agora).

O fato técnico que destrava a decisão: **os SDKs `@sentry/*` falam o protocolo
aberto do Sentry, e o GlitchTip o implementa**. O código de instrumentação é o
mesmo; o que muda de fornecedor para fornecedor é **apenas o DSN** (a URL).
Escolher fornecedor vira decisão de `.env`, não de código.

Segunda questão não-óbvia: **o que a event pode carregar**. O humano quer que o
painel seja rico **para o admin** (agrupar erros por conta) mas o cliente nunca
acessa o tracker. Colocar e-mail/telegramId crus num SaaS externo significa:
LGPD (dado pessoal em operador externo, com direito de exclusão que o tracker
não honra de forma confiável) e contradição direta com o requisito "sem dados
pessoais na stack". Hash não resolve integralmente (pseudonimizado ainda é dado
pessoal e é reversível por dicionário contra um espaço pequeno como
telegramId).

## Decisão

- **GlitchTip SaaS** (tier grátis) como destino do DSN nesta fase. A
  instrumentação usa os SDKs `@sentry/*` (`@sentry/nestjs` na API, `@sentry/node`
  no worker e no processo do bot, browser SDK + `@sentry/vite-plugin` na web) —
  **um init por processo** (ADR-0009), com `SENTRY_DSN` **opcional** no zod de
  `env.validation.ts`: sem DSN, o processo liga sem tracker (testes/dev sem
  rede). Migrar de fornecedor (Sentry SaaS, GlitchTip self-hosted, Bugsink) =
  **trocar o DSN**.
- **Identidade na event: SOMENTE `userId`** (id interno opaco do Postgres, via
  scope/`setUser` quando autenticado). E-mail, `telegramId` e qualquer conteúdo
  (fala, título, nota, payload de agenda) **nunca** vão ao tracker — nem crus,
  nem hasheados. O `beforeSend` é o gate: derruba corpo/cookies/headers de auth
  e esses campos mesmo que um caller tente anexá-los (invariante testada, não
  promessa).
- **Assimetria de papéis**: o tracker é ferramenta do **admin** (que pode cruzar
  `userId` no Postgres para chegar à identidade quando investigar). O
  **cliente/usuário final nunca vê o tracker**; a única janela dele são os
  próprios eventos via `/bot-events` (rollout da spec, B5/B6).
- **Tracing de performance desligado por default** (`SENTRY_TRACES_SAMPLE_RATE
= 0`); ligar na produção é mudar 1 env, sem deploy de código.

## Consequências

- Zero custo fixo; o limite de ~5k eventos/mês do tier grátis é holgado na
  escala atual (mono-usuário/pequeno) e, se um dia apertar, as rotas são
  known: pagar, self-hosted (mesmo SDK) ou `maxEvents`/sample menor.
- Erros com `userId` dão ao admin o agrupamento por conta sem dar identidade a
  terceiros; a investigação profunda (quem é esse userId?) acontece no Postgres,
  sob o nosso controle de retenção.
- O scrub é código nosso com teste (`beforeSend` com seed) — portável: vale
  igual para qualquer destino futuro do DSN.
- Renúncia aceita: sem session replay (proibido de propósito — gravaria dados de
  agenda na tela), sem APM completo, sem alertas sofisticados do Sentry SaaS. O
  GlitchTip cobre erros, releases, uptime e transações básicas — suficiente.
- Trocar de fornecedor depois **não** reescreve código nem eventos históricos
  (o histórico fica onde foi enviado — nota operacional para migração futura).
- Reversão (ex.: e-mail no tracker) exigiria ADR novo e avaliação LGPD —
  premissa desta decisão.
