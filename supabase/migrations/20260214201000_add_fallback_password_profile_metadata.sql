-- Track local fallback password state metadata on profiles.

SET search_path = public;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS fallback_password_set_at TIMESTAMPTZ;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS fallback_password_updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_fallback_password_set_at
  ON profiles(fallback_password_set_at)
  WHERE fallback_password_set_at IS NOT NULL;
