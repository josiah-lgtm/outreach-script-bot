-- Outreach Script Bot — self-hosted Postgres schema.
-- Faithful port of the old Supabase-Storage layout: the whole app config lives in
-- ONE jsonb document with a monotonic `rev` used for compare-and-swap (CAS); the
-- small server-side docs (team users, usage metering, the admin-set Anthropic key
-- override, login-attempt throttle) live in a tiny key/value table.
--
-- This file runs once via docker-entrypoint-initdb.d on first `docker compose up`.

CREATE TABLE IF NOT EXISTS config (
  id   integer PRIMARY KEY DEFAULT 1,
  data jsonb   NOT NULL,
  rev  integer NOT NULL DEFAULT 0,
  -- single-row table: there is exactly one config document
  CONSTRAINT config_singleton CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS kv (
  key   text  PRIMARY KEY,           -- 'users' | 'usage' | 'secrets' | 'login-attempts'
  value jsonb NOT NULL
);
