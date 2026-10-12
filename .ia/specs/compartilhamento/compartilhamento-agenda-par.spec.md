# Spec — Compartilhamento de agenda entre usuários (bidirecional por par)

- Domínio: **compartilhamento** (novo) | Data: 2026-10-12 | Status: **aprovada (abertos 1–6 resolvidos pelo humano em 2026-10-12)**
- ADRs relacionados: **ADR-002** (UTC no banco + timezone por usuário na borda — o convidado
  vê a agenda emprestada no fuso **dele**, seguido integralmente), **ADR-004/008** (LLM
  interpreta, regras decidem — a decisão de _acesso_ a uma agenda compartilhada é
  determinística pelo vínculo, nunca do LLM), **ADR-003** (verificação de email por código —
  o convite segue o padrão de token opaco + hash + TTL + quota de reenvio dele e do
  ADR-0012), **ADR-009** (worker próprio — o resumo diário com seção compartilhada nasce na
  materialização do digest do convidado, sem fila nova), **ADR-0013/0015** (grades próprias;
  sobreposição é invariante do dono — nada aqui muda conflito). **Nenhum ADR vigente é
  contrariado.** Dois ADRs novos sugeridos (ver F.5): convite por magic link (bifurcação do
  ADR-003, análoga ao ADR-0012) e a regra de visibilidade `needs_review` × compartilhamento.
- Pedida por: usuário em 2026-10-12 ("Usuário 1 compartilha a agenda dele com o usuário 2, o
  usuário 2 pode ver a agenda do usuário 1, e vice-versa" — par com dois compartilhamentos
  independentes, cada um com seu próprio status) | Fase do roadmap: etapa adicional pós-Fase 9
- **Domínio novo — justificativa**: o conceito atravessa `agendamento` (lê compromissos),
  `conta` (convite por email, contas confirmadas), `notificacao` (resumo diário) e `web`
  (seletor, perfil); nenhuma das fronteiras do context-map (`ia-docs/domain/context-map.md`)
  é dona exclusiva dele. A regra central — "quem pode ver o quê, por qual vínculo" — é um
  bounded context próprio (**compartilhamento**: vínculo compartilhado, convite, dono,
  convidado, papel somente leitura) que os demais consome via service/contracts. Sugestão
  para o deparo: adicionar o bloco COMPARTILHAMENTO ao context-map (entre CONTA e
  AGENDAMENTO) e as entradas do glossário abaixo — **esta spec já usa o vocabulário**:

  | Termo                     | Definição                                                                               | Onde vive                |
  | ------------------------- | --------------------------------------------------------------------------------------- | ------------------------ |
  | **Vínculo compartilhado** | Par ordenado (dono → convidado) com papel fixo `read` e status `pending/active/revoked` | `shared_agendas`         |
  | **Dono**                  | Quem tem os compromissos e concede a leitura                                            | `SharedAgenda.ownerId`   |
  | **Convidado**             | Quem recebe a leitura da agenda emprestada                                              | `SharedAgenda.guestId`   |
  | **Convite**               | Estado `pending` do vínculo + token opaco de aceite por email                           | `SharedAgenda` (pending) |
  | **Agenda emprestada**     | A agenda do dono vista pelo convidado (somente leitura, no fuso do convidado)           | web + bot                |

## Objetivo / dor do usuário

Duas pessoas que organizam a rotina juntas (casal, sócios, médico e secretária) hoje não
conseguem ver a agenda uma da outra de jeito nenhum — cada conta é uma ilha. O humano quer
que um usuário conceda ao outro **leitura** da própria agenda, por convite por email, e que o
gesto funcione nos dois sentidos do par como dois vínculos independentes (A→B e B→A podem
existir, cada um com seu status). O convidado vê os compromissos do dono na web, no resumo
diário e por consulta no bot — sem nunca escrever, sem ver a fila de revisão do dono e sem
receber os lembretes dele.

## Comportamento esperado

Regras numeradas por bloco (A–G). Decisões de produto **já aprovadas pelo humano em
2026-10-12** aparecem como `[P1]`–`[P5]` e estão repetidas na tabela de Decisões.

### A. Vínculo e convite (API `shared-agendas`)

1. **Modelo**: entidade `SharedAgenda` (par ordenado `ownerId` → `guestId`, papel fixo
   `read`, status `pending | active | revoked`). `[P1]` Escrita pelo convidado **não existe**
   — não há outro papel no v1; um futuro papel "criar" exige ADR + spec novos.
2. **Convite por email**: o dono informa o **email** do convidado (`POST /shared-agendas`).
   A API **sempre** responde `202 {}` uniforme (anti-enumeration, padrão "esqueci a senha" /
   ADR-0012): `[P5-inverso]` se o email **não existe ou não é conta confirmada**, nenhum
   convite é criado e nenhum email sai — a resposta é **idêntica** ao caso de sucesso; o dono
   simplesmente não vê o vínculo aparecer na lista quando ele não nasceu (nunca há texto
   "email não existe").
3. **Autoconvite e espelho**: convidar o próprio email falha silencioso (mesmo 202, sem
   criar). Vínculo **ativo no sentido inverso** (B→A ativo) **não bloqueia nem reaproveita**
   A→B: cada sentido é um convite próprio e independente (decisão explícita do humano — o
   gesto "vice-versa" são dois gestos do produto).
4. **Pending duplicado substitui**: convite pendente para o mesmo par ordenado → o novo token
   substitui o anterior (linha única por par `pending`: `tokenHash`/`inviteSentAt`/
   `inviteExpiresAt` atualizados; o link antigo morre). **Quota de reenvio: máx. 3 convites
   por janela deslizante de 30 min por par ordenado**, avaliada por **função pura com `now`
   injetável** (padrão `evaluateResendQuota`/`password-reset.ts`). Quota estourada =
   **avisam quem perdeu o acesso com mensagem leve do bot** (202 igual, nenhum email — qualquer 429 revelaria existência).
5. **Token do convite**: opaco `randomToken()` (32 bytes hex), guardado **só como hash
   sha256** (`tokenHash`), **TTL 24 horas** (`[Aberto #1]` decidido: convite não respondido em 24h = **recusa
   automática**; expiração determinada na hora — leitura/aceite com `now` tratam
   `pending && inviteExpiresAt < now` como recusado, sem job/cron; aceite tardio cai na
   falha genérica da regra 5; dono pode reenviar com nova quota), **uso único** (aceite/consumo marca a linha;
   revogar zera o token). Inexistente/usado/expirado/para-outro-destinatário ⇒ **todos caem
   na mesma falha genérica** exibida pela web ("Link de convite inválido ou expirado") — sem
   distinguir os sabores.
6. **Email do convite** (`MailService`/Resend, HTML table-based no padrão
   `verification-email.ts`): "‹Dono› quer compartilhar a agenda dele com você" + botão
   apontando para `${WEB_ORIGIN}/convite-agenda?token=<TOKEN>` + aviso de validade (**24h**)
   e "se você não reconhece, ignore". Falha do Resend = log interno + 202 uniforme (padrão
   ADR-0012 D3: o token fica criado; reenvio conta na quota).
7. **Aceite** (`POST /shared-agendas/accept`, autenticado — o convidado chega pelo link
   logado ou faz login antes): o token identifica o convite pendente **dele** (guest = a
   própria sessão; nunca por id em query — política "nada de dado do usuário em URL" exceto
   o token opaco, mesma exceção documentada do ADR-0012). Sucesso (204) ⇒ status `active`,
   `acceptedAt = now`, `tokenHash`/`inviteExpiresAt` zerados. Convite para email de **outra
   conta** logada ⇒ falha genérica única (regra 5).
8. **Recusa** (`POST /shared-agendas/decline`, autenticado, 204): vínculo `pending` vira
   `revoked` (`revokedAt = now`). A tela de convite oferece **Aceitar** e **Recusar** (`[Aberto #1]` decidido pelo humano: recusa explicita existe; nao responder = o convite expira em 24h e conta como recusa, regra 5).
9. **Revogar (dono) / Sair (convidado)** (`POST /shared-agendas/:id/revoke`, 204): **ambos os
   lados** podem encerrar um vínculo `active` — dono revoga, convidado sai; mesmo endpoint,
   acesso derivado do papel. ⇒ status `revoked` + `revokedAt`. Efeito **imediato**: a agenda
   some da web/bot/resumo do convidado na próxima consulta (sem cache de vínculo além do
   request). Dono reconvida depois: linha `revoked` do par ganha um novo `pending` (histórico
   do vínculo é a MESMA linha; **[Aberto #3] decidido pelo humano: avisa sim, com mensagem leve do bot SO para quem perdeu o acesso**
   - dono revoga => o convidado recebe uma mensagem do bot: "O acesso a agenda de <dono> foi encerrado."; convidado sai => o dono recebe "<Convidado> saiu do compartilhamento da sua agenda." Sem conteudo de compromisso na mensagem, so estado do vinculo.
10. **Listagem** (`GET /shared-agendas`): o que **enviei** (com o email do convidado — o dono
    precisa reconhecê-lo: **[Aberto #2] decidido pelo humano: enquanto o convite não estiver ativo, a lista de enviados mostra SOMENTE o email do convidado; o nome da conta aparece apenas na lista de recebidos (nome do dono)** e o que **recebi**
    (com o nome do dono), cada um `{ id, papel: owner|guest, contraparte, status,
inviteSentAt/inviteExpiresAt, createdAt/acceptedAt/revokedAt }` (zod nos contracts).
11. **Sem tabela de "convidado sem conta"** (decisão do humano): convite só pega conta
    existente e confirmada; não existe aceitar-para-criar-conta depois.

### B. API de leitura da agenda emprestada

12. **`GET /appointments?from=&to=&owner=<userId>`** — a mesma rota, parâmetro `owner`
    opcional (uuid). **Sem `owner`** ⇒ agenda própria, comportamento **byte a byte** como hoje
    (zero regressão). **Com `owner`** ⇒ agenda emprestada: o service resolve o vínculo
    **dono=owner, convidado=sessão, status=active**; sem vínculo ativo ⇒ `403` genérico com
    `code: "shared_access_invalid"` (a resposta não distingue "não existe" de "pendente/
    revogado"). Justificativa da escolha em D-T1: reusa 100% o zod (`listAppointmentsQuerySchema`),
    a interseção half-open multi-dia, ordenação e cache de queries da web; regra **nova** de
    data: **zero**.
13. **Filtro de privacidade na resposta** `[P5]`: na agenda emprestada só saem compromissos
    `confirmed`. `needs_review` **e** campos de revisão (`rawText`, `reviewReason`) do dono
    são **invisíveis** ao convidado — a fila de revisão é privada (invariante: o dono aprova
    antes de valer). `cancelled` não existe no enum de status (cancelar apaga, ADR-0010) — nada a fazer.
14. **Conflito é do dono, não do convidado**: a resposta é a lista crua do dono (sem badges
    de conflito novos); a web não pinta choque na agenda emprestada (grade read-only — regra
    E; `[Aberto #4]` decidido pelo humano: **nao** - o convidado nao ve marcador/mensagem de conflito do dono no v1 (o marcador `data-conflicted` e as bordas danger ficam restritos a agenda propria do visualizador).
15. **Escrita nunca alcança agenda alheia**: `create/update/remove/check-conflict/reschedule/
relocation-options` continuam operando **só** no `userId` da sessão — nenhuma dessas rotas
    ganha parâmetro de dono. Se um dia precisar, é ADR novo (`[P1]`).
16. **Leitura do dono para o próprio bot** permanece como é (inclui `needs_review` com
    marcador ⚠️); esta spec só toca o que o **convidado** recebe.

### C. Web — `/agenda` com agenda emprestada

17. **Seletor de fonte** na `AgendaNav`: "Minha agenda" + um item por vínculo **recebido
    ativo** ("Agenda de ‹nome›"). Trocar o seletor troca **a fonte da query** (`owner=<id>`)
    mantendo visão/âncora/período; o cache TanStack usa a chave por `{fonte, from, to}` —
    nunca misturar itens de agendas na mesma chave. Sem vínculos ativos ⇒ só "Minha agenda"
    (`[Aberto #5]` decidido pelo humano: sem nenhum vínculo ativo o seletor **não aparece** — nem desabilitado).
18. **Tudo read-only na agenda emprestada**: sem clique-em-célula-vazia-cria, sem drag
    (pointer-events do gesto desligados), sem botões de editar/excluir no painel de
    detalhes; o clique no **bloco/chip abre os detalhes** somente-leitura (título, horário,
    notas). Cabeçalho/subtítulo da página indica a fonte ("Vendo a agenda de ‹nome› · somente
    leitura").
19. **Fuso e multi-dia do convidado** `[regra-zero]`: datas/horas convertidas **no fuso do
    convidado** na borda (ADR-002 — offsets medidos no tz **dele**), e o corte multi-dia vale
    para a visão do convidado exatamente como na própria agenda (`localDaysTouched`,
    `groupByLocalDayTouched`, `sliceItemToRange`, `layoutDayTimeline` — reuso integral do
    `schedule-core`, **zero regra nova de data**; um compromisso do dono que cruza a
    meia-noite local do convidado aparece nos dias tocados **do convidado**).
20. **Indicador visual do dono**: chips/blocos da agenda emprestada carregam marcador de
    dono (cor/padrão de acento + texto "de ‹nome›" no painel de detalhes) para nunca parecer
    compromisso próprio — inclusive quando os dois vínculos do par estão ativos e o convidado
    alterna entre as fontes.

### D. Web — `/perfil` "Agendas compartilhadas"

21. Seção nova no `/perfil` (ao lado de Sessões ativas), duas listas:
    - **Que eu compartilho**: por vínculo enviado — contraparte, status (`pendente · expira
em X` / `ativo` / `revogado`), botão **Revogar** (se ativo) e **Reenviar convite** (se
      pendente; respeita a quota avisam quem perdeu o acesso com mensagem leve do bot — UI neutra, sem contador).
    - **Compartilhadas comigo**: por vínculo recebido — dono, status; convite **pendente**
      recebido aparece aqui também com "ver convite"; vínculo ativo com **Sair**.
22. Tela **`/convite-agenda?token=<TOKEN>`** (rota `requireAuth` — logado ou login-antes):
    card "‹Dono› quer compartilhar a agenda dele com você (somente leitura)" + botões Aceitar
    / Recusar. Token ausente/ruim (410/403 genéricos) ⇒ card único "Link de convite inválido
    ou expirado." — sem estado intermediário. Aceite ⇒ toast + link para `/agenda` já com a
    fonte trocada para a agenda emprestada.

### E. Bot e worker

23. **Resumo diário** `[P3]`: o digest do convidado passa a ter **uma seção por agenda
    compartilhada recebida ativa** ("Agenda de Fulano:" + os `confirmed` do dono **no dia
    civil do convidado** com horário local do convidado — o dono pode estar em outro fuso; a
    materialização/idempotência do digest não muda (linha por usuário/dia), só o **corpo**
    montado no worker). Sem vínculo ativo ⇒ corpo exatamente como hoje. Compromissos
    `needs_review` do dono **não** entram `[P5]`. **Lembretes: zero mudança** — o agendador de
    lembretes continua só para o dono `[P3]`.
24. **Consulta no bot** `[P3]`: a fala "como está a agenda da Fulano amanhã?" segue o fluxo
    existente de consulta, com o contrato **estendido** (ver F.2): o LLM **extrai** o alvo da
    consulta — `minha` (default) ou `compartilhada: <nome-dito>` — **classificação é LLM, a
    decisão de acesso é determinística**: o service casa o nome dito com os vínculos ativos
    do usuário (mesma régua de `findMatchingAppointments`: nome único ⇒ consulta; N ⇒ lista
    numerada "1/2/…" sem LLM; 0/nenhum vínculo ⇒ "Você não tem essa agenda compartilhada").
    Resposta igual à consulta própria (período, truncar 10, agregado ≥ 30, tz do usuário) —
    só que filtrada `confirmed` do dono. Falha de confiança/parse do alvo ⇒ pergunta "De qual
    agenda? (a sua ou qual compartilhada)" — nunca chuta `[llm.md]`.
25. **Bot nunca escreve em agenda emprestada** `[P3]`: o fluxo de criar continua na agenda
    própria (intent de criar **não** pega alvo compartilhado). "Marca X **na agenda da
    Fulano** amanhã" ⇒ **negação educada determinística** ("Só consigo marcar na sua própria
    agenda — a da Fulano é somente leitura"), sem abrir a máquina de estados de criar. A
    negação não depende de LLM decidir o "não".

### F. Segurança, observabilidade e não-funcionais

F.1. **Anti-enumeration** é requisito nominal de aceite (regra 2 + testes): respostas,
timings perceptíveis e textos idênticos entre email-existe e email-não-existe.
F.2. **Token**: opaco, hash sha256 no banco (nunca o valor cru — log, erro, resposta ou
email de erro); uso único; TTL 24 horas; busca por hash + comparação em tempo constante
(`codeMatches` existente, defesa em profundidade).
F.3. **Sem transitividade**: A→B **não** dá a B compartilhar a agenda de A com C; a criação de
convite exige ser o **dono** dos compromissos (vínculo é sempre dono→convidado direto).
Convidado que tentasse criar convite "em nome de" outrem: não existe rota para isso (a
API só aceita convidar a partir da sessão-dono).
F.4. **Observabilidade / auditoria completa** (`[Aberto #6]` decidido pelo humano: **100% completo**): evento de auditoria em TABELA dedicada `shared_agenda_audit_events` (id, occurredAt, actorId, ownerId, guestId?, kind: `invite_created | invite_resent | invite_email_failed | invite_accepted | invite_declined | invite_expired_auto | access_revoked | guest_left | access_read | write_denied | shared_section_built`, metadata zod `.strict()` SEM conteudo de compromisso - so ids/statuses/quantidades), escrita no mesmo padrao de `BotEvent`. Consulta `GET /shared-agendas/audit` (somente o dono de um vinculo ou o convidado dele veem os proprios eventos; paginada; zod) expondo na web dentro da secao `Agendas compartilhadas` do perfil: `Historico` de cada vinculo (quando convidei, aceitei, acessei, revoguei). Log estruturado continua como espelho para o tracker. A regra de escrita fica em service fino; a lista de kinds vive em constante testavel.
F.5. **ADRs novos sugeridos**: **(i)** "convite de compartilhamento por magic link" — bifurcação do ADR-003 análoga ao ADR-0012 (sem sessão no momento do clique, link carrega só o token opaco, TTL 24 horas); **(ii)** "agenda emprestada não mostra `needs_review`" — extensão da régua ADR-0010 a um novo leitor.
F.6. **Não-funcionais**: query do convidado usa o índice existente `@@index([userId,
    startsAt])` (mesma forma da `list` do dono); `@@index([ownerId, guestId])` + índice parcial
único no `tokenHash` (pendente) criados via SQL na migração (lição do índice parcial do
digest/reset: **não** declarar `@@unique` total no schema). Lista de vínculos do usuário é
pequena — sem paginação no v1.
F.7. **A11y (padrão das specs irmãs)**: por viewport (360/768/≥1280) — [ ] seletor de fonte e
botões Revogar/Sair/Aceitar/Recusar operáveis por teclado com foco visível; [ ] alvos
≥44px; [ ] o seletor anuncia a fonte atual (`aria-` no AppSelect radix, sem depender só
de cor); [ ] o indicador de dono no bloco é textual (não só cor); [ ] estados
carregando/erro/vazio das listas do perfil visíveis; [ ] sem scroll horizontal.

## Fora de escopo

- **Escrita pelo convidado** (criar/editar/cancelar na agenda do dono) — `[P1]`, ADR+spec novos.
- **Grupos, calendários públicos, links públicos de agenda** (qualquer coisa sem vínculo
  conta→conta).
- **Notificar o convidado com lembretes/conteúdo** — `[P3]` fixa lembrete só no dono. (A
  mensagem leve de revogação/saída de acesso EXISTE, regras A.9/E.)
- **Transitividade** (A→B e B→C não dão a C acesso à agenda de A) — regra F.3.
- **Aceitar convite sem conta** (fluxo aceitar-para-cadastrar) — convite só pega conta
  existente confirmada (A.11).

## Decisões

| #   | Tema                          | Decisão                                                                                                                                                                                                                             |
| --- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Permissão                     | **Somente leitura** para o convidado; escrita não existe no v1 (rotas de escrita não têm parâmetro de dono) — A.1, B.12, C.18, E.                                                                                                   |
| P2  | Privacidade                   | Convidado vê título/horário/notas do dono; `needs_review` e campos de revisão são invisíveis — B.13.                                                                                                                                |
| P3  | Notificações                  | Lembrete só no dono; resumo diário ganha seção por agenda emprestada; bot consulta agenda compartilhada; negação de escrita determinística — E.                                                                                     |
| P4  | Convite                       | **Por email** (Resend), token opaco de uso único, **TTL 24h**; Aceitar/**Recusar**; não responder em 24h = recusa automática; revogável pelos dois lados; **anti-enumeration total** (padrão "esqueci a senha") — A.2–A.9, F.1/F.2. |
| P5  | needs_review                  | Fila de revisão do dono é privada: o convite nunca mostra pendências do dono — B.13.                                                                                                                                                |
| A1  | Recusa do convite             | Botão "Recusar" existe (`POST /shared-agendas/decline`); convite não respondido em 24h conta como recusa — A.5/A.8.                                                                                                                 |
| A2  | Lista de enviados             | Enquanto o convite não ativa, mostra **somente o email** do convidado; nome da conta só na lista de recebidos — A.10.                                                                                                               |
| A3  | Aviso de revogação            | Mensagem leve do bot **só para quem perdeu o acesso** (sem conteúdo de compromisso) — A.9.                                                                                                                                          |
| A4  | Conflito na agenda emprestada | O convidado **não** vê o marcador de conflito do dono no v1 — B.14.                                                                                                                                                                 |
| A5  | Seletor sem vínculos          | Sem vínculo ativo o seletor **não aparece** — C.17.                                                                                                                                                                                 |
| A6  | Auditoria                     | **Completa no v1**: tabela `shared_agenda_audit_events` + `GET /shared-agendas/audit` + "Histórico" no perfil — F.4.                                                                                                                |

## Abertos

**Nenhum.** Os 6 abertos foram resolvidos pelo humano em 2026-10-12 (ver Decisões A1–A6).

## Critérios de aceite (checklist de fim de feature)

- [ ] Spec marcada implementada; plano `ia-docs/plans/compartilhamento-agenda-par.plan.md` concluído.
- [ ] Migrations `shared_agendas` + `shared_agenda_audit_events` aplicáveis (índice parcial único do `tokenHash` via SQL, lição do digest).
- [ ] Matriz status × rota testada (pending/active/revoked × `GET /appointments?owner`, accept, decline, revoke).
- [ ] `needs_review` do dono invisível ao convidado (`rawText`/`reviewReason` ausentes do payload).
- [ ] Multi-dia + fuso do convidado cobertos (schedule-core reusado, zero regra nova de data).
- [ ] Convite: quota 3/30min, TTL 24h, recusa, aceite, expiração = recusa, anti-enumeration nominal (testes).
- [ ] Resumo diário com 0/1/N agendas emprestadas; negação de escrita no bot sem abrir sessão de criar.
- [ ] Web: seletor só com vínculo ativo; read-only estrutural (sem drag/criar/editar); perfil com lista + "Histórico" de auditoria.
- [ ] ADRs (i)/(ii) registrados se o humano aprovar no deparo; context-map + glossário com o bloco COMPARTILHAMENTO.
- [ ] Gates verdes: build + test + lint + lint:arch.
