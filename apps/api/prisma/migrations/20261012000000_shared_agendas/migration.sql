-- Compartilhamento de agenda entre usuarios (par, somente leitura) — spec
-- .ia/specs/compartilhamento/compartilhamento-agenda-par.spec.md (blocos A e F.4);
-- decisoes D11/D13 do plano ia-docs/plans/compartilhamento-agenda-par.plan.md.
-- Status/role vivem como varchar + CHECK (nao enum Prisma — decisao D11; a borda
-- e o zod dos contracts). A constraint real do token (unidade PARCIAL entre
-- pendentes) vive SO aqui: @@unique do Prisma nao expressa WHERE parcial — mesma
-- licao do digest do outbox, do password_reset_kind e do admin (F.6).

-- CreateTable
CREATE TABLE "shared_agendas" (
    "id" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'read',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "tokenHash" TEXT,
    "inviteSentAt" TIMESTAMP(3),
    "inviteExpiresAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" UUID NOT NULL,
    "guestId" UUID NOT NULL,

    CONSTRAINT "shared_agendas_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shared_agendas_status_check" CHECK ("status" IN ('pending', 'active', 'revoked')),
    CONSTRAINT "shared_agendas_role_check" CHECK ("role" IN ('read'))
);

-- CreateTable
CREATE TABLE "shared_agenda_audit_events" (
    "id" UUID NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" UUID,
    "ownerId" UUID NOT NULL,
    "guestId" UUID,
    "kind" TEXT NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "shared_agenda_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (parcial — spec F.2: busca do aceite e por hash, entao o hash do
-- token precisa ser unico; so entre linhas `pending` (convite substituido/aceito/
-- revogado libera o hash para novo convite do MESMO par na mesma linha — D13).
-- `@@unique` do Prisma nao expressa WHERE parcial; por isso a constraint vive SO
-- aqui e o schema documenta (licao F.6).)
CREATE UNIQUE INDEX "shared_agendas_tokenHash_pending_key"
ON "shared_agendas"("tokenHash")
WHERE "status" = 'pending' AND "tokenHash" IS NOT NULL;

-- CreateIndex
CREATE INDEX "shared_agendas_ownerId_idx" ON "shared_agendas"("ownerId");

-- CreateIndex
CREATE INDEX "shared_agendas_guestId_idx" ON "shared_agendas"("guestId");

-- CreateIndex
CREATE INDEX "shared_agendas_ownerId_guestId_idx" ON "shared_agendas"("ownerId", "guestId");

-- CreateIndex
CREATE INDEX "shared_agendas_tokenHash_idx" ON "shared_agendas"("tokenHash");

-- CreateIndex ("vinculos ativos recebidos": seletor da web, alvo do bot, secoes do digest)
CREATE INDEX "shared_agendas_guestId_status_idx" ON "shared_agendas"("guestId", "status");

-- CreateIndex
CREATE INDEX "shared_agenda_audit_events_ownerId_occurredAt_idx" ON "shared_agenda_audit_events"("ownerId", "occurredAt");

-- CreateIndex
CREATE INDEX "shared_agenda_audit_events_guestId_occurredAt_idx" ON "shared_agenda_audit_events"("guestId", "occurredAt");

-- CreateIndex
CREATE INDEX "shared_agenda_audit_events_actorId_occurredAt_idx" ON "shared_agenda_audit_events"("actorId", "occurredAt");

-- CreateIndex
CREATE INDEX "shared_agenda_audit_events_kind_occurredAt_idx" ON "shared_agenda_audit_events"("kind", "occurredAt");

-- AddForeignKey
ALTER TABLE "shared_agendas" ADD CONSTRAINT "shared_agendas_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_agendas" ADD CONSTRAINT "shared_agendas_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_agenda_audit_events" ADD CONSTRAINT "shared_agenda_audit_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_agenda_audit_events" ADD CONSTRAINT "shared_agenda_audit_events_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_agenda_audit_events" ADD CONSTRAINT "shared_agenda_audit_events_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Drop (para reverter esta migracao):
--   ALTER TABLE "shared_agenda_audit_events" DROP CONSTRAINT "shared_agenda_audit_events_guestId_fkey";
--   ALTER TABLE "shared_agenda_audit_events" DROP CONSTRAINT "shared_agenda_audit_events_ownerId_fkey";
--   ALTER TABLE "shared_agenda_audit_events" DROP CONSTRAINT "shared_agenda_audit_events_actorId_fkey";
--   ALTER TABLE "shared_agendas" DROP CONSTRAINT "shared_agendas_guestId_fkey";
--   ALTER TABLE "shared_agendas" DROP CONSTRAINT "shared_agendas_ownerId_fkey";
--   DROP TABLE "shared_agenda_audit_events";
--   DROP TABLE "shared_agendas";
-- Apos qualquer `prisma migrate` que recrie shared_agendas, RECRIAR o indice
-- parcial "shared_agendas_tokenHash_pending_key" acima: o schema NAO declara
-- @@unique de proposito (colaria nos tokens substituidos/revogados — F.6).
