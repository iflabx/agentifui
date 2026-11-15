SET search_path = public;

CREATE OR REPLACE FUNCTION protect_agent_interaction_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE release_reserved BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM backend_runs run JOIN backend_conversations binding
      ON binding.conversation_id = run.conversation_id
      WHERE run.id = NEW.origin_run_id AND run.run_kind = 'turn' AND binding.human_input)
    THEN RAISE EXCEPTION 'AGENT_INTERACTION_ORIGIN_INVALID' USING ERRCODE = '23514'; END IF;
  ELSE
    IF OLD.status = 'submitting' AND NEW.status IN ('pending','expired')
      AND OLD.submission_id IS NOT NULL AND OLD.resume_run_id IS NOT NULL
      AND NEW.submission_id IS NULL AND NEW.request_hash IS NULL AND NEW.decision IS NULL AND NEW.resume_run_id IS NULL
    THEN
      PERFORM 1 FROM backend_runs resume JOIN backend_runs origin ON origin.id = OLD.origin_run_id
        WHERE resume.id = OLD.resume_run_id AND resume.run_kind = 'resume'
          AND resume.execution_status = 'reserved' AND resume.native_run_id IS NULL AND resume.result IS NULL
          AND resume.persistence_status = 'pending'
          AND resume.submission_id = OLD.submission_id AND resume.request_hash = OLD.request_hash
          AND resume.root_run_id = origin.root_run_id AND resume.conversation_id = origin.conversation_id
          AND resume.user_id = origin.user_id AND resume.service_instance_id = origin.service_instance_id
          AND ((NEW.status = 'expired' AND OLD.expires_at <= clock_timestamp())
            OR (NEW.status = 'pending' AND (OLD.expires_at IS NULL OR OLD.expires_at > clock_timestamp())))
        FOR UPDATE OF resume;
      release_reserved := FOUND;
    END IF;
    IF (NEW.id, NEW.origin_run_id, NEW.native_interrupt_id, NEW.checkpoint, NEW.prompt, NEW.expires_at)
      IS DISTINCT FROM (OLD.id, OLD.origin_run_id, OLD.native_interrupt_id, OLD.checkpoint, OLD.prompt, OLD.expires_at)
      OR (OLD.submission_id IS NOT NULL AND NOT release_reserved AND (NEW.submission_id, NEW.request_hash, NEW.decision, NEW.resume_run_id)
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
