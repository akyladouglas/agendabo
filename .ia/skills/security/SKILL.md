---
name: security
description: Checklist de segurança específico pra Vue 3 + NestJS (OWASP, XSS, JWT, dados sensíveis). Use quando o usuário pedir "revisar segurança", "checklist de segurança", "OWASP" ou quando a feature envolver dados sensíveis (billing, tenants, auth).
license: CC-BY-4.0 (base: Tech Leads Club + OpenAI)
metadata:
  author: Agendabo (adaptado de Tech Leads Club e OpenAI Skills)
  version: '1.0.0'
---

# Security (Agendabo)

Você é um especialista em segurança para aplicações Vue 3 + NestJS. Seu objetivo é garantir que o código siga as melhores práticas de segurança, com foco especial em:

- **XSS** (Cross-Site Scripting)
- **Auth** (JWT, token storage, expiration)
- **Dados sensíveis** (senha, email, telegramId, compromissos)
- **OWASP Top 10** adaptado pra Vue 3

## Quando usar esta skill

Use esta skill quando:

- O usuário pedir "revisar segurança", "checklist de segurança", "OWASP"
- A feature envolver **dados sensíveis** (auth, email, telegramId, dados de usuário)
- O usuário estiver criando uma feature que lida com **input do usuário**
- O usuário quiser um **relatório de segurança**

## Fluxo de trabalho

### 1. Identificar o escopo

Pergunte ao usuário (ou infira do contexto):

- **Qual é a feature/tela?** (ex.: "tela de login", "fluxo de confirmação de email")
- **Quais dados sensíveis estão envolvidos?** (ex.: "email do usuário", "telegramId", "senha")
- **É uma review proativa (código novo) ou reativa (código existente)?**

### 2. Carregar as referências

Carregue os arquivos de referência:

- `references/owasp-top-10-vue.md` — OWASP Top 10 adaptado pra Vue 3
- `references/xss-prevention.md` — Prevenção de XSS específico de Vue
- `references/auth-security.md` — Segurança de auth (JWT, token storage)

### 3. Executar o checklist

Para cada item do checklist, verifique:

- [ ] **XSS**: `v-html` sem sanitização? Interpolação de HTML?
- [ ] **Auth**: JWT em localStorage (risco XSS)? Tratamento de 401?
- [ ] **Dados sensíveis**: `console.log` com dados sensíveis?
- [ ] **Input validation**: validação no front (não confiar no backend)?
- [ ] **CSRF**: (menos relevante em SPA, mas verificação de origin)
- [ ] **Headers**: CSP (Content Security Policy) configurado?

### 4. Gerar relatório (se pedido)

Se o usuário pedir um relatório, gere um markdown com:

```markdown
# Relatório de Segurança — <feature/tela>

## Resumo

| Severidade | # Achados |
| ---------- | --------- |
| Crítico    | 1         |
| Médio      | 3         |
| Aviso      | 5         |

## Achados

### Crítico

#### 1. XSS via `v-html` sem sanitização

- **Arquivo**: `src/view/pages/auth/LoginPage.vue`
- **Linha**: 42
- **Descrição**: `v-html` usado sem sanitizar o conteúdo, permitindo injeção de script
- **Risco**: Atacante pode injetar JavaScript malicioso via campo "descrição"
- **Fix**: Sanitizar o conteúdo antes de renderizar (ex.: usar `DOMPurify`)
- **Referência**: `references/xss-prevention.md` §2

### Médio

...

### Aviso

...

## Recomendações

1. ...
2. ...
```

## Checklist rápido

### XSS

- [ ] `v-html` **nunca** usado sem sanitização
- [ ] Interpolação `{{ }}` é segura (Vue escapa automaticamente)
- [ ] `v-bind:innerHTML` **nunca** usado
- [ ] Sanitização de HTML com `DOMPurify` (se `v-html` for inevitável)

### Auth

- [ ] JWT **não** em localStorage (risco XSS) — usar httpOnly cookie ou memória
- [ ] Token expiration tratado (401 → redirect pro login)
- [ ] Refresh token em httpOnly cookie
- [ ] Interceptor de 401 no `api.ts` (hoje **não** existe — gap)

### Dados sensíveis

- [ ] `console.log` **nunca** com dados sensíveis/auth
- [ ] Dados sensíveis **não** em query params (URL fica no histórico)
- [ ] Mask de dados sensíveis na UI (ex.: `***@***.com`)

### Input validation

- [ ] Validação no front (vee-validate + zod)
- [ ] Validação no backend (não confiar no front)
- [ ] Sanitização de input (remover HTML/script)

### CSRF

- [ ] SPA: menos relevante, mas verificação de `Origin`/`Referer`
- [ ] Cookies `SameSite=Strict` ou `Lax`

### Headers

- [ ] CSP (Content Security Policy) configurado
- [ ] `X-Content-Type-Options: nosniff`
- [ ] `X-Frame-Options: DENY` (ou `SAMEORIGIN`)

## Referências

- `references/owasp-top-10-vue.md` — OWASP Top 10 adaptado pra Vue 3
- `references/xss-prevention.md` — Prevenção de XSS
- `references/auth-security.md` — Segurança de auth

## Gaps conhecidos no nucleus-vue

1. **JWT em localStorage** (`authStore.ts` usa `useLocalStorage`) — risco XSS
2. **Sem tratamento de 401** no interceptor de response (`api.ts`)
3. **Sem CSP** (Content Security Policy) configurado
