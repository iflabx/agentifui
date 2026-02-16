-- M4: RPC + RLS 语义迁移（第三批 / 收尾）
-- 目标：
-- 1) 补齐剩余关键表的 RLS 策略覆盖
-- 2) 统一 admin / self / visibility 语义
-- 3) 保持 legacy 兼容（无 actor 上下文时沿用旧行为）

SET search_path = public;

-- =========================
-- Helpers
-- =========================

CREATE OR REPLACE FUNCTION app_rls_admin_only()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT app_rls_legacy_mode() OR app_actor_is_admin()
$$;

CREATE OR REPLACE FUNCTION app_rls_service_instance_visible(
  target_service_instance_id UUID,
  target_visibility TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT
    app_rls_legacy_mode()
    OR app_actor_is_admin()
    OR target_visibility = 'public'
    OR (
      target_visibility = 'group_only'
      AND EXISTS (
        SELECT 1
        FROM group_app_permissions gap
        JOIN group_members gm
          ON gm.group_id = gap.group_id
        WHERE gap.service_instance_id = target_service_instance_id
          AND gap.is_enabled = TRUE
          AND gm.user_id = app_actor_user_id()
      )
    )
$$;

-- =========================
-- Reset existing policies on target tables
-- =========================

DO $$
DECLARE
  target_table TEXT;
  target_policy RECORD;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'providers',
    'service_instances',
    'api_keys',
    'sso_providers',
    'domain_sso_mappings',
    'auth_settings',
    'user_identities',
    'profile_external_attributes',
    'auth_local_login_audit_logs'
  ]
  LOOP
    FOR target_policy IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = target_table
    LOOP
      EXECUTE format(
        'DROP POLICY IF EXISTS %I ON public.%I',
        target_policy.policyname,
        target_table
      );
    END LOOP;
  END LOOP;
END;
$$;

-- =========================
-- Enable FORCE RLS on target tables
-- =========================

ALTER TABLE providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE providers FORCE ROW LEVEL SECURITY;

ALTER TABLE service_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_instances FORCE ROW LEVEL SECURITY;

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;

ALTER TABLE sso_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sso_providers FORCE ROW LEVEL SECURITY;

ALTER TABLE domain_sso_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE domain_sso_mappings FORCE ROW LEVEL SECURITY;

ALTER TABLE auth_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_settings FORCE ROW LEVEL SECURITY;

ALTER TABLE user_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_identities FORCE ROW LEVEL SECURITY;

ALTER TABLE profile_external_attributes ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_external_attributes FORCE ROW LEVEL SECURITY;

ALTER TABLE auth_local_login_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_local_login_audit_logs FORCE ROW LEVEL SECURITY;

-- =========================
-- providers
-- =========================

CREATE POLICY m4_providers_select
ON providers
FOR SELECT
USING (app_rls_admin_only());

CREATE POLICY m4_providers_insert
ON providers
FOR INSERT
WITH CHECK (app_rls_admin_only());

CREATE POLICY m4_providers_update
ON providers
FOR UPDATE
USING (app_rls_admin_only())
WITH CHECK (app_rls_admin_only());

CREATE POLICY m4_providers_delete
ON providers
FOR DELETE
USING (app_rls_admin_only());

-- =========================
-- service_instances
-- =========================

CREATE POLICY m4_service_instances_select
ON service_instances
FOR SELECT
USING (app_rls_service_instance_visible(id, visibility));

CREATE POLICY m4_service_instances_insert
ON service_instances
FOR INSERT
WITH CHECK (app_rls_admin_only());

CREATE POLICY m4_service_instances_update
ON service_instances
FOR UPDATE
USING (app_rls_admin_only())
WITH CHECK (app_rls_admin_only());

CREATE POLICY m4_service_instances_delete
ON service_instances
FOR DELETE
USING (app_rls_admin_only());

-- =========================
-- api_keys
-- =========================

CREATE POLICY m4_api_keys_select
ON api_keys
FOR SELECT
USING (app_rls_admin_only());

CREATE POLICY m4_api_keys_insert
ON api_keys
FOR INSERT
WITH CHECK (app_rls_admin_only());

CREATE POLICY m4_api_keys_update
ON api_keys
FOR UPDATE
USING (app_rls_admin_only())
WITH CHECK (app_rls_admin_only());

CREATE POLICY m4_api_keys_delete
ON api_keys
FOR DELETE
USING (app_rls_admin_only());

-- =========================
-- sso_providers
-- =========================

CREATE POLICY m4_sso_providers_select
ON sso_providers
FOR SELECT
USING (app_rls_admin_only());

CREATE POLICY m4_sso_providers_insert
ON sso_providers
FOR INSERT
WITH CHECK (app_rls_admin_only());

CREATE POLICY m4_sso_providers_update
ON sso_providers
FOR UPDATE
USING (app_rls_admin_only())
WITH CHECK (app_rls_admin_only());

CREATE POLICY m4_sso_providers_delete
ON sso_providers
FOR DELETE
USING (app_rls_admin_only());

-- =========================
-- domain_sso_mappings
-- =========================

CREATE POLICY m4_domain_sso_mappings_select
ON domain_sso_mappings
FOR SELECT
USING (app_rls_admin_only());

CREATE POLICY m4_domain_sso_mappings_insert
ON domain_sso_mappings
FOR INSERT
WITH CHECK (app_rls_admin_only());

CREATE POLICY m4_domain_sso_mappings_update
ON domain_sso_mappings
FOR UPDATE
USING (app_rls_admin_only())
WITH CHECK (app_rls_admin_only());

CREATE POLICY m4_domain_sso_mappings_delete
ON domain_sso_mappings
FOR DELETE
USING (app_rls_admin_only());

-- =========================
-- auth_settings
-- =========================

CREATE POLICY m4_auth_settings_select
ON auth_settings
FOR SELECT
USING (app_rls_admin_only());

CREATE POLICY m4_auth_settings_insert
ON auth_settings
FOR INSERT
WITH CHECK (app_rls_admin_only());

CREATE POLICY m4_auth_settings_update
ON auth_settings
FOR UPDATE
USING (app_rls_admin_only())
WITH CHECK (app_rls_admin_only());

CREATE POLICY m4_auth_settings_delete
ON auth_settings
FOR DELETE
USING (app_rls_admin_only());

-- =========================
-- user_identities
-- =========================

CREATE POLICY m4_user_identities_select
ON user_identities
FOR SELECT
USING (app_rls_self_or_admin(user_id));

CREATE POLICY m4_user_identities_insert
ON user_identities
FOR INSERT
WITH CHECK (app_rls_self_or_admin(user_id));

CREATE POLICY m4_user_identities_update
ON user_identities
FOR UPDATE
USING (app_rls_self_or_admin(user_id))
WITH CHECK (app_rls_self_or_admin(user_id));

CREATE POLICY m4_user_identities_delete
ON user_identities
FOR DELETE
USING (app_rls_self_or_admin(user_id));

-- =========================
-- profile_external_attributes
-- =========================

CREATE POLICY m4_profile_external_attributes_select
ON profile_external_attributes
FOR SELECT
USING (app_rls_self_or_admin(user_id));

CREATE POLICY m4_profile_external_attributes_insert
ON profile_external_attributes
FOR INSERT
WITH CHECK (app_rls_self_or_admin(user_id));

CREATE POLICY m4_profile_external_attributes_update
ON profile_external_attributes
FOR UPDATE
USING (app_rls_self_or_admin(user_id))
WITH CHECK (app_rls_self_or_admin(user_id));

CREATE POLICY m4_profile_external_attributes_delete
ON profile_external_attributes
FOR DELETE
USING (app_rls_self_or_admin(user_id));

-- =========================
-- auth_local_login_audit_logs
-- =========================

CREATE POLICY m4_auth_local_login_audit_logs_select
ON auth_local_login_audit_logs
FOR SELECT
USING (app_rls_admin_only());

CREATE POLICY m4_auth_local_login_audit_logs_insert
ON auth_local_login_audit_logs
FOR INSERT
WITH CHECK (app_rls_admin_only());

CREATE POLICY m4_auth_local_login_audit_logs_update
ON auth_local_login_audit_logs
FOR UPDATE
USING (app_rls_admin_only())
WITH CHECK (app_rls_admin_only());

CREATE POLICY m4_auth_local_login_audit_logs_delete
ON auth_local_login_audit_logs
FOR DELETE
USING (app_rls_admin_only());

COMMENT ON FUNCTION app_rls_admin_only() IS
'M4 phase3: admin-only helper with legacy compatibility.';
