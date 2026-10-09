-- Review R4 (perf): FK de appointment nas tabelas de notificacao sem indice
-- causava seq-scan dentro da tx do reschedule (rulesOf + invalidateForAppointment).
CREATE INDEX IF NOT EXISTS notification_rules_appointmentId_idx ON "notification_rules" ("appointmentId");
CREATE INDEX IF NOT EXISTS notification_outbox_appointmentId_idx ON "notification_outbox" ("appointmentId");