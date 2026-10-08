-- "Esqueci a senha" (spec esqueci-a-senha, decisao D1): a tabela verification_codes
-- passa a guardar tbem o token do magic link de reset, diferenciado por `kind`.

-- CreateEnum
CREATE TYPE "VerificationKind" AS ENUM ('email_verification', 'password_reset');

-- AlterTable
ALTER TABLE "verification_codes" ADD COLUMN     "kind" "VerificationKind" NOT NULL DEFAULT 'email_verification';

-- CreateIndex
CREATE INDEX "verification_codes_codeHash_idx" ON "verification_codes"("codeHash");

-- CreateIndex (parcial — uso unico do token de reset, spec regra 6: a busca do
-- reset e por hash, entao o hash de token precisa ser unico. So entre linhas
-- password_reset: codigos de 6 digitos tem espaco de 1e6 e colidem em escala.
-- `@@unique` do Prisma nao expressa WHERE parcial; por isso a constraint vive
-- SO aqui e o schema documenta — mesma licao do indice parcial do digest em
-- fase3_outbox_kind.)
CREATE UNIQUE INDEX "verification_codes_reset_hash_unique"
ON "verification_codes"("codeHash")
WHERE "kind" = 'password_reset';

-- Drop (para reverter esta migracao, rodar ANTES dos down-migrations antigos que
-- dao DROP TYPE em outros enums — mesma licao de docs/gotchas.md):
--   DROP INDEX "verification_codes_reset_hash_unique";
--   ALTER TABLE "verification_codes" DROP COLUMN "kind";
--   DROP TYPE "VerificationKind";
-- Apos qualquer `prisma migrate` que recrie a tabela, RECRIAR o indice parcial
-- acima: o schema NAO declara @@unique total de proposito (colaria nos codigos
-- de 6 digitos).
