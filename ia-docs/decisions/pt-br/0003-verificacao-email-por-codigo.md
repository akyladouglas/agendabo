# 0003 — Verificação de email por código em vez de magic link

- Status: Aceito
- Data: 2026-10-05

## Contexto

O cadastro precisa provar posse do email antes do bot atender o telegramId (3.1/3.1.1).
Magic link abre em outro dispositivo/autorrecede em cliente de email e não combina com a
UX pedida: "usuário informa o código no web". O fluxo também precisa de reenvio limitado
contra abuso de custo (Resend).

## Decisão

- Cadastro gera código **numérico de 6 dígitos** (CSPRNG), armazenado como
  `sha256(code)`, TTL **15 min**, uso único (marca `usedAt` e invalida os demais do email).
- Reenvio: máximo **3 por janela deslizante de 30 min por email**, persistido contando as
  linhas `sentAt` de `VerificationCode` (sem tabela extra de quota).
- Validação com comparação em tempo constante; expirado/usado/incorreto → mesma resposta
  401 genérica.
- Após confirmar, a web redireciona ao login com "conta criada com sucesso".

## Consequências

- Fluxo testável e funcional mesmo em cliente de email que reescreve links.
- Custo: superfície de força-bruta de 6 dígitos mitigada por TTL curto, uso único e
  validação por email com código mais recente ativo (sem tentativa múltipla por código).
- Magic link fica como alternativa futura ADR-novo se UX exigir.
