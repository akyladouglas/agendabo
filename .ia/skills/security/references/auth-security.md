# Segurança de Autenticação (JWT, Token Storage)

## O que é JWT?

**JWT (JSON Web Token)** é um token compacto e auto-contido que pode ser usado para transmitir informações de forma segura entre o cliente e o servidor.

## Estrutura de um JWT

```
Header.Payload.Signature
```

- **Header**: algoritmo de assinatura (ex.: `HS256`, `RS256`)
- **Payload**: claims (ex.: `user_id`, `roles`, `exp`)
- **Signature**: assinatura criptográfica (impede tampering)

## Como usar JWT no Vue 3

### 1. Storage de tokens

**Opção 1**: localStorage (simples, mas vulnerável a XSS)

```typescript
// RUIM: vulnerável a XSS
localStorage.setItem("accessToken", token);
```

**Opção 2**: httpOnly cookie (seguro, mas mais complexo)

```typescript
// BOM: httpOnly cookie (não acessível via JavaScript)
// Backend: set-cookie: accessToken=...; HttpOnly; Secure; SameSite=Strict
```

**Opção 3**: memória (mais seguro, mas perde o token ao recarregar)

```typescript
// BOM: memória (usa Pinia/Vuex)
const authStore = useAuthStore();
authStore.setToken(token); // armazenado em memória
```

### 2. Interceptor de request (injetar token)

```typescript
// src/app/services/api.ts
import axios from "axios";
import { useAuthStore } from "@/app/store/authStore";

const api = axios.create({
  baseURL: import.meta.env.VITE_NUCLEUS_API_URL,
});

api.interceptors.request.use((config) => {
  const authStore = useAuthStore();
  if (authStore.accessToken) {
    config.headers.Authorization = `Bearer ${authStore.accessToken}`;
  }
  return config;
});

export default api;
```

### 3. Interceptor de response (tratar 401)

```typescript
// src/app/services/api.ts
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // Token expirado: tentar refresh
      const authStore = useAuthStore();
      const refreshed = await authStore.refreshToken();
      if (refreshed) {
        // Tentar novamente
        return api(error.config);
      }
      // Refresh falhou: redirect pro login
      window.location.href = "/login";
    }
    return Promise.reject(error);
  },
);
```

### 4. Refresh token

**Fluxo**:

1. Usuário loga → recebe `accessToken` (curto, 15min) + `refreshToken` (longo, 7 dias)
2. `accessToken` expira → cliente usa `refreshToken` pra obter novo `accessToken`
3. `refreshToken` expira → usuário precisa logar de novo

**Storage**:

- `accessToken`: memória ou localStorage (curto, menos crítico)
- `refreshToken`: httpOnly cookie (longo, crítico)

## Checklist de Auth

- [ ] JWT com **expiration curta** (ex.: 15min)
- [ ] `refreshToken` em **httpOnly cookie**
- [ ] **Interceptor de 401** no `api.ts`
- [ ] **Rate limiting** no login (ex.: 5 tentativas/min)
- [ ] **MFA** (Multi-Factor Authentication)
- [ ] **Logout** limpa tokens (memória + cookie)

## Gaps conhecidos no nucleus-vue

1. **JWT em localStorage** (`authStore.ts` usa `useLocalStorage`) — risco XSS
2. **Sem tratamento de 401** no interceptor de response (`api.ts`)
3. **Sem refresh token** (token único)

## Mitigações sugeridas

1. **Mover JWT pra memória** (Pinia) + refresh token em httpOnly cookie
2. **Adicionar interceptor de 401** no `api.ts`
3. **Implementar refresh token** (backend + front)

## Referências

- [OWASP JWT Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html)
- [JWT Best Practices](https://datatracker.ietf.org/doc/html/rfc8725)
- [Vue.js Auth](https://pinia.vuejs.org/)
