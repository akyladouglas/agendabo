# Agendabô — Prompts de continuação por fase

> Use um prompt por sessão nova, na ordem. Todos assumem o `PROMPT.md` como base:
> comece cada sessão dizendo: _"Leia PROMPT.md e .ia/rules em
> C:\Projetos\estudos\agendabo antes de codar."_

## Fase 0 — Scaffold

> Crie o scaffold do monorepo do Agendabô seguindo a Fase 0 do PROMPT.md:
> pnpm+turbo, apps/api (NestJS+Prisma+BullMQ), apps/web (Vue3+Vite+Tailwind4+
> radix-vue), packages/contracts, packages/schedule-core, docker-compose
> (Postgres+Redis), .env.example, husky+commitlint, estrutura .ia/ e ia-docs/
> adaptada do nucleus-vue, e os ADRs 000–003 listados no PROMPT.md.
> Use C:\Projetos\estudos\financas como referência de estrutura.

## Fase 1 — schedule-core

> Implemente packages/schedule-core com testes (jest): (a) detecção de conflito
> de horários entre compromissos (casos: mesma hora, sobreposição parcial,
> encostados fim=início, compromisso passado); (b) cálculo determinístico dos
> instantes de disparo a partir de startsAt + timezone + regras de lembrete
> (24h antes, N dias antes, contagem regressiva 3-2-1, combinações, sem
> lembrete); (c) normalização de datas/horas em UTC. Domínio puro: sem Nest,
> sem Prisma, sem I/O.

## Fase 2 — API auth

> Implemente na apps/api o módulo de auth do PROMPT.md (Fase 2): cadastro com
> email+senha+telegramId, envio de código de verificação via Resend, endpoint de
> validação de código, rate-limit de 3 reenvios por 30 min persistido em banco,
> confirmação de email e login JWT com argon2. Reaproveite o padrão de módulos,
> guards e configs do projeto financas (C:\Projetos\estudos\financas\apps\api).

## Fase 3 — Bot Telegram

> Implemente o bot do Telegram (Fase 3 do PROMPT.md): atendimento somente a
> telegramIds cadastrados/confirmados; fluxo de agendamento com Anthropic SDK
> extraindo data/horário/título em linguagem natural (resposta validada por zod),
> checagem de conflito via schedule-core com retorno do compromisso que choca,
> pergunta se quer adicionar informação importante (notas) antes de criar,
> pergunta o esquema de lembrete, cria o compromisso e agenda os jobs.

## Fase 4 — Notificações

> Implemente os workers BullMQ (Fase 4 do PROMPT.md): disparo das
> NotificationRules na hora certa e o resumo diário parametrizável (compromissos
> do dia + lembretes que vencem hoje, no timezone e hora configurados do
> usuário). Inclua outbox com status pending/sent/failed e reprocessamento.

## Fase 5 — LLM: consulta + revisão

> Implemente a Fase 5 do PROMPT.md: consulta de agenda em linguagem natural
> ("compromissos do dia X do mês Y de Z", "hoje", "amanhã", "semana que vem")
> e a fila needs_review — quando o LLM não entende com confiança, o compromisso
> entra como needs_review para correção no web.

## Fase 6 — Web: contas

> Implemente no apps/web (Fase 6 do PROMPT.md): cadastro (email, senha,
> telegramId com UI explicando o @userinfobot), tela de confirmação de código
> com contador de reenvios (máx. 3 em 30 min), redirect para login com mensagem
> de conta criada, e login. Stack: Vue3 + radix-vue + vee-validate/zod +
> TanStack Query + pinia, igual ao financas web.

## Fase 7 — Web: calendário + revisão

> Implemente a Fase 7 do PROMPT.md: calendário com visões de mês, semana, dia e
> ano, e a tela de revisão dos compromissos needs_review (editar data/hora/
> título, confirmar ou descartar).
