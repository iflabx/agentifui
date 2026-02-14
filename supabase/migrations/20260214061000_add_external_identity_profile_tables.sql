-- M2: External identity mapping + immutable profile attributes
-- Purpose:
-- 1) Persist external IdP identities with stable links to internal users
-- 2) Persist enterprise profile attributes that should be read-only for business-side edits

SET search_path = public;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Ensure the shared trigger helper exists.
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- External identity link table:
-- Maps (issuer, subject) to internal user_id.
CREATE TABLE IF NOT EXISTS user_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  issuer TEXT NOT NULL,
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  email TEXT,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  given_name TEXT,
  family_name TEXT,
  preferred_username TEXT,
  raw_claims JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_identities_issuer_subject
  ON user_identities(issuer, subject);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_identities_user_issuer_subject
  ON user_identities(user_id, issuer, subject);
CREATE INDEX IF NOT EXISTS idx_user_identities_user_id
  ON user_identities(user_id);
CREATE INDEX IF NOT EXISTS idx_user_identities_provider
  ON user_identities(provider);

DROP TRIGGER IF EXISTS update_user_identities_updated_at ON user_identities;
CREATE TRIGGER update_user_identities_updated_at
BEFORE UPDATE ON user_identities
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Immutable enterprise profile attributes:
-- - These are sourced from IdP/HR sync and should not be manually edited by regular business flows.
CREATE TABLE IF NOT EXISTS profile_external_attributes (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  source_issuer TEXT NOT NULL,
  source_provider TEXT NOT NULL,
  employee_number TEXT,
  department_code TEXT,
  department_name TEXT,
  department_path TEXT,
  cost_center TEXT,
  job_title TEXT,
  employment_type TEXT,
  manager_employee_number TEXT,
  manager_name TEXT,
  phone_e164 TEXT,
  office_location TEXT,
  hire_date DATE,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  locked BOOLEAN NOT NULL DEFAULT TRUE,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profile_external_attributes_employee_number
  ON profile_external_attributes(employee_number)
  WHERE employee_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profile_external_attributes_department_code
  ON profile_external_attributes(department_code)
  WHERE department_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profile_external_attributes_source
  ON profile_external_attributes(source_issuer, source_provider);

-- Read-only guard:
-- Only allows immutable field updates when the transaction explicitly sets:
--   SET LOCAL app.identity_sync = 'true';
CREATE OR REPLACE FUNCTION guard_profile_external_attributes_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  sync_mode TEXT := current_setting('app.identity_sync', true);
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF sync_mode = 'true' THEN
    NEW.updated_at = NOW();
    RETURN NEW;
  END IF;

  IF ROW(
    NEW.source_issuer,
    NEW.source_provider,
    NEW.employee_number,
    NEW.department_code,
    NEW.department_name,
    NEW.department_path,
    NEW.cost_center,
    NEW.job_title,
    NEW.employment_type,
    NEW.manager_employee_number,
    NEW.manager_name,
    NEW.phone_e164,
    NEW.office_location,
    NEW.hire_date,
    NEW.attributes,
    NEW.raw_profile,
    NEW.locked
  ) IS DISTINCT FROM ROW(
    OLD.source_issuer,
    OLD.source_provider,
    OLD.employee_number,
    OLD.department_code,
    OLD.department_name,
    OLD.department_path,
    OLD.cost_center,
    OLD.job_title,
    OLD.employment_type,
    OLD.manager_employee_number,
    OLD.manager_name,
    OLD.phone_e164,
    OLD.office_location,
    OLD.hire_date,
    OLD.attributes,
    OLD.raw_profile,
    OLD.locked
  ) THEN
    RAISE EXCEPTION
      'profile_external_attributes is read-only outside identity sync pipeline';
  END IF;

  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_profile_external_attributes_immutable_trigger
  ON profile_external_attributes;
CREATE TRIGGER guard_profile_external_attributes_immutable_trigger
BEFORE UPDATE ON profile_external_attributes
FOR EACH ROW EXECUTE FUNCTION guard_profile_external_attributes_immutable();
