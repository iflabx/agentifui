SET search_path = public;

CREATE TABLE agent_input_files (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  service_instance_id UUID NOT NULL REFERENCES service_instances(id) ON DELETE CASCADE,
  backend_type TEXT NOT NULL CHECK (backend_type IN ('dify', 'langchain')),
  config_fingerprint TEXT NOT NULL,
  native_file_id TEXT NOT NULL CHECK (length(native_file_id) BETWEEN 1 AND 255),
  slot_key TEXT NOT NULL,
  name TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  mime_type TEXT NOT NULL,
  bound_once BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE agent_input_file_messages (
  file_id UUID NOT NULL REFERENCES agent_input_files(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  PRIMARY KEY (file_id, message_id)
);
CREATE INDEX agent_input_file_messages_message_idx ON agent_input_file_messages (message_id);

ALTER TABLE agent_input_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_input_files FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_input_files_system ON agent_input_files FOR ALL
  USING (app_rls_system_actor()) WITH CHECK (app_rls_system_actor());

ALTER TABLE agent_input_file_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_input_file_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_input_file_messages_system ON agent_input_file_messages FOR ALL
  USING (app_rls_system_actor()) WITH CHECK (app_rls_system_actor());
