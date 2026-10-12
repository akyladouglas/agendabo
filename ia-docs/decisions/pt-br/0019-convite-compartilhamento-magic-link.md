# 0019 - Convite de compartilhamento por magic link (bifurcação do ADR-003)

- Status: **Sugerido — NÃO registrado; aguarda aprovação humana** (rascunho da Etapa 8 do
  plano `ia-docs/plans/compartilhamento-agenda-par.plan.md`, feature implementada 2026-10-12)
- Data: 2026-10-12
- Retifica/estende: ADR-003 (código de 6 dígitos no cadastro) e ADR-0012 (magic link no
  reset) — terceiro ponto da mesma trifurcação: convite de agenda é magic link por UX
  ("clique e aceite"), não código digitável.
- Spec: `.ia/specs/compartilhamento/compartilhamento-agenda-par.spec.md` (F.5 já previa
  este ADR como sugerido).

## Contexto

O convite de compartilhamento precisava de credencial por e-mail. Código de 6 dígitos
(ADR-003) não faz sentido: o convite é uma ação de 1 clique (Aceitar/Recusar), não um
fato a memorizar. O magic link do ADR-0012 é o formato certo, MAS com agravante de
privacidade que o reset não tem: o token de convite aponta para um par de usuários e para
uma agenda — se o e-mail cair em caixa alheia, um portador do token não pode descobrir
QUEM compartilhou QUÊ.

## Decisão

- Token opaco de 32B (`randomToken()`), gravado só como hash sha256, TTL 24h, quota
  3 envios/30min por par ordenado (série = `inviteSentAt` + auditoria
  `invite_created/invite_resent`), índice parcial único via SQL no `tokenHash` `pending`
  (mesma lição F.6 dos precedentes).
- O aceite/recusa são **autenticados pela sessão do convidado** e recebem o token no BODY
  (`POST /shared-agendas/accept|decline` `{token}`). A tela `/convite-agenda?token=` é a
  segunda exceção documentada de token-opaco-em-query (par do `/redefinir-senha`), exigida
  por ser link de e-mail.
- **Card de aceite sem o nome do dono antes da sessão**: a tela logada mostra "convite para
  ver a agenda de alguém"; o nome só aparece após o aceite (ou no próprio e-mail).
  Anti-oráculo: um portador do token autenticado como outro usuário não aprende nada
  (410 uniforme `shared_invite_invalid` para qualquer token ruim).

## Consequências

- Reuso integral do machinery do auth (randomToken/sha256Hex/MailService/quotas puras com
  `now` injetável) sem nova dependência nem env.
- E-mail perdido = convite perdido até expirar: o CONVIDADO não tem botão de reenvio no
  perfil (reenvio é ação do DONO, UI neutra de quota); aceito no v1 e registrado no plano.
- A exceção "token em query" cresce de 1 para 2 rotas — ambas `requireAuth`, ambas
  documentadas no router.
