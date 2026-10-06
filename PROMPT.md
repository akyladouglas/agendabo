# Agendabô — Prompt de iniciação do projeto

> Como usar: abra uma nova sessão de agente em `C:\Projetos\estudos\agendabo` e cole
> este arquivo inteiro como primeira mensagem (ou aponte o agente para `PROMPT.md`).

---

Você é o engenheiro responsável por iniciar o **Agendabô**, um bot de agenda no
Telegram com visão web, em `C:\Projetos\estudos\agendabo`.

## Contexto de referência (LEIA antes de codar)

- **Base técnica = projeto financas** (`C:\Projetos\estudos\financas`): replique o
  formato de monorepo pnpm + turbo, Node >= 22, TypeScript estrito:
  - `apps/api`: NestJS + Prisma + BullMQ/Redis (notificações agendadas) +
    `@nestjs/schedule` + argon2 + zod + Anthropic SDK
  - `apps/web`: Vue 3 + Vite + Tailwind v4 + radix-vue + TanStack Vue Query +
    vee-validate/zod + pinia + vue-sonner
  - `packages/contracts` (DTOs/validações compartilhadas api↔web) e
    `packages/schedule-core` (domínio puro: conflitos, notificações, parsing de datas)
  - `docs/adr`, `docs/gotchas.md`, `docker-compose.yml` (Postgres + Redis),
    husky + commitlint + lint-staged
- **Governança de IA = nucleus-vue** (`C:\Projetos\trabalho\nucleus-vue`): replique a
  estrutura `.ia/` (agents, orchestrators, rules, skills, specs) adaptada ao
  Agendabô, e mantenha `ia-docs/` com architecture, decisions (ADRs), domain,
  plans, process, testing. **Toda decisão relevante vira ADR; toda feature vira
  spec antes de virar código.** Regras mínimas em `.ia/rules/`:
  - arquitetura de camadas do NestJS (controller → service → repository),
  - `schedule-core` é domínio puro: sem I/O, sem Nest, sem Prisma,
  - testes obrigatórios para lógica de conflito e de notificação,
  - convenções Vue (composição, `<script setup>`, TanStack Query para servidor).
- **IA em runtime = Anthropic SDK** (mesmo padrão do financas): extração de
  linguagem natural de agendamentos ("marcar consulta quinta que vem às 14h"),
  parsing de intenção, contexto de conversação no bot, e consulta de agenda em
  linguagem natural. Sempre com confiança baixa → fila de revisão (item 3.3).

## Produto

O fluxo principal começa no **bot do Telegram**:

### 1. Agendar compromissos

- 1.1 **Detecção de conflito**: ao marcar, impedir choque de horário/dia e
  responder QUAL compromisso já existe (título + horário). Lógica em
  `schedule-core`, coberta por testes (limites: mesma hora, sobreposição parcial,
  compromisso já passado).
- 1.2 **Notificações configuráveis por compromisso**: a cada agendamento,
  perguntar o esquema de lembrete, abrangendo muitos cenários, ex.:
  - 24h antes;
  - 1, 2 ou 3 dias antes;
  - contagem regressiva 3-2-1 dias (todos os disparos);
  - combinação livre (ex.: 3 dias antes + 1h antes);
  - sem lembrete.
    Implementar como conjunto de regras parametrizável (`NotificationRule`) +
    jobs no BullMQ disparados pela API, com cálculo determinístico em
    `schedule-core` (a partir de `startsAt`, timezone e regras).
- 1.3 **Captura de contexto**: antes de criar o compromisso, perguntar se o
  usuário quer adicionar alguma informação importante (notas/anexos de texto);
  salvar junto ao compromisso e incluir nas notificações e na visão web.

### 2. Comunicar compromissos

- 2.1 **Resumo diário parametrizável**: mensagem com resumo dos compromissos do
  dia + os compromissos cujo lembrete vence hoje (params de horário do resumo
  por usuário, ex.: 07:00 no timezone dele).
- 2.2 **Consulta sob demanda**: "quais meus compromissos do dia X do mês Y de Z?"
  — LLM interpreta a pergunta, consulta o banco e responde. Também funcionar com
  "hoje", "amanhã", "semana que vem".

### 3. Visão web

- 3.1 **Cadastro**: email + senha + telegramId, com UI explicando como obter o id
  (mandar mensagem para o @userinfobot no Telegram e copiar o `Id` numérico).
  **Sem telegramId válido o bot não funciona para o usuário** — o bot só atende
  telegramIds cadastrados e confirmados.
- 3.1.1 **Confirmação por email (Resend)**: ao cadastrar, disparar email com
  código; usuário informa o código no web; a API valida se é correto/expirado.
  Limite de **3 reenvios de código por intervalo de 30 minutos** (rate-limit
  persistido). Após confirmar: ir para tela de login com mensagem
  "conta criada com sucesso, faça login".
- 3.2 **Login** com email + senha (JWT, padrão do financas).
- 3.3 **Tela de revisão**: fila dos compromissos que o bot/LLM não conseguiu
  entender com confiança (status `needs_review`); usuário corrige data/hora/
  título e confirma, ou descarta.
- 3.4 **Calendário**: visões de **mês, semana, dia e ano**.

## Modelagem mínima (Prisma)

- `User`: email único, senhaHash, telegramId único (nullable até confirmar uso),
  emailConfirmedAt, timezone, resumoDiarioHora
- `Appointment`: título, startsAt, endsAt, notas, status
  (`confirmed` | `needs_review`), origem (bot | web), userId
- `NotificationRule`: tipo de lembrete por compromisso (quantidade de dias/horas
  antes), relação N:1 com Appointment
- `NotificationOutbox`/job: compromisso, regra, disparaEm, status
  (pending | sent | failed)
- `VerificationCode`: código hash, expiraEm, reenvios (máx. 3 por 30 min), usadoEm

## Ordem de execução (fase por fase — termine uma, mostre o resultado e espere confirmação antes da próxima)

0. **Scaffold**: monorepo pnpm+turbo com `apps/api`, `apps/web`,
   `packages/contracts`, `packages/schedule-core`; `.ia/` completo (agents,
   orchestrators, rules, skills adaptados do nucleus-vue); `ia-docs/` +
   `docs/adr` com:
   - ADR-000: monolito modular em monorepo (sem microserviços)
   - ADR-001: datas armazenadas em UTC + timezone por usuário
   - ADR-002: verificação de email por código em vez de magic link
   - ADR-003: LLM só interpreta, nunca decide conflito (conflito é regra determinística)
     docker-compose (Postgres + Redis), `.env.example`, husky + commitlint.
1. **`schedule-core`** com testes: detecção de conflito, cálculo de disparos de
   notificação, parsing/normalização de datas.
2. **API — auth**: cadastro (email, senha, telegramId), envio de código via
   Resend, validação com rate-limit 3x/30min, confirmação, login JWT.
3. **Bot Telegram**: fluxo de agendamento completo — LLM extrai data/título →
   checagem de conflito → pergunta por notas (1.3) → pergunta lembretes (1.2) →
   cria compromisso → agenda jobs.
4. **Notificações**: workers BullMQ, disparos por regra (1.2) + resumo diário (2.1).
5. **LLM avançado**: consulta de agenda em linguagem natural (2.2) + fila de
   revisão (3.3) alimentada por confiança baixa do LLM.
6. **Web — contas**: cadastro, confirmação por código, login.
7. **Web — agenda**: calendário (mês/semana/dia/ano) + tela de revisão.

## Convenções

- Commits convencionais (commitlint), testes de unidade no domínio (jest no api,
  vitest no web), zod em todas as bordas (inputs da API, respostas do LLM,
  formulários do web).
- Nenhuma lógica de negócio em controller nem no handler do bot — tudo vai para
  services / `schedule-core`.
- O LLM sempre responde contra um schema zod (function calling / JSON mode);
  parse falhou ou confiança baixa → `needs_review`, nunca chute silencioso.
- Segredos apenas em `.env` (nunca commitar): `ANTHROPIC_API_KEY`,
  `RESEND_API_KEY`, `RESEND_FROM`, `TELEGRAM_BOT_TOKEN`, `DATABASE_URL`,
  `REDIS_URL`, `JWT_SECRET`.
- Ao final de cada fase: atualizar `ia-docs/` (specs/plans) e registrar ADR de
  qualquer decisão nova não óbvia.
