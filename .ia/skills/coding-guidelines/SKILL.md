---
name: coding-guidelines
description: Exemplos concretos de "bom/ruim" por camada do Agendabô (NestJS + Vue + schedule-core). Use quando o usuário perguntar "como escrever um service?", "exemplo de controller?", "padrão de query/mutation na web?", ou quiser comparar código com o padrão do projeto.
metadata:
  author: Agendabo (adaptado de Tech Leads Club)
  version: "1.0.0"
---

# Coding Guidelines (Agendabô)

Exemplos "bom/ruim" por camada, extraídos do código real do projeto. Ao citar, aponte a
regra (`.ia/rules/*.md`) violada/cumprida.

## Camada e exemplo canônico (arquivo de referência do repo)

| Camada                                       | Exemplo bom                                                    |
| -------------------------------------------- | -------------------------------------------------------------- |
| Controller Nest (fina, zod, erro→HTTP)       | `apps/api/src/modules/appointments/appointments.controller.ts` |
| Service com regra de application             | `apps/api/src/modules/appointments/appointments.service.ts`    |
| Domínio puro com teste co-localizado         | `packages/schedule-core/src/conflicts.ts`                      |
| Contrato zod compartilhado                   | `packages/contracts/src/api/appointments.ts`                   |
| Service de domínio (quota, relógio injetado) | `apps/api/src/modules/auth/verification-code.ts`               |
| Adapter de SDK (interface mínima)            | `apps/api/src/modules/ai/anthropic-messages-client.ts`         |
| Store pinia composition                      | `apps/web/src/app/store/authStore.ts`                          |
| Primitivo UI burro                           | `apps/web/src/view/components/ui/button/Button.vue`            |

## Amostra de bom/ruim

**Regra de domínio — conflito**

```ts
// RUIM: relógio solto + regra no service da API (im-testável sem Nest)
const conflito = appointments.some(
  (a) =>
    input.startsAt < a.endsAt &&
    a.startsAt < input.endsAt &&
    a.endsAt > new Date(),
);

// BOM: decisão em schedule-core, `now` injetável, teste unitário puro
import { findConflict } from "@agendabo/schedule-core";
const result = findConflict(input, existing, {
  now: this.clock.now(),
  ignoreId,
});
```

**Controller** — ruím: `if (!body.title)` + `prisma.appointment.create` dentro do controller.
Bom: `appointmentInputSchema.parse(body)` → `this.service.create(user.id, body)` → catch de
`AppointmentConflictError` vira 409 com o compromisso que choca.

**Web query** — ruim: `axios.get('/appointments')` no componente. Bom: composable
`useAppointments(from, to)` lendo `qk.appointments(from, to)`; mutação invalida `qk`.

**Datas** — ruim: salvar "2026-10-08T14:00" local no banco. Bom: borda converte para UTC
com o timezone do usuário (ADR-001); exibição reconverte.

## Convenções de nome

- Schema zod: `xSchema`; tipo inferido: `X` (`appointmentInputSchema` / `AppointmentInput`).
- Erro de domínio: classe própria `XxxError` no módulo (service lança, controller mapeia).
- Tabela Prisma: `@@map("snake_case")`; model singular PascalCase.
- Query key: só via `qk.*`; service web em `app/services/<dominio>/.`; página `XPage.vue`.
