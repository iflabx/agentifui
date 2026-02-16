-- Enforce 1 UUID = 1 IdP identity binding.
-- Keep at most one row per user_id and preserve the legacy better-auth mapping
-- row when duplicates exist.

SET search_path = public;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id
      ORDER BY
        CASE
          WHEN issuer = 'urn:agentifui:better-auth' THEN 0
          ELSE 1
        END,
        updated_at DESC,
        created_at DESC,
        id DESC
    ) AS rn
  FROM user_identities
),
duplicates AS (
  SELECT id
  FROM ranked
  WHERE rn > 1
)
DELETE FROM user_identities ui
USING duplicates d
WHERE ui.id = d.id;

DROP INDEX IF EXISTS idx_user_identities_user_issuer_subject;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_identities_user_id_unique
  ON user_identities(user_id);
