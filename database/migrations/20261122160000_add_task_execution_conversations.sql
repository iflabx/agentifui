SET search_path = public;

ALTER TABLE app_executions
  ADD COLUMN conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  ADD COLUMN submission_id UUID;

CREATE UNIQUE INDEX app_executions_submission_unique
  ON app_executions(user_id, service_instance_id, submission_id)
  WHERE submission_id IS NOT NULL;

CREATE INDEX app_executions_conversation_page
  ON app_executions(conversation_id, created_at DESC, id DESC)
  WHERE conversation_id IS NOT NULL;
