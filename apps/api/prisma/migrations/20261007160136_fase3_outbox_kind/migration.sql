/*
  Warnings:

  - WIP: ambiente de desenvolvimento com outbox vazio. Em banco com dados reais,
    preencha `userId` das linhas existentes via appointment antes do ADD NOT NULL
    (UPDATE o SET userId = appointments.userId FROM appointments WHERE ...).

  - A coluna userId e adicionada sem default; a migacao assume outbox vazio (dev).
*/
-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('reminder', 'daily_digest');

-- AlterEnum
ALTER TYPE "NotificationOutboxStatus" ADD VALUE 'cancelled';

-- AlterTable
ALTER TABLE "notification_outbox" ADD COLUMN     "kind" "NotificationKind" NOT NULL DEFAULT 'reminder',
ADD COLUMN     "userId" UUID NOT NULL,
ALTER COLUMN "appointmentId" DROP NOT NULL,
ALTER COLUMN "ruleType" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "notification_outbox_userId_kind_firesAt_idx" ON "notification_outbox"("userId", "kind", "firesAt");

-- CreateIndex (parcial — idempotencia do resumo diario, spec regra 16/D6 do plano:
-- exatamente 1 linha digest por (usuario, dia). `@@unique` do Prisma nao expressa
-- WHERE parcial; por isso a constraint vive SO aqui e o schema documenta.)
CREATE UNIQUE INDEX "notification_outbox_digest_unique"
ON "notification_outbox"("userId", "kind", "firesAt")
WHERE "appointmentId" IS NULL;

-- AddForeignKey
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
