-- Fase 9 — Observabilidade (spec observabilidade; ADR-0016/0017).
-- Duas tabelas de auditoria + papel admin + flag de rollout. Sem mudanca em
-- Appointment/outbox. Indices de FK declarados explicitamente (licao R4/gotcha:
-- FK sozinha nao indexa no Postgres).

-- CreateEnum
CREATE TYPE "BotEventType" AS ENUM ('flow_started', 'flow_completed', 'flow_aborted', 'intent_classified', 'llm_extraction', 'conflict_dialog', 'conflict_resolved', 'needs_review', 'cancelled', 'edit_applied', 'query_answered');

-- CreateEnum
CREATE TYPE "BotEventOutcome" AS ENUM ('ok', 'needs_review', 'conflict', 'error', 'aborted', 'parse_fail', 'low_confidence');

-- CreateEnum
CREATE TYPE "LlmCallPurpose" AS ENUM ('intent_classification', 'scheduling_extraction', 'reminder_extraction', 'query_interpretation', 'edit_interpretation', 'escalation');

-- CreateEnum
CREATE TYPE "LlmCallOutcome" AS ENUM ('ok', 'parse_fail', 'low_confidence', 'escalated', 'error');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "isAdmin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "observabilidadeEventosAtivo" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex (parcial — D-P7 do plano: no maximo UM admin no sistema ate
-- existir multi-admin (ADR novo quando doer). A corrida de dois "primeiros
-- usuarios" e resolvida AQUI: o segundo create falha P2002 e o service
-- re-tenta como nao-admin. `@@unique` do Prisma nao expressa WHERE parcial;
-- por isso a constraint vive SO aqui e o schema documenta — mesma licao do
-- digest do outbox e do hash de reset.)
CREATE UNIQUE INDEX "users_single_admin_unique"
ON "users"("isAdmin")
WHERE "isAdmin" = true;

-- CreateTable
CREATE TABLE "bot_events" (
    "id" UUID NOT NULL,
    "type" "BotEventType" NOT NULL,
    "stage" TEXT,
    "outcome" "BotEventOutcome" NOT NULL,
    "telegramIdHash" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" UUID NOT NULL,

    CONSTRAINT "bot_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_calls" (
    "id" UUID NOT NULL,
    "purpose" "LlmCallPurpose" NOT NULL,
    "outcome" "LlmCallOutcome" NOT NULL,
    "modelUsed" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "costUsdMicros" INTEGER,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" UUID,

    CONSTRAINT "llm_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bot_events_userId_createdAt_idx" ON "bot_events"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "bot_events_type_createdAt_idx" ON "bot_events"("type", "createdAt");

-- CreateIndex
CREATE INDEX "llm_calls_userId_createdAt_idx" ON "llm_calls"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "llm_calls_purpose_createdAt_idx" ON "llm_calls"("purpose", "createdAt");

-- AddForeignKey
ALTER TABLE "bot_events" ADD CONSTRAINT "bot_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Drop (para reverter esta migracao, rodar ANTES dos down-migrations antigos —
-- mesma licao de docs/gotchas.md):
--   ALTER TABLE "llm_calls" DROP CONSTRAINT "llm_calls_userId_fkey";
--   ALTER TABLE "bot_events" DROP CONSTRAINT "bot_events_userId_fkey";
--   DROP TABLE "llm_calls";
--   DROP TABLE "bot_events";
--   DROP INDEX "users_single_admin_unique";
--   ALTER TABLE "users" DROP COLUMN "observabilidadeEventosAtivo";
--   ALTER TABLE "users" DROP COLUMN "isAdmin";
--   DROP TYPE "LlmCallOutcome"; DROP TYPE "LlmCallPurpose";
--   DROP TYPE "BotEventOutcome"; DROP TYPE "BotEventType";
-- Apos qualquer `prisma migrate` que recrie a tabela users, RECRIAR o indice
-- parcial acima: o schema NAO declara @@unique de proposito.
