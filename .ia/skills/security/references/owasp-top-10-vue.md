# OWASP Top 10 Adaptado pra Vue 3

## 1. Broken Access Control

**O que é**: Usuário acessa recursos que não deveria (ex.: user A vê dados do user B).

**Como evitar no Vue 3**:

- Validar permissões **no backend** (não confiar no front)
- Usar `usePermissionCheck` no front (mas o backend é a fonte de verdade)
- Nunca expor IDs de outros usuários na UI

**Exemplo ruim**:

```typescript
// Front end: usuário pode passar qualquer tenantId
const tenant = useQuery(["tenant", id], () => tenantService.getTenant(id));
```

**Exemplo bom**:

```typescript
// Backend: valida se o usuário tem permissão pro tenantId
// Front end: usa usePermissionCheck pra esconder/permitir ações
const { canEdit } = usePermissionCheck("tenants-write");
```

## 2. Cryptographic Failures (ex-Sensitive Data Exposure)

**O que é**: Dados sensíveis expostos (sem criptografia, sem masking).

**Como evitar no Vue 3**:

- **Nunca** logar dados sensíveis (`console.log(tenant.email)`)
- **Mask** dados sensíveis na UI (ex.: `***@***.com`)
- Usar **HTTPS** sempre
- **Nunca** expor tokens/chaves na UI

**Exemplo ruim**:

```typescript
console.log("Tenant:", tenant); // expõe email, CPF, etc.
```

**Exemplo bom**:

```typescript
// Mask na UI
const maskedEmail = tenant.email.replace(/^(.).+(@.+)$/, "$1***$2");
// console.log apenas o que é necessário
console.log("Tenant ID:", tenant.id);
```

## 3. Injection

**O que é**: Injeção de código malicioso (SQL, NoSQL, command, etc.).

**Como evitar no Vue 3**:

- **Front end**: validar input (vee-validate + zod)
- **Backend**: usar prepared statements (não é responsabilidade do front, mas o front não deve "confiar" no input)
- **Nunca** interpolar input do usuário em queries

**Exemplo ruim**:

```typescript
// Se o backend fizer isso:
const query = `SELECT * FROM tenants WHERE id = ${id}`;
```

**Exemplo bom**:

```typescript
// Backend: prepared statement
const query = "SELECT * FROM tenants WHERE id = ?";
const [rows] = await db.execute(query, [id]);

// Front end: validação
const schema = z.object({
  id: z.string().uuid(),
});
```

## 4. Insecure Design

**O que é**: Falhas de design que permitem ataques (ex.: não considerar segurança no design).

**Como evitar no Vue 3**:

- **Threat modeling** antes de implementar
- Considerar segurança no design (ex.: rate limiting, audit trail)
- Usar **checklists de segurança** (como este)

## 5. Security Misconfiguration

**O que é**: Configurações inseguras (ex.: CORS permissivo, headers ausentes).

**Como evitar no Vue 3**:

- Configurar **CORS** corretamente (só origens permitidas)
- Configurar **headers de segurança** (CSP, X-Content-Type-Options, etc.)
- **Não** expor informações de debug em produção

**Exemplo ruim**:

```javascript
// CORS permissivo
app.use(cors({ origin: "*" }));
```

**Exemplo bom**:

```javascript
// CORS restrito
app.use(
  cors({
    origin: ["https://app.octadesk.com", "https://admin.octadesk.com"],
  }),
);
```

## 6. Vulnerable and Outdated Components

**O que é**: Usar bibliotecas com vulnerabilidades conhecidas.

**Como evitar no Vue 3**:

- Rodar `npm audit` regularmente
- Atualizar dependências
- Usar `Dependabot`/`Renovate` pra automação

## 7. Identification and Authentication Failures

**O que é**: Falhas de auth (ex.: JWT sem expiration, tokens fracos).

**Como evitar no Vue 3**:

- **JWT** com expiration curta (ex.: 15min)
- **Refresh token** em httpOnly cookie
- **Rate limiting** no login
- **MFA** (Multi-Factor Authentication)

**Gap no nucleus-vue**: JWT em localStorage (risco XSS)

## 8. Software and Data Integrity Failures

**O que é**: Carregar código/dados não confiáveis.

**Como evitar no Vue 3**:

- **CSP** (Content Security Policy) pra bloquear scripts não confiáveis
- **Subresource Integrity (SRI)** pra CDN
- **Nunca** carregar código de fontes não confiáveis

## 9. Insufficient Logging and Monitoring

**O que é**: Não logar eventos de segurança (ex.: login failed, access denied).

**Como evitar no Vue 3**:

- Logar **eventos de segurança** (login, logout, access denied)
- **Alertas** pra eventos críticos (ex.: 5 failed logins)
- **Audit trail** de ações sensíveis (ex.: alteração de billing)

## 10. Server-Side Request Forgery (SSRF)

**O que é**: Atacante faz o servidor fazer requests a recursos não confiáveis.

**Como evitar no Vue 3**:

- **Front end**: menos relevante (o front não faz requests diretos ao backend de outros serviços)
- **Backend**: validar URLs antes de fazer requests (allowlist de domínios)
