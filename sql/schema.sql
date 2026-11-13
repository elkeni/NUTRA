BEGIN;
CREATE SCHEMA IF NOT EXISTS nutra;
CREATE TABLE IF NOT EXISTS nutra.users (
  id text PRIMARY KEY, email text UNIQUE NOT NULL, salt text NOT NULL,
  password text NOT NULL, state text NOT NULL, version integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS nutra.sessions (
  id text PRIMARY KEY, user_id text UNIQUE NOT NULL REFERENCES nutra.users(id) ON DELETE CASCADE,
  csrf text NOT NULL, expires bigint NOT NULL, last_seen bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS nutra.limits (key text PRIMARY KEY, count integer NOT NULL, expires bigint NOT NULL);
CREATE TABLE IF NOT EXISTS nutra.captcha_used (token text PRIMARY KEY, expires bigint NOT NULL);
CREATE TABLE IF NOT EXISTS nutra.cache (code text PRIMARY KEY, data text NOT NULL, expires bigint NOT NULL);
REVOKE ALL ON SCHEMA nutra FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA nutra FROM PUBLIC, anon, authenticated;
COMMIT;

