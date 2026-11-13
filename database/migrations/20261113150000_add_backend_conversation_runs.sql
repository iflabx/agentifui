SET search_path = public;

CREATE TABLE backend_conversations (
  conversation_id UUID PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  service_instance_id UUID NOT NULL REFERENCES service_instances(id) ON DELETE RESTRICT,
  backend_type TEXT NOT NULL DEFAULT 'langchain' CHECK (backend_type = 'langchain'),
  config_fingerprint TEXT NOT NULL CHECK (length(config_fingerprint) = 64),
  thread_id TEXT CHECK (length(thread_id) BETWEEN 1 AND 255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (service_instance_id, thread_id),
  UNIQUE (conversation_id, service_instance_id)
);

CREATE TABLE backend_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  service_instance_id UUID NOT NULL REFERENCES service_instances(id) ON DELETE RESTRICT,
  submission_id UUID NOT NULL,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  user_message_id UUID NOT NULL UNIQUE,
  native_run_id TEXT CHECK (length(native_run_id) BETWEEN 1 AND 255),
  execution_status TEXT NOT NULL DEFAULT 'reserved' CHECK (
    execution_status IN ('reserved', 'submitting', 'running', 'success', 'error', 'interrupted', 'unknown')
  ),
  persistence_status TEXT NOT NULL DEFAULT 'pending' CHECK (
    persistence_status IN ('pending', 'saved', 'failed')
  ),
  result JSONB CHECK (result IS NULL OR (
    jsonb_typeof(result) = 'object' AND octet_length(result::text) <= 1048576
  )),
  error_code TEXT CHECK (length(error_code) BETWEEN 1 AND 80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (conversation_id, service_instance_id)
    REFERENCES backend_conversations(conversation_id, service_instance_id) ON DELETE CASCADE,
  UNIQUE (user_id, service_instance_id, submission_id)
);

CREATE UNIQUE INDEX backend_runs_one_active_conversation
  ON backend_runs (conversation_id)
  WHERE execution_status IN ('reserved', 'submitting', 'running', 'unknown');
CREATE INDEX backend_runs_active_user ON backend_runs (user_id)
  WHERE execution_status IN ('reserved', 'submitting', 'running', 'unknown');
CREATE INDEX backend_runs_active_service ON backend_runs (service_instance_id)
  WHERE execution_status IN ('reserved', 'submitting', 'running', 'unknown');

ALTER TABLE backend_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE backend_conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE backend_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE backend_runs FORCE ROW LEVEL SECURITY;

CREATE POLICY backend_conversations_system_only ON backend_conversations
  FOR ALL USING (app_rls_system_actor()) WITH CHECK (app_rls_system_actor());
CREATE POLICY backend_runs_system_only ON backend_runs
  FOR ALL USING (app_rls_system_actor()) WITH CHECK (app_rls_system_actor());

CREATE FUNCTION protect_backend_conversation_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
    OR NEW.service_instance_id IS DISTINCT FROM OLD.service_instance_id
    OR NEW.backend_type IS DISTINCT FROM OLD.backend_type
    OR NEW.config_fingerprint IS DISTINCT FROM OLD.config_fingerprint
    OR (OLD.thread_id IS NOT NULL AND NEW.thread_id IS DISTINCT FROM OLD.thread_id)
  THEN
    RAISE EXCEPTION 'backend binding is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER backend_conversations_immutable_identity
  BEFORE UPDATE ON backend_conversations FOR EACH ROW
  EXECUTE FUNCTION protect_backend_conversation_identity();

CREATE FUNCTION protect_service_instance_backend_type()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(NEW.config->>'backend_type', 'dify') IS DISTINCT FROM
    COALESCE(OLD.config->>'backend_type', 'dify')
    AND EXISTS (
      SELECT 1 FROM conversations
      WHERE app_id IN (OLD.id::text, OLD.instance_id)
    )
  THEN
    RAISE EXCEPTION 'application backend has existing conversations' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER service_instances_protect_backend_type
  BEFORE UPDATE OF config ON service_instances FOR EACH ROW
  EXECUTE FUNCTION protect_service_instance_backend_type();
