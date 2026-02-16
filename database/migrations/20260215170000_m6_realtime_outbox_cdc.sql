-- M6 Realtime hardening: DB outbox + trigger-based CDC.
-- Purpose:
-- 1. Capture table changes even when writes bypass application code.
-- 2. Decouple DB commit from realtime broker publish reliability.

CREATE TABLE IF NOT EXISTS realtime_outbox_events (
  id BIGSERIAL PRIMARY KEY,
  schema_name TEXT NOT NULL DEFAULT 'public',
  table_name TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('INSERT', 'UPDATE', 'DELETE')),
  commit_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  new_row JSONB,
  old_row JSONB,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_realtime_outbox_events_available_at
  ON realtime_outbox_events (available_at, id);

CREATE OR REPLACE FUNCTION enqueue_realtime_outbox_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  inserted_id BIGINT;
BEGIN
  INSERT INTO realtime_outbox_events (
    schema_name,
    table_name,
    event_type,
    commit_timestamp,
    new_row,
    old_row
  )
  VALUES (
    TG_TABLE_SCHEMA,
    TG_TABLE_NAME,
    TG_OP,
    NOW(),
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END
  )
  RETURNING id INTO inserted_id;

  PERFORM pg_notify('agentifui_realtime_outbox', inserted_id::TEXT);

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trigger_realtime_outbox_profiles ON profiles;
CREATE TRIGGER trigger_realtime_outbox_profiles
AFTER INSERT OR UPDATE OR DELETE ON profiles
FOR EACH ROW
EXECUTE FUNCTION enqueue_realtime_outbox_event();

DROP TRIGGER IF EXISTS trigger_realtime_outbox_conversations ON conversations;
CREATE TRIGGER trigger_realtime_outbox_conversations
AFTER INSERT OR UPDATE OR DELETE ON conversations
FOR EACH ROW
EXECUTE FUNCTION enqueue_realtime_outbox_event();

DROP TRIGGER IF EXISTS trigger_realtime_outbox_messages ON messages;
CREATE TRIGGER trigger_realtime_outbox_messages
AFTER INSERT OR UPDATE OR DELETE ON messages
FOR EACH ROW
EXECUTE FUNCTION enqueue_realtime_outbox_event();

DROP TRIGGER IF EXISTS trigger_realtime_outbox_providers ON providers;
CREATE TRIGGER trigger_realtime_outbox_providers
AFTER INSERT OR UPDATE OR DELETE ON providers
FOR EACH ROW
EXECUTE FUNCTION enqueue_realtime_outbox_event();

DROP TRIGGER IF EXISTS trigger_realtime_outbox_service_instances ON service_instances;
CREATE TRIGGER trigger_realtime_outbox_service_instances
AFTER INSERT OR UPDATE OR DELETE ON service_instances
FOR EACH ROW
EXECUTE FUNCTION enqueue_realtime_outbox_event();

DROP TRIGGER IF EXISTS trigger_realtime_outbox_api_keys ON api_keys;
CREATE TRIGGER trigger_realtime_outbox_api_keys
AFTER INSERT OR UPDATE OR DELETE ON api_keys
FOR EACH ROW
EXECUTE FUNCTION enqueue_realtime_outbox_event();
