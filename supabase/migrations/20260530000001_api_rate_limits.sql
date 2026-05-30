-- PRD-001 P1.6 Phase 2: per-user API rate limiting.
--
-- Tracks request counts per (user, endpoint, 1-minute window). The API
-- server uses this table to enforce limits via the increment_api_rate_limit
-- RPC so it never exceeds Anthropic spend. All writes use the service-role
-- key; no authenticated/anon INSERT/UPDATE policies are needed or granted.
--
-- Limits:
--   /api/analyze-recipe       20 req/min/user  (Sonnet 4.6 — most expensive)
--   all other /api/* endpoints 60 req/min/user  (Haiku 4.5 — cheap)
--
-- TODO (follow-up): add a nightly Supabase scheduled function that runs
--   DELETE FROM api_rate_limits WHERE window_start < now() - interval '1 day';
-- to keep the table small. With 2 users × 5 endpoints × minutes/day the
-- table stays tiny without cleanup, but the cleanup is still good hygiene.

CREATE TABLE IF NOT EXISTS api_rate_limits (
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint     text        NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, endpoint, window_start)
);

ALTER TABLE api_rate_limits ENABLE ROW LEVEL SECURITY;
-- No anon or authenticated policies: default-deny for all non-service roles.
-- The API server uses the service-role key (which bypasses RLS) to read/write.

-- Index for the cleanup cron: efficiently delete expired windows by time.
CREATE INDEX IF NOT EXISTS api_rate_limits_window_idx
  ON api_rate_limits (window_start);

-- Atomic upsert + increment. Returns the new count so the caller can
-- compare against the per-endpoint limit in a single round-trip.
--
-- Uses LANGUAGE sql so Postgres can inline it; no PL/pgSQL overhead.
-- No SECURITY DEFINER needed — called by the service-role client which
-- already bypasses RLS.
CREATE OR REPLACE FUNCTION increment_api_rate_limit(
  p_user_id      uuid,
  p_endpoint     text,
  p_window_start timestamptz
) RETURNS integer
LANGUAGE sql
AS $$
  INSERT INTO api_rate_limits (user_id, endpoint, window_start, count)
  VALUES (p_user_id, p_endpoint, p_window_start, 1)
  ON CONFLICT (user_id, endpoint, window_start)
  DO UPDATE SET count = api_rate_limits.count + 1
  RETURNING count;
$$;
