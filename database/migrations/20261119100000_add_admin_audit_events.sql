SET search_path = public;

CREATE TABLE admin_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL,
  request_id TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'maintenance')),
  actor_user_id UUID,
  actor_label TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('committed', 'failed', 'denied')),
  changes JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(changes::text) <= 262144),
  reason_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX admin_audit_operation_committed ON admin_audit_events(operation_id)
  WHERE outcome = 'committed';
CREATE INDEX admin_audit_time ON admin_audit_events(created_at DESC, id DESC);
CREATE INDEX admin_audit_action_time ON admin_audit_events(action, created_at DESC);
CREATE INDEX admin_audit_target_time ON admin_audit_events(target_type, target_id, created_at DESC);
ALTER TABLE admin_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY admin_audit_system_insert ON admin_audit_events FOR INSERT
  WITH CHECK (app_rls_system_actor());
CREATE POLICY admin_audit_system_select ON admin_audit_events FOR SELECT
  USING (app_rls_system_actor());
