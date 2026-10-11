-- multi-dia (spec web/multi-dia-nas-visoes, review 2026-10-11): as cargas de conflito
-- filtram por `endsAt >= floor` e o SELECT ... FOR UPDATE do reschedule trava linhas
-- sob READ COMMITTED — com o filtro `endsAt` caindo pós-índice (Index Scan em
-- (userId, startsAt) + Filter), o LockRows alcança linhas que o filtro descartaria.
-- O índice em (userId, endsAt) qualifica o corte inferior no índice e encolhe o
-- conjunto travado na janela [floor, horizonte) da checagem.
CREATE INDEX IF NOT EXISTS appointments_userId_endsAt_idx ON "appointments" ("userId", "endsAt");
