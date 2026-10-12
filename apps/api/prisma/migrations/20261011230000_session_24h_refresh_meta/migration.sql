-- sessão-24h (spec auth/sessao-24h-e-gestao-de-sessoes): o refresh token passa a
-- carregar a metadados da sessão — loginAt (início da cadeia, herdado a cada rotação),
-- ip e userAgent (para a listagem "Suas sessões ativas" e revogação das outras).
-- Preservação suave: os refresh_tokens EXISTENTES ganham loginAt = agora da migration
-- (DEFAULT CURRENT_TIMESTAMP) e portanto morrem no teto de 24h após o deploy — sem
-- revogação em massa, ninguém é deslogado imediatamente, só no vencimento natural.
ALTER TABLE "refresh_tokens"
  ADD COLUMN "loginAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "ip" TEXT,
  ADD COLUMN "userAgent" TEXT;
