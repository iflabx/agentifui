SET search_path = public;

ALTER TABLE api_keys ADD COLUMN credential_version UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE agent_submissions ADD COLUMN credential_version UUID;

CREATE FUNCTION protect_pending_agent_credentials() RETURNS trigger LANGUAGE plpgsql
  SET search_path = public, pg_temp
  SET app.rls_system_actor = 'true'
AS $$
DECLARE
  application_id UUID;
  application_ids UUID[] := ARRAY[]::UUID[];
  removed_id UUID;
  replacement api_keys%ROWTYPE;
  before_version UUID;
  after_version UUID;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.provider_id, NEW.service_instance_id, NEW.user_id,
        NEW.key_value, NEW.is_default, NEW.created_at)
      IS NOT DISTINCT FROM
       (OLD.id, OLD.provider_id, OLD.service_instance_id, OLD.user_id,
        OLD.key_value, OLD.is_default, OLD.created_at)
    THEN
      NEW.credential_version := OLD.credential_version;
      RETURN NEW;
    END IF;
  END IF;

  IF TG_OP <> 'INSERT' THEN
    removed_id := OLD.id;
    IF OLD.is_default THEN
      application_ids := array_append(application_ids, OLD.service_instance_id);
    END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    NEW.credential_version := gen_random_uuid();
    replacement := NEW;
    IF NEW.is_default THEN
      application_ids := array_append(application_ids, NEW.service_instance_id);
    END IF;
  END IF;

  FOR application_id IN
    SELECT DISTINCT affected.id FROM unnest(application_ids) affected(id)
    WHERE affected.id IS NOT NULL ORDER BY affected.id
  LOOP
    IF NOT pg_try_advisory_xact_lock(hashtextextended('agent-app:' || application_id::text, 0))
    THEN RAISE EXCEPTION 'AGENT_CONFIG_BUSY' USING ERRCODE = '23514'; END IF;

    SELECT credential_version INTO before_version FROM api_keys
      WHERE service_instance_id = application_id AND is_default = TRUE
      ORDER BY created_at ASC, id ASC LIMIT 1;
    SELECT candidate.credential_version INTO after_version FROM (
      SELECT credential_version, created_at, id FROM api_keys
        WHERE service_instance_id = application_id AND is_default = TRUE
          AND (removed_id IS NULL OR id <> removed_id)
      UNION ALL
      SELECT replacement.credential_version, replacement.created_at, replacement.id
        WHERE replacement.service_instance_id = application_id AND replacement.is_default = TRUE
    ) candidate ORDER BY candidate.created_at ASC, candidate.id ASC LIMIT 1;

    IF before_version IS DISTINCT FROM after_version AND (
      EXISTS (SELECT 1 FROM agent_submissions WHERE service_instance_id = application_id
        AND state IN ('admitted','submitting','accepted','unknown'))
      OR EXISTS (SELECT 1 FROM backend_runs WHERE service_instance_id = application_id
        AND execution_status IN ('reserved','submitting','running','unknown'))
    ) THEN RAISE EXCEPTION 'AGENT_CONFIG_BUSY' USING ERRCODE = '23514'; END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER api_keys_protect_pending_agent_credentials
  BEFORE INSERT OR UPDATE OR DELETE ON api_keys
  FOR EACH ROW EXECUTE FUNCTION protect_pending_agent_credentials();

CREATE INDEX agent_submissions_unresolved_quota ON agent_submissions (quota_permission_id)
  WHERE quota_state = 'reserved' OR (quota_state = 'counted'
    AND state IN ('admitted','submitting','accepted','unknown'));

CREATE OR REPLACE FUNCTION protect_reserved_agent_quota() RETURNS trigger LANGUAGE plpgsql
  SET search_path = public, pg_temp
  SET app.rls_system_actor = 'true'
AS $$
DECLARE
  application_id UUID;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.group_id, NEW.service_instance_id) IS NOT DISTINCT FROM
       (OLD.id, OLD.group_id, OLD.service_instance_id)
      AND COALESCE(NEW.used_count, 0) >= COALESCE(OLD.used_count, 0)
    THEN RETURN NEW; END IF;
  END IF;

  FOR application_id IN
    SELECT DISTINCT affected.id FROM unnest(ARRAY[OLD.service_instance_id,
      CASE WHEN TG_OP = 'UPDATE' THEN NEW.service_instance_id ELSE NULL END]) affected(id)
    WHERE affected.id IS NOT NULL ORDER BY affected.id
  LOOP
    IF NOT pg_try_advisory_xact_lock(hashtextextended('agent-app:' || application_id::text, 0))
    THEN RAISE EXCEPTION 'AGENT_QUOTA_BUSY' USING ERRCODE = '23514'; END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM agent_submissions task WHERE task.quota_permission_id = OLD.id
      AND (task.quota_state = 'reserved' OR (task.quota_state = 'counted' AND (
        task.state IN ('admitted','submitting','accepted','unknown')
        OR EXISTS (SELECT 1 FROM backend_runs run WHERE run.id = task.run_id
          AND run.execution_status IN ('reserved','submitting','running','unknown'))
      )))
  ) THEN RAISE EXCEPTION 'AGENT_QUOTA_BUSY' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
