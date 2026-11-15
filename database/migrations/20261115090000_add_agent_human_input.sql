SET search_path = public;

ALTER TABLE backend_conversations ADD COLUMN human_input BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE backend_conversations binding SET human_input = TRUE FROM service_instances application
  WHERE binding.service_instance_id = application.id AND binding.backend_type = 'langchain'
    AND application.config->'langchain'->'human_input' = 'true'::jsonb;
ALTER TABLE backend_runs ADD COLUMN run_kind TEXT NOT NULL DEFAULT 'turn';
ALTER TABLE backend_runs ADD COLUMN root_run_id UUID;
ALTER TABLE backend_runs ADD COLUMN sequence_anchor INTEGER CHECK (sequence_anchor >= -1);
UPDATE backend_runs SET root_run_id = id;
ALTER TABLE backend_runs ALTER COLUMN root_run_id SET NOT NULL;
ALTER TABLE backend_runs ALTER COLUMN user_message_id DROP NOT NULL;
ALTER TABLE backend_runs DROP CONSTRAINT backend_runs_execution_status_check;
ALTER TABLE backend_runs ADD CONSTRAINT backend_runs_execution_status_check CHECK (
  execution_status IN ('reserved','submitting','running','success','error','interrupted','unknown','waiting')
);
ALTER TABLE backend_runs ADD CONSTRAINT backend_runs_kind_message_check CHECK (
  (run_kind = 'turn' AND user_message_id IS NOT NULL AND root_run_id = id)
  OR (run_kind = 'resume' AND user_message_id IS NULL AND root_run_id <> id AND sequence_anchor IS NOT NULL)
);
ALTER TABLE backend_runs ADD CONSTRAINT backend_runs_root_identity UNIQUE (id, conversation_id, user_id, service_instance_id);
ALTER TABLE backend_runs ADD CONSTRAINT backend_runs_root_fk
  FOREIGN KEY (root_run_id, conversation_id, user_id, service_instance_id)
  REFERENCES backend_runs(id, conversation_id, user_id, service_instance_id) DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION protect_agent_run_root() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.run_kind = 'turn' THEN NEW.root_run_id := NEW.id; END IF;
  IF NEW.run_kind = 'resume' AND NOT EXISTS (
    SELECT 1 FROM backend_runs root WHERE root.id = NEW.root_run_id AND root.run_kind = 'turn'
      AND root.conversation_id = NEW.conversation_id AND root.user_id = NEW.user_id
      AND root.service_instance_id = NEW.service_instance_id
  ) THEN RAISE EXCEPTION 'AGENT_ROOT_MISMATCH' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'UPDATE' AND
    (NEW.id, NEW.conversation_id, NEW.user_id, NEW.service_instance_id, NEW.run_kind, NEW.root_run_id,
     NEW.user_message_id, NEW.sequence_anchor, NEW.submission_id, NEW.request_hash)
    IS DISTINCT FROM
    (OLD.id, OLD.conversation_id, OLD.user_id, OLD.service_instance_id, OLD.run_kind, OLD.root_run_id,
     OLD.user_message_id, OLD.sequence_anchor, OLD.submission_id, OLD.request_hash)
  THEN RAISE EXCEPTION 'AGENT_RUN_IDENTITY_IMMUTABLE' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER backend_runs_protect_root BEFORE INSERT OR UPDATE ON backend_runs
  FOR EACH ROW EXECUTE FUNCTION protect_agent_run_root();

CREATE TABLE backend_run_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  origin_run_id UUID NOT NULL UNIQUE REFERENCES backend_runs(id) ON DELETE CASCADE,
  native_interrupt_id TEXT NOT NULL CHECK (length(native_interrupt_id) BETWEEN 1 AND 255),
  checkpoint JSONB NOT NULL CHECK (jsonb_typeof(checkpoint) = 'object' AND octet_length(checkpoint::text) <= 16384),
  prompt JSONB NOT NULL CHECK (jsonb_typeof(prompt) = 'object' AND octet_length(prompt::text) <= 32768),
  expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','submitting','accepted','expired','unknown')),
  submission_id UUID,
  request_hash TEXT CHECK (length(request_hash) = 64),
  decision JSONB CHECK (decision IS NULL OR (jsonb_typeof(decision) = 'object' AND octet_length(decision::text) <= 4096)),
  resume_run_id UUID UNIQUE REFERENCES backend_runs(id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((submission_id IS NULL AND request_hash IS NULL AND decision IS NULL AND resume_run_id IS NULL
    AND status IN ('pending','expired')) OR
    (submission_id IS NOT NULL AND request_hash IS NOT NULL AND decision IS NOT NULL AND resume_run_id IS NOT NULL
    AND status IN ('submitting','accepted','unknown')))
);
ALTER TABLE backend_run_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE backend_run_interactions FORCE ROW LEVEL SECURITY;
CREATE POLICY backend_run_interactions_system_only ON backend_run_interactions
  FOR ALL USING (app_rls_system_actor()) WITH CHECK (app_rls_system_actor());

CREATE FUNCTION protect_agent_interaction_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM backend_runs run JOIN backend_conversations binding
      ON binding.conversation_id = run.conversation_id
      WHERE run.id = NEW.origin_run_id AND run.run_kind = 'turn' AND binding.human_input)
    THEN RAISE EXCEPTION 'AGENT_INTERACTION_ORIGIN_INVALID' USING ERRCODE = '23514'; END IF;
  ELSE
    IF (NEW.id, NEW.origin_run_id, NEW.native_interrupt_id, NEW.checkpoint, NEW.prompt, NEW.expires_at)
      IS DISTINCT FROM (OLD.id, OLD.origin_run_id, OLD.native_interrupt_id, OLD.checkpoint, OLD.prompt, OLD.expires_at)
      OR (OLD.submission_id IS NOT NULL AND (NEW.submission_id, NEW.request_hash, NEW.decision, NEW.resume_run_id)
        IS DISTINCT FROM (OLD.submission_id, OLD.request_hash, OLD.decision, OLD.resume_run_id))
      OR (OLD.status = 'accepted' AND NEW.status <> 'accepted')
    THEN RAISE EXCEPTION 'AGENT_INTERACTION_IMMUTABLE' USING ERRCODE = '23514'; END IF;
  END IF;
  IF NEW.resume_run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM backend_runs resume JOIN backend_runs origin ON origin.id = NEW.origin_run_id
    WHERE resume.id = NEW.resume_run_id AND resume.run_kind = 'resume'
      AND resume.root_run_id = origin.root_run_id AND resume.conversation_id = origin.conversation_id
      AND resume.user_id = origin.user_id AND resume.service_instance_id = origin.service_instance_id
  ) THEN RAISE EXCEPTION 'AGENT_INTERACTION_RESUME_INVALID' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER backend_run_interactions_protect_identity BEFORE INSERT OR UPDATE ON backend_run_interactions
  FOR EACH ROW EXECUTE FUNCTION protect_agent_interaction_identity();

CREATE FUNCTION agent_has_unresolved_run(application_id UUID) RETURNS BOOLEAN LANGUAGE sql STABLE
  SET search_path = public, pg_temp SET app.rls_system_actor = 'true'
AS $$
  SELECT EXISTS (SELECT 1 FROM backend_runs run WHERE run.service_instance_id = application_id AND (
    run.execution_status IN ('reserved','submitting','running','unknown')
    OR (run.execution_status = 'waiting' AND NOT EXISTS (
      SELECT 1 FROM backend_run_interactions resolved WHERE resolved.origin_run_id = run.id AND resolved.status = 'accepted'))
    OR run.persistence_status <> 'saved'
    OR EXISTS (SELECT 1 FROM backend_run_interactions interaction WHERE interaction.origin_run_id = run.id
      AND (interaction.status IN ('pending','submitting','unknown','expired') OR EXISTS (
        SELECT 1 FROM backend_runs resume WHERE resume.id = interaction.resume_run_id
          AND (resume.execution_status IN ('reserved','submitting','running','unknown') OR resume.persistence_status <> 'saved')
      )))
  ));
$$;

CREATE FUNCTION protect_hitl_configuration() RETURNS trigger LANGUAGE plpgsql
  SET search_path = public, pg_temp SET app.rls_system_actor = 'true'
AS $$
DECLARE application_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'providers' THEN
    IF NEW.base_url IS NOT DISTINCT FROM OLD.base_url THEN RETURN NEW; END IF;
    FOR application_id IN SELECT id FROM service_instances WHERE provider_id = OLD.id ORDER BY id LOOP
      IF NOT pg_try_advisory_xact_lock(hashtextextended('agent-app:' || application_id::text, 0))
        OR agent_has_unresolved_run(application_id)
      THEN RAISE EXCEPTION 'AGENT_CONFIG_BUSY' USING ERRCODE = '23514'; END IF;
    END LOOP;
  ELSE
    IF (NEW.config->>'backend_type', NEW.config->'langchain'->>'assistant_id', COALESCE(NEW.config->'langchain'->'human_input' = 'true'::jsonb, FALSE), NEW.instance_id, NEW.provider_id)
      IS NOT DISTINCT FROM
      (OLD.config->>'backend_type', OLD.config->'langchain'->>'assistant_id', COALESCE(OLD.config->'langchain'->'human_input' = 'true'::jsonb, FALSE), OLD.instance_id, OLD.provider_id)
    THEN RETURN NEW; END IF;
    IF NOT pg_try_advisory_xact_lock(hashtextextended('agent-app:' || OLD.id::text, 0)) OR agent_has_unresolved_run(OLD.id)
    THEN RAISE EXCEPTION 'AGENT_CONFIG_BUSY' USING ERRCODE = '23514'; END IF;
    IF COALESCE(NEW.config->'langchain'->'human_input' = 'true'::jsonb, FALSE)
      IS DISTINCT FROM COALESCE(OLD.config->'langchain'->'human_input' = 'true'::jsonb, FALSE)
      AND EXISTS (SELECT 1 FROM backend_conversations WHERE service_instance_id = OLD.id)
    THEN RAISE EXCEPTION 'AGENT_CONFIG_HAS_HISTORY' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER providers_protect_hitl BEFORE UPDATE ON providers
  FOR EACH ROW EXECUTE FUNCTION protect_hitl_configuration();
CREATE TRIGGER service_instances_protect_hitl BEFORE UPDATE ON service_instances
  FOR EACH ROW EXECUTE FUNCTION protect_hitl_configuration();

CREATE FUNCTION protect_hitl_deletion() RETURNS trigger LANGUAGE plpgsql
  SET search_path = public, pg_temp SET app.rls_system_actor = 'true'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM backend_runs run WHERE
    ((TG_TABLE_NAME = 'conversations' AND run.conversation_id = OLD.id)
      OR (TG_TABLE_NAME = 'profiles' AND run.user_id = OLD.id)
      OR (TG_TABLE_NAME = 'service_instances' AND run.service_instance_id = OLD.id)
      OR (TG_TABLE_NAME = 'backend_runs' AND (run.id = OLD.id OR run.root_run_id = OLD.id)))
    AND (run.execution_status IN ('reserved','submitting','running','unknown') OR run.persistence_status <> 'saved'
      OR (run.execution_status = 'waiting' AND NOT EXISTS (
        SELECT 1 FROM backend_run_interactions resolved WHERE resolved.origin_run_id = run.id AND resolved.status = 'accepted'))
      OR EXISTS (SELECT 1 FROM backend_run_interactions interaction WHERE interaction.origin_run_id = run.id
        AND interaction.status IN ('pending','submitting','unknown','expired'))))
  THEN RAISE EXCEPTION 'AGENT_TASK_BUSY' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'UPDATE' THEN RETURN NEW; END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER conversations_protect_hitl BEFORE DELETE OR UPDATE OF status ON conversations
  FOR EACH ROW EXECUTE FUNCTION protect_hitl_deletion();
CREATE TRIGGER profiles_protect_hitl BEFORE DELETE ON profiles
  FOR EACH ROW EXECUTE FUNCTION protect_hitl_deletion();
CREATE TRIGGER service_instances_protect_hitl_deletion BEFORE DELETE ON service_instances
  FOR EACH ROW EXECUTE FUNCTION protect_hitl_deletion();
CREATE TRIGGER backend_runs_protect_hitl BEFORE DELETE ON backend_runs
  FOR EACH ROW EXECUTE FUNCTION protect_hitl_deletion();

CREATE FUNCTION protect_hitl_quota() RETURNS trigger LANGUAGE plpgsql
  SET search_path = public, pg_temp SET app.rls_system_actor = 'true'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.id, NEW.group_id, NEW.service_instance_id)
    IS NOT DISTINCT FROM (OLD.id, OLD.group_id, OLD.service_instance_id)
    AND COALESCE(NEW.used_count, 0) >= COALESCE(OLD.used_count, 0)
  THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM agent_submissions task JOIN backend_runs run ON run.id = task.run_id
    WHERE task.quota_permission_id = OLD.id AND (
      EXISTS (SELECT 1 FROM backend_run_interactions interaction
        WHERE interaction.origin_run_id = run.id AND (interaction.status IN ('pending','submitting','unknown','expired')
          OR EXISTS (SELECT 1 FROM backend_runs resume WHERE resume.id = interaction.resume_run_id
            AND (resume.execution_status IN ('reserved','submitting','running','unknown') OR resume.persistence_status <> 'saved'))))))
  THEN RAISE EXCEPTION 'AGENT_QUOTA_BUSY' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER group_app_permissions_protect_hitl BEFORE UPDATE OR DELETE ON group_app_permissions
  FOR EACH ROW EXECUTE FUNCTION protect_hitl_quota();

CREATE FUNCTION protect_hitl_credentials() RETURNS trigger LANGUAGE plpgsql
  SET search_path = public, pg_temp SET app.rls_system_actor = 'true'
AS $$
DECLARE application_id UUID;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.provider_id, NEW.service_instance_id, NEW.user_id, NEW.key_value, NEW.is_default, NEW.created_at)
    IS NOT DISTINCT FROM (OLD.provider_id, OLD.service_instance_id, OLD.user_id, OLD.key_value, OLD.is_default, OLD.created_at)
  THEN RETURN NEW; END IF;
  FOR application_id IN SELECT DISTINCT affected.id FROM unnest(ARRAY[
    CASE WHEN TG_OP <> 'INSERT' AND OLD.is_default THEN OLD.service_instance_id ELSE NULL END,
    CASE WHEN TG_OP <> 'DELETE' AND NEW.is_default THEN NEW.service_instance_id ELSE NULL END
  ]) affected(id) WHERE affected.id IS NOT NULL ORDER BY affected.id LOOP
    IF EXISTS (SELECT 1 FROM backend_conversations WHERE service_instance_id = application_id AND human_input)
      AND agent_has_unresolved_run(application_id)
    THEN RAISE EXCEPTION 'AGENT_CONFIG_BUSY' USING ERRCODE = '23514'; END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER api_keys_protect_hitl BEFORE INSERT OR UPDATE OR DELETE ON api_keys
  FOR EACH ROW EXECUTE FUNCTION protect_hitl_credentials();

CREATE FUNCTION protect_pending_interaction_deletion() RETURNS trigger LANGUAGE plpgsql
  SET search_path = public, pg_temp SET app.rls_system_actor = 'true'
AS $$
BEGIN
  IF OLD.status <> 'accepted' OR EXISTS (SELECT 1 FROM backend_runs run WHERE run.id = OLD.resume_run_id
    AND (run.execution_status IN ('reserved','submitting','running','unknown') OR run.persistence_status <> 'saved'))
  THEN RAISE EXCEPTION 'AGENT_TASK_BUSY' USING ERRCODE = '23514'; END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER backend_run_interactions_protect_deletion BEFORE DELETE ON backend_run_interactions
  FOR EACH ROW EXECUTE FUNCTION protect_pending_interaction_deletion();
