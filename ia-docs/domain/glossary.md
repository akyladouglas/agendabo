# Glossário — Agendabô

Vocabulário ubíquo. Código, specs e docs usam exatamente estes nomes.

| Termo                                       | Definição                                                                                                                          | Onde vive                                  |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **Compromisso** (Appointment)               | Intervalo `[startsAt, endsAt)` no tempo UTC, com título, notas, status e origem                                                    | `appointments`                             |
| **Candidato a compromisso**                 | Extração do LLM (título+início+duração+confiança) ainda não validada                                                               | `contracts/llm`                            |
| **Conflito**                                | Sobreposição de dois compromissos `confirmed` futuros; encostado não conta                                                         | `schedule-core/conflicts`                  |
| **Regra de lembrete** (NotificationRule)    | Descritor parametrizável: `none`, `before_hours`, `before_days`, `countdown_3_2_1`                                                 | `schedule-core/notifications`              |
| **Disparo** (Trigger)                       | Instante UTC calculado a partir de `startsAt` + regras                                                                             | `computeTriggers`                          |
| **Outbox**                                  | Linha do disparo em Postgres (fonte de verdade); o job BullMQ só carrega o id                                                      | `NotificationOutbox`                       |
| **Resumo diário**                           | Mensagem com compromissos do dia civil + lembretes que vencem hoje, na hora/tz do usuário                                          | módulo `notifications`                     |
| **Revisão** (needs_review)                  | Compromisso que o LLM não entendeu com confiança; corrigível na web (3.3)                                                          | status `needs_review`                      |
| **Código de verificação**                   | 6 dígitos, hash sha256, TTL 15min, máx. 3 reenvios/30min                                                                           | `VerificationCode`                         |
| **Dia civil do usuário**                    | `[00:00, 24:00)` no timezone do usuário                                                                                            | `schedule-core/dates`                      |
| **Conta confirmada**                        | Email confirmado ⇒ o bot passa a atender o telegramId                                                                              | `emailConfirmedAt`                         |
| **Vínculo compartilhado** (SharedAgenda)    | Par ordenado dono→convidado, papel fixo `read`, status `pending/active/revoked`; dois sentidos independentes                       | `shared_agendas` (módulo `shared-agendas`) |
| **Convite de agenda**                       | Token opaco (sha256, TTL 24h, quota 3/30min por par) por e-mail; aceite só pela sessão do convidado; 202 uniforme anti-enumeration | `shared-agendas/invite`                    |
| **Agenda emprestada**                       | Leitura read-only dos compromissos `confirmed` do dono pelo convidado, no fuso do CONVIDADO; sem `rawText`/`reviewReason`          | `GET /appointments?owner=`                 |
| **Evento de auditoria de compartilhamento** | Traço de convite/acesso/negação/revogação (11 kinds, metadata zod `.strict()`, nunca-lança)                                        | `shared_agenda_audit_events`               |
