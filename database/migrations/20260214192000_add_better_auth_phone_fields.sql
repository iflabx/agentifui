-- Add phone-number plugin fields for better-auth user model.

SET search_path = public;

ALTER TABLE auth_users
  ADD COLUMN IF NOT EXISTS phone_number TEXT;

ALTER TABLE auth_users
  ADD COLUMN IF NOT EXISTS phone_number_verified BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_users_phone_number_unique
  ON auth_users(phone_number)
  WHERE phone_number IS NOT NULL;
