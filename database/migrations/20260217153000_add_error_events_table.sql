CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS error_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL,
  code text NOT NULL,
  source text NOT NULL,
  severity text NOT NULL,
  retryable boolean NOT NULL DEFAULT false,
  user_message text NOT NULL,
  developer_message text,
  http_status integer,
  method text,
  route text,
  request_id text NOT NULL,
  trace_id text,
  actor_user_id text,
  context_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT NOW(),
  last_seen_at timestamptz NOT NULL DEFAULT NOW(),
  occurrence_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT error_events_severity_check
    CHECK (severity IN ('info', 'warn', 'error', 'critical'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_error_events_fingerprint
  ON error_events(fingerprint);

CREATE INDEX IF NOT EXISTS idx_error_events_last_seen_at
  ON error_events(last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_error_events_code_last_seen_at
  ON error_events(code, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_error_events_source_last_seen_at
  ON error_events(source, last_seen_at DESC);
