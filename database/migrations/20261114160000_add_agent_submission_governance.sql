SET search_path = public;

CREATE TABLE agent_submissions (
  root_task_id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  service_instance_id UUID NOT NULL REFERENCES service_instances(id) ON DELETE CASCADE,
  submission_id UUID NOT NULL,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  target_fingerprint TEXT NOT NULL CHECK (length(target_fingerprint) = 64),
  backend_type TEXT NOT NULL CHECK (backend_type IN ('dify', 'langchain')),
  state TEXT NOT NULL DEFAULT 'registered' CHECK (state IN (
    'registered', 'admitted', 'submitting', 'accepted', 'finished', 'rejected', 'unknown'
  )),
  quota_permission_id UUID REFERENCES group_app_permissions(id) ON DELETE SET NULL,
  quota_state TEXT NOT NULL DEFAULT 'none' CHECK (quota_state IN ('none', 'exempt', 'reserved', 'counted', 'released')),
  run_id UUID UNIQUE REFERENCES backend_runs(id) ON DELETE SET NULL,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, service_instance_id, submission_id),
  CHECK (quota_state <> 'reserved' OR quota_permission_id IS NOT NULL)
);

CREATE INDEX agent_submissions_pending_quota ON agent_submissions (quota_permission_id)
  WHERE quota_state = 'reserved';
CREATE INDEX agent_submissions_active ON agent_submissions (user_id, service_instance_id)
  WHERE state IN ('admitted', 'submitting', 'accepted', 'unknown');
CREATE INDEX agent_submissions_registered ON agent_submissions (user_id, created_at)
  WHERE state = 'registered';

ALTER TABLE agent_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_submissions FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_submissions_system_only ON agent_submissions
  FOR ALL USING (app_rls_system_actor()) WITH CHECK (app_rls_system_actor());

CREATE FUNCTION protect_pending_agent_configuration() RETURNS trigger LANGUAGE plpgsql
  SET search_path = public, pg_temp
  SET app.rls_system_actor = 'true'
AS $$
DECLARE
  application_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'providers' THEN
    IF NEW.base_url IS NOT DISTINCT FROM OLD.base_url THEN RETURN NEW; END IF;
    FOR application_id IN SELECT si.id FROM service_instances si WHERE si.provider_id = OLD.id ORDER BY si.id LOOP
      IF NOT pg_try_advisory_xact_lock(hashtextextended('agent-app:' || application_id::text, 0))
      THEN RAISE EXCEPTION 'AGENT_CONFIG_BUSY' USING ERRCODE = '23514'; END IF;
    END LOOP;
    IF EXISTS (
      SELECT 1 FROM agent_submissions task JOIN service_instances si ON si.id = task.service_instance_id
      WHERE si.provider_id = OLD.id AND task.state IN ('admitted','submitting','accepted','unknown')
    ) OR EXISTS (
      SELECT 1 FROM backend_runs run JOIN service_instances si ON si.id = run.service_instance_id
      WHERE si.provider_id = OLD.id AND run.execution_status IN ('reserved','submitting','running','unknown')
    ) THEN RAISE EXCEPTION 'AGENT_CONFIG_BUSY' USING ERRCODE = '23514'; END IF;
  ELSE
    IF (COALESCE(NEW.config->>'backend_type', 'dify'), NEW.config->'langchain'->>'assistant_id', NEW.instance_id, NEW.provider_id)
      IS NOT DISTINCT FROM (COALESCE(OLD.config->>'backend_type', 'dify'), OLD.config->'langchain'->>'assistant_id', OLD.instance_id, OLD.provider_id)
    THEN RETURN NEW; END IF;
    IF NOT pg_try_advisory_xact_lock(hashtextextended('agent-app:' || OLD.id::text, 0))
    THEN RAISE EXCEPTION 'AGENT_CONFIG_BUSY' USING ERRCODE = '23514'; END IF;
    IF EXISTS (SELECT 1 FROM agent_submissions WHERE service_instance_id = OLD.id AND state IN ('admitted','submitting','accepted','unknown'))
      OR EXISTS (SELECT 1 FROM backend_runs WHERE service_instance_id = OLD.id AND execution_status IN ('reserved','submitting','running','unknown'))
    THEN RAISE EXCEPTION 'AGENT_CONFIG_BUSY' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER providers_protect_pending_agent_config BEFORE UPDATE ON providers
  FOR EACH ROW EXECUTE FUNCTION protect_pending_agent_configuration();
CREATE TRIGGER service_instances_protect_pending_agent_config BEFORE UPDATE ON service_instances
  FOR EACH ROW EXECUTE FUNCTION protect_pending_agent_configuration();

CREATE FUNCTION protect_reserved_agent_quota() RETURNS trigger LANGUAGE plpgsql
  SET search_path = public, pg_temp
  SET app.rls_system_actor = 'true'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM agent_submissions WHERE quota_permission_id = OLD.id AND quota_state = 'reserved')
    THEN RAISE EXCEPTION 'AGENT_QUOTA_BUSY' USING ERRCODE = '23514'; END IF;
    RETURN OLD;
  END IF;
  IF NEW.used_count IS DISTINCT FROM OLD.used_count AND NEW.used_count < OLD.used_count
    AND EXISTS (SELECT 1 FROM agent_submissions WHERE quota_permission_id = OLD.id AND quota_state = 'reserved')
  THEN RAISE EXCEPTION 'AGENT_QUOTA_BUSY' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER group_app_permissions_protect_reserved_quota BEFORE UPDATE OR DELETE ON group_app_permissions
  FOR EACH ROW EXECUTE FUNCTION protect_reserved_agent_quota();

CREATE FUNCTION finish_legacy_agent_submission() RETURNS trigger LANGUAGE plpgsql
  SET search_path = public, pg_temp
  SET app.rls_system_actor = 'true'
AS $$
BEGIN
  UPDATE agent_submissions SET state = 'finished', updated_at = NOW()
    WHERE run_id = NEW.id AND user_id = NEW.user_id AND service_instance_id = NEW.service_instance_id
      AND backend_type = 'langchain' AND quota_state = 'none' AND state = 'unknown';
  RETURN NEW;
END;
$$;
CREATE TRIGGER backend_runs_finish_legacy_agent_submission AFTER UPDATE OF execution_status ON backend_runs
  FOR EACH ROW WHEN (NEW.execution_status IN ('success','error','interrupted'))
  EXECUTE FUNCTION finish_legacy_agent_submission();

CREATE FUNCTION protect_active_agent_deletion() RETURNS trigger LANGUAGE plpgsql
  SET search_path = public, pg_temp
  SET app.rls_system_actor = 'true'
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM agent_submissions task
    WHERE task.state IN ('admitted','submitting','accepted','unknown') AND (
      (TG_TABLE_NAME = 'profiles' AND task.user_id = OLD.id) OR
      (TG_TABLE_NAME = 'service_instances' AND task.service_instance_id = OLD.id) OR
      (TG_TABLE_NAME = 'backend_runs' AND task.run_id = OLD.id)
    )
  ) THEN RAISE EXCEPTION 'AGENT_TASK_BUSY' USING ERRCODE = '23514'; END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER profiles_protect_active_agent_deletion BEFORE DELETE ON profiles
  FOR EACH ROW EXECUTE FUNCTION protect_active_agent_deletion();
CREATE TRIGGER service_instances_protect_active_agent_deletion BEFORE DELETE ON service_instances
  FOR EACH ROW EXECUTE FUNCTION protect_active_agent_deletion();
CREATE TRIGGER backend_runs_protect_active_agent_deletion BEFORE DELETE ON backend_runs
  FOR EACH ROW EXECUTE FUNCTION protect_active_agent_deletion();
