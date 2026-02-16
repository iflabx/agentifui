-- Add local fallback-login control and audit trail.

SET search_path = public;

ALTER TABLE auth_settings
  ADD COLUMN IF NOT EXISTS auth_mode TEXT NOT NULL DEFAULT 'normal';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'auth_settings_auth_mode_check'
      AND conrelid = 'auth_settings'::regclass
  ) THEN
    ALTER TABLE auth_settings DROP CONSTRAINT auth_settings_auth_mode_check;
  END IF;
END
$$;

ALTER TABLE auth_settings
  ADD CONSTRAINT auth_settings_auth_mode_check
  CHECK (auth_mode IN ('normal', 'degraded'));

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS local_login_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS local_login_updated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS auth_local_login_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  email TEXT,
  auth_mode TEXT NOT NULL,
  outcome TEXT NOT NULL,
  reason TEXT,
  status_code INTEGER,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'auth_local_login_audit_logs_auth_mode_check'
      AND conrelid = 'auth_local_login_audit_logs'::regclass
  ) THEN
    ALTER TABLE auth_local_login_audit_logs
      DROP CONSTRAINT auth_local_login_audit_logs_auth_mode_check;
  END IF;
END
$$;

ALTER TABLE auth_local_login_audit_logs
  ADD CONSTRAINT auth_local_login_audit_logs_auth_mode_check
  CHECK (auth_mode IN ('normal', 'degraded'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'auth_local_login_audit_logs_outcome_check'
      AND conrelid = 'auth_local_login_audit_logs'::regclass
  ) THEN
    ALTER TABLE auth_local_login_audit_logs
      DROP CONSTRAINT auth_local_login_audit_logs_outcome_check;
  END IF;
END
$$;

ALTER TABLE auth_local_login_audit_logs
  ADD CONSTRAINT auth_local_login_audit_logs_outcome_check
  CHECK (outcome IN ('blocked', 'success', 'failed'));

CREATE INDEX IF NOT EXISTS idx_auth_local_login_audit_logs_created_at
  ON auth_local_login_audit_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_local_login_audit_logs_user_id
  ON auth_local_login_audit_logs(user_id);

CREATE INDEX IF NOT EXISTS idx_auth_local_login_audit_logs_email
  ON auth_local_login_audit_logs(email);
