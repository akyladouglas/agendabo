-- Fase 9 review (P2): tokens de cache no Anthropic sao cobrados a preco
-- diferenciado (cache read = 10% do input). Colunas NULLaveis: NULL = SDK nao
-- informou (honesto), != null = contagem real. Estimativa de custo segue
-- simplificada (precos cheios) ate o humano definir a tabela oficial.
-- ALTER TABLE ... ADD COLUMN sem DEFAULT e O(1) no Postgres 11+.
ALTER TABLE "llm_calls" ADD COLUMN "cache_read_input_tokens" INTEGER;
ALTER TABLE "llm_calls" ADD COLUMN "cache_creation_input_tokens" INTEGER;
