-- Fase 5 (spec web decisoes 2 e 7): nome do usuario + flag do resumo diario.
-- Ambas nullable/default => seguras em banco com dados (usuarios existentes
-- seguem sem nome; resumo continua ligado para todos).
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "name" TEXT,
ADD COLUMN     "resumoDiarioAtivo" BOOLEAN NOT NULL DEFAULT true;