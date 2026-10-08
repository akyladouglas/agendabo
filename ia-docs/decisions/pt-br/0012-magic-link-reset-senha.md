# 0012 — Magic link no reset de senha (mantém código no cadastro)

- Status: Aceito
- Data: 2026-10-08
- Contexto da fase: mini-fase "Esqueci a senha" (entre a Fase 5 e a Fase 6)
- Retifica/estende: ADR-003 (verificação de email por **código** no cadastro), cuja
  seção Consequências registra exatamente esta bifurcação: "Magic link fica como
  alternativa futura ADR-novo se UX exigir."
- Spec: `.ia/specs/auth/esqueci-a-senha-reset-senha.spec.md` (aprovada 2026-10-08)

## Contexto

O ADR-003 escolheu código numérico de 6 dígitos para o cadastro porque ali o
**usuário informa o código na web**: existe uma sessão da SPA, uma tela pedindo os
6 dígitos e um e-mail que o próprio usuário digitou segundos antes. O reset de
senha tem forma diferente: quem esqueceu a senha **não tem sessão** e chega ao
produto **por fora** — muitas vezes abrindo o e-mail no celular e precisando
continuar no navegador do desktop. Um código de 6 dígitos obrigaria a copiar e
digitar entre dispositivos para um token que poderia ser clicável, e o e-mail de
destino é justamente o dado que o usuário não está digitando em lugar nenhum
(temos apenas o que ele digitou no form de "esqueci a senha").

A regra de quota persistida do ADR-003 (contar linhas `sentAt` na mesma tabela,
sem tabela extra de quota) continua sendo o padrão — apenas com janela/teto
próprios. A política de privacidade das rotas de auth decidida pelo humano em
2026-10-08 ("nenhum dado do usuário em query params") precisava de uma decisão
explícita sobre o token na URL do magic link.

## Decisão

- **O reset de senha usa magic link** (token opaco de 32 bytes CSPRNG em hex),
  **não** código de 6 dígitos. O **cadastro mantém o código do ADR-003** — os dois
  mecanismos coexistem porque servem a fluxos com restrições diferentes.
- O token vive na MESMA tabela `verification_codes` com `kind = password_reset`
  (mesmo conceito: prova de posse temporária de um e-mail — hash sha256, TTL, uso
  único, quota por `sentAt`); índice único **parcial** em `code_hash` apenas para
  `kind = 'password_reset'` (codigos de 6 dígitos têm espaço de 1e6 e colidem),
  criado via SQL na migração `password_reset_kind` — mesma técnica do digest do outbox.
- TTL **1 h** (link abre em outro dispositivo; 24 h seria superfície grande demais
  para um token que troca senha) e quota **2 envios por janela deslizante de
  10 min por e-mail**, **silenciosa** quando estoura: a resposta é sempre
  `202 {}` uniforme (anti-enumeration), então 429/mensagem específica revelaria
  que o e-mail existe — diferença honesta vs. o 429 do resend do cadastro, onde a
  resposta já é específica ao e-mail por natureza.
- **Exceção única e documentada à política de URL**: `/redefinir-senha?token=...`
  é a única rota com dado na query string. O token é opaco, de uso único, TTL 1 h
  e não carrega NADA sobre o usuário — o oposto do e-mail/userId legíveis que a
  política protege. Nenhum outro dado (e-mail, handoff, sessionStorage) entra no
  fluxo, que é deliberadamente stateless entre telas.
- Concluir o reset apaga **todos** os `refresh_tokens` do usuário (senha esquecida
  é sinal de possível compromise; o access token de sessões antigas sobrevive só
  até o TTL de 15 min) e envia aviso best-effort no Telegram (Aberto #3 da spec,
  decisão do humano).

## Consequências

- Quem esquece a senha tem caminho de recuperação sem suporte manual; nada fica
  ancorado em "código digitado em tela" quando não há tela.
- A tabela única `verification_codes` ganha a coluna `kind`; as funções puras de
  quota são parametrizadas por janela/teto (`password-reset.ts`) em vez de
  duplicadas.
- O custo aceito da uniformidade anti-enumeration: falha do Resend conta na quota
  de 10 min e o `mailDelivered:false` do signup **não** se replica aqui (qualquer
  sinal extra na resposta vazaria existência de conta).
- Se um dia o cadastro mudar para magic link, este ADR é o ponto de partida — a
  assimetria atual é intencional, não dívida.
