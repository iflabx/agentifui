SET search_path = public;

CREATE TABLE dify_upload_access (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  service_instance_id UUID NOT NULL REFERENCES service_instances(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL CHECK (length(file_id) BETWEEN 1 AND 255),
  bound_once BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(user_id,service_instance_id,file_id)
);
ALTER TABLE dify_upload_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE dify_upload_access FORCE ROW LEVEL SECURITY;
CREATE POLICY dify_upload_access_system ON dify_upload_access FOR ALL
  USING(app_rls_system_actor()) WITH CHECK(app_rls_system_actor());

CREATE FUNCTION dify_upload_file_ids(document JSONB) RETURNS SETOF TEXT
  LANGUAGE sql IMMUTABLE AS $$
  SELECT DISTINCT value #>> '{}' FROM (
    SELECT jsonb_path_query(document,'$.**.upload_file_id') AS value
    UNION ALL SELECT jsonb_path_query(document,'$.**.related_id')
  ) files WHERE jsonb_typeof(value)='string' AND length(value #>> '{}') BETWEEN 1 AND 255
$$;

CREATE FUNCTION bind_dify_upload_access() RETURNS trigger LANGUAGE plpgsql
  SET search_path=public,pg_temp SET app.rls_system_actor='true' AS $$
BEGIN
  IF TG_TABLE_NAME='messages' THEN
    UPDATE dify_upload_access access SET bound_once=TRUE FROM conversations c
      JOIN service_instances si ON c.app_id IN (si.id::text,si.instance_id)
      CROSS JOIN dify_upload_file_ids(NEW.metadata) files(file_id)
      WHERE c.id=NEW.conversation_id AND c.user_id=NEW.user_id AND NEW.role='user'
        AND access.user_id=NEW.user_id AND access.service_instance_id=si.id AND access.file_id=files.file_id;
  ELSE
    UPDATE dify_upload_access access SET bound_once=TRUE FROM dify_upload_file_ids(NEW.inputs) files(file_id)
      WHERE access.user_id=NEW.user_id AND access.service_instance_id=NEW.service_instance_id AND access.file_id=files.file_id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER messages_bind_dify_upload AFTER INSERT OR UPDATE OF metadata ON messages
  FOR EACH ROW EXECUTE FUNCTION bind_dify_upload_access();
CREATE TRIGGER executions_bind_dify_upload AFTER INSERT OR UPDATE OF inputs ON app_executions
  FOR EACH ROW EXECUTE FUNCTION bind_dify_upload_access();

