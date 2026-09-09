-- Trigram search for the user directory.
--
-- The settings screen's account search folds (name || username || email) and
-- matches with LIKE '%...%' -- the exact shape the students' and professors'
-- registers had before their generated columns and GIN indexes, and the exact
-- cost too: a sequential scan of the identity table per keystroke. The
-- directory is small today and is exactly the table that does not stay small.
--
-- The expression index mirrors the query's expression character for character
-- (same coalesces, same separators, same fold function), because a GIN index
-- only answers a predicate written the same way it indexes. If the query in
-- user-queries.ts ever changes shape, this index changes with it.
--
-- Idempotent, like every file in this phase: IF NOT EXISTS, so the whole set
-- re-applies on each migrate.

CREATE INDEX IF NOT EXISTS users_search_idx
  ON "user"
  USING gin (app.fold_text(
    coalesce(name, '') || ' ' ||
    coalesce(username, '') || ' ' ||
    coalesce(email, '')
  ) gin_trgm_ops);
