# Spec — Sessão rígida de 24h + gestão de sessões ativas + e-mail de novo login + bug do logout

- Domínio: auth (conta) | Data: 2026-10-11 | Status: **aprovada pelo humano em 2026-10-11** (as 4 decisões abaixo; sem Abertos)
- ADRs relacionados: nenhum vigente sobre sessão (nenhum contrariado). Decisão não-óbvia — refresh token como chave de gestão de dispositivos **sem tabela nova** + teto absoluto de 24h na cadeia de rotação ⇒ **novo ADR nesta feature** (padrão ADR-012/reset). ADR-002 (datas UTC) — **não contrariado**.
- Specs relacionadas: `.ia/specs/auth/esqueci-a-senha-reset-senha.spec.md` (mesma família de conta; o reset já revoga refresh tokens — precedente de "matar sessões" no banco)
- Estado acoplado (não re-descrito): `apps/api/src/modules/auth/` (`auth-signup.service.ts` login/refresh, `auth.service.ts` refresh opaco HMAC + `REFRESH_COOKIE`, `auth.controller.ts` fino com `REFRESH_COOKIE_OPTS`, `mail.service.ts` único ponto de saída de email), Prisma `RefreshToken` (`refresh_tokens`: `tokenHash` unique, `expiresAt`, `userId`), web `app/services/api.ts` (axios + `refreshOnce` 1x), `app/store/authStore.ts` (bootstrapSession), `router/middlewares/index.ts` (`requireAuth`), perfil `view/pages/profile/ProfilePage.vue`.

## Objetivo / dor do usuário

Hoje o refresh token (cookie httpOnly) vale 30 dias fixos e **rotaciona sem rastrear nada**: não existe noção de "sessão", o usuário não sabe de quantos dispositivos está logado nem consegue derrubar um deles, e — bug — **`POST /auth/logout` só limpa o cookie**: os tokens no banco sobrevivem, então um refresh copiado/vazado continua válido após "Sair". A sessão precisa morrer em 24h absolutas do login, o refresh token precisa virar chave de gestão de dispositivos, e um login novo em dispositivo novo precisa avisar por e-mail.

## Decisões aprovadas pelo humano (2026-10-11)

1. **24h absolutas desde o login**: a cadeia de refresh tokens morre em `loginAt + SESSION_ABSOLUTE_TTL` independentemente de atividade. A cada rotação o novo token **herda `loginAt`** e recebe `expiresAt = min(now + REFRESH_TOKEN_TTL_DAYS, loginAt + SESSION_ABSOLUTE_TTL)`. Passou do teto → `POST /auth/refresh` responde **401** com corpo `{ statusCode: 401, code: 'session_expired', message: 'Sua sessão expirou. Entre novamente.' }`. `SESSION_ABSOLUTE_TTL_HOURS` default **24** (env opcional, validado por zod; `.env.example` atualizado). O `maxAge` do cookie no refresh usa o **`expiresAt` real** do novo token, não TTL fixo.
2. **Refresh token = chave de gestão de dispositivos** (1 linha por usuário logado — o token rotacionado "é" a sessão; **sem tabela nova**):
   - `RefreshToken` ganha `loginAt DateTime @default(now())`, `ip String?`, `userAgent String?`. O TTL de 30 dias permanece apenas como default do refresh — o teto de 24h manda.
   - `POST /auth/sessions` (auth guard): lista as sessões ativas do usuário (linhas não expiradas: `id`, `ip`, `userAgent`, `loginAt`, `current` — a chamada é a que apresenta o cookie atual, comparando o hash do cookie com o `tokenHash` da linha).
   - `DELETE /auth/sessions` (auth guard): revoga **todos** os refresh tokens do usuário **exceto** o da chamada.
   - `POST /auth/logout` (bug corrigido): resolve o usuário **pelo cookie de refresh** (endpoint continua `@Public()`; ausente/inválido → só limpa o cookie, **nunca 401 num logout**) e apaga **todos** os `refresh_tokens` do usuário no banco além do `clearCookie`.
   - Login **não** revoga as outras sessões — múltiplas sessões simultâneas são o objetivo (a tela lista e permite derrubar as outras).
3. **E-mail de alerta de novo login** (Resend via `MailService` reaproveitado): em cada login com sucesso, compara fingerprint (**user-agent**, com ip registrado junto) com as sessões ativas + última sessão conhecida do usuário; se **novo dispositivo** → e-mail "Novo login na sua conta" com ip, user-agent e data/hora + aviso "se não foi você, encerre as outras sessões em Perfil → Suas sessões". **Sem sessão prévia (primeiro login) NÃO envia.** Falha de e-mail nunca falha o login (try/catch + log interno, padrão `sendNewCode`).
4. **Web**:
   - Sessão expirada em qualquer ponto (refresh 401 `session_expired` ou 401 pós-refresh) → limpar store + **redirect imediato** para `/login` com aviso discreto "Sua sessão expirou. Entre novamente." (toast). Helper compartilhado (`forceLogout` no authStore usando o router), usado pelo bootstrap, pelo interceptor e pelo logout.
   - Botão **Sair**: `await POST /auth/logout` → limpar estado → `router.replace('/login')` **imediato** (não esperar a próxima navegação).
   - **Perfil** ganha a seção **"Suas sessões ativas"**: lista (user-agent resumido → "Windows · Chrome", ip, "desde HH:MM dd/MM" — horário **UTC declarado no cabeçalho da seção**, coerente com o resto do produto), a atual marcada "Este dispositivo", botão **"Encerrar todas as outras"** (mutation `DELETE /auth/sessions`, toast de sucesso, revalidar). Skeleton + vazio + erro como nas outras seções. Zod dos payloads novos em `@agendabo/contracts`.

## Fronteiras e dados

- **Contracts** (`packages/contracts/src/api/auth.ts` — novos): `authSessionsListResultSchema` (`{ items: [{ id: uuid, ip: string|null, userAgent: string|null, loginAt: coerce-date, current: boolean }] }`) e `revokeOtherSessionsResultSchema` (`{ revoked: int ≥ 0 }`).
- **Prisma**: `RefreshToken` + `loginAt`/`ip`/`userAgent` (migration `20261011<hhmmss>_session_24h_refresh_meta` — **só escrever, não rodar**; o `hhmmss` é do momento em que o builder criar o arquivo). Tokens existentes ganham `loginAt = agora da migration` (`@default(now())` preserva sessões antigas: elas vivem no máximo 24h após o deploy — aceito, é o comportamento desejado; nenhuma revogação em massa).
- **Regra pura** (TDD obrigatório — regra de data): `computeSessionExpiry({ now, loginAt, absoluteTtlMs, refreshTtlMs }) → { expiresAt, expired }` em módulo novo `session-expiry.ts` (função pura, tempo injetável — sem `Date.now()` fora de bordas). O service injeta `now: () => Date` (default `Date.now`) para testes.
- **Camadas**: controller fino (extrai `req.cookies`/`req.ip`/`user-agent`, mapeia erro de domínio → HTTP com `code`); decisão/DB/email no `AuthSignupService` + service novo `AuthSessionsService`; nada de regra no componente (web: página → composable/mutation → service `http`).

## Critérios de aceite (Gherkin)

### API — teto de 24h

- **Dado** um refresh token criado em `loginAt` **Quando** `POST /auth/refresh` com `now > loginAt + SESSION_ABSOLUTE_TTL` **Então** `401` com corpo `{ statusCode: 401, code: 'session_expired', message: 'Sua sessão expirou. Entre novamente.' }` **E** nenhum token novo é criado.
- **Dado** `now + REFRESH_TOKEN_TTL_DAYS > loginAt + SESSION_ABSOLUTE_TTL ≥ now` **Quando** refresh **Então** rotaciona e o novo token tem `expiresAt` **exatamente igual ao teto** `loginAt + SESSION_ABSOLUTE_TTL` (asserção no create).
- **Dado** `now` dentro do teto com folga **Então** rotaciona com `loginAt` **herdado** do token anterior e `expiresAt = min(now + REFRESH_TOKEN_TTL_DAYS, teto)`; o token antigo é apagado.
- **Dado** login novo **Então** o token nasce com `loginAt = now`, `ip` e `userAgent` da requisição, `expiresAt = min(now + REFRESH_TOKEN_TTL_DAYS, now + SESSION_ABSOLUTE_TTL)` (com default 24h: o teto).
- **Dado** `SESSION_ABSOLUTE_TTL_HOURS` ausente no env **Então** o default é 24.

### API — logout e gestão de sessões

- **Dado** um cookie de refresh válido **Quando** `POST /auth/logout` **Então** `clearCookie` **E** `deleteMany` de **todos** os `refresh_tokens` do usuário **E** `200 { ok: true }`; um refresh posterior com o token antigo → 401.
- **Dado** logout sem cookie (ou cookie desconhecido) **Então** ainda `200` + `clearCookie` (nunca 401 num logout).
- **Dado** `POST /auth/sessions` autenticado (Bearer) com o cookie da sessão A **Então** lista só as linhas não expiradas do usuário, com `current: true` exatamente na linha cujo `tokenHash` bate com o hash do cookie.
- **Dado** `DELETE /auth/sessions` autenticado com cookie da sessão A **Então** apaga as outras linhas do usuário e **mantém** A (`{ revoked: n }`); refresh com o token de A ainda funciona.

### API — e-mail de novo login

- **Dado** usuário com sessão ativa de user-agent X **Quando** login com user-agent Y **Então** `mail.send` é chamado com assunto "Novo login na sua conta" contendo ip, user-agent e data/hora + o aviso de encerrar sessões.
- **Dado** usuário com sessão ativa de user-agent X **Quando** login com user-agent X (ip diferente) **Então** **nenhum** e-mail é enviado.
- **Dado** usuário **sem nenhuma** sessão/linha anterior (primeiro login) **Então** nenhum e-mail é enviado.
- **Dado** `mail.send` que lança **Então** o login conclui normalmente (sem throw) e loga em stderr.

### Web

- **Dado** o interceptor com refresh que responde 401 `session_expired` (ou 401 genérico) **Então** o store é limpo, o access token é zerado e o router **redireciona para `/login`** com toast "Sua sessão expirou. Entre novamente." (sem esperar navegação nem 401 de query).
- **Dado** o botão Sair **Então** `POST /auth/logout` é **aguardado**, o estado é limpo e `router.replace('/login')` acontece em seguida.
- **Dado** o Perfil montado **Então** `POST /auth/sessions` lista as sessões com o label do dispositivo resumido do user-agent, ip e "desde HH:MM dd/MM" (UTC), a atual marcada "Este dispositivo" (com skeleton antes da resposta, vazio quando `items: []`).
- **Dado** o botão "Encerrar todas as outras" **Então** `DELETE /auth/sessions` é chamado, um toast de sucesso aparece e a query de sessões é revalidada.

## Fora de escopo

- Remover botão "Cancelar" do Reagendamento Assistido (outra feature).
- Mudar flags do cookie (path/httpOnly/sameSite/secure) — só o `maxAge` passa a ser o `expiresAt` real.
- Revogação seletiva por sessão (derrubar UMA sessão específica) — aprovado só "encerrar todas as outras".
