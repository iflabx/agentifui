-- M4: strict mode switch for legacy RLS bypass
-- 目标：
-- 1) 保持默认兼容（strict mode 关闭时，legacy 行为不变）
-- 2) strict mode 打开后，禁用“无 actor 自动放行”
-- 3) 仅允许显式 system actor 上下文作为受控旁路

SET search_path = public;

CREATE OR REPLACE FUNCTION app_rls_guc_enabled(setting_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT lower(
    COALESCE(
      NULLIF(current_setting(setting_name, true), ''),
      'off'
    )
  ) IN ('1', 'true', 'yes', 'on')
$$;

CREATE OR REPLACE FUNCTION app_rls_strict_mode()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT app_rls_guc_enabled('app.rls_strict_mode')
$$;

CREATE OR REPLACE FUNCTION app_rls_system_actor()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT app_rls_guc_enabled('app.rls_system_actor')
$$;

CREATE OR REPLACE FUNCTION app_rls_legacy_mode()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN app_rls_strict_mode() THEN app_rls_system_actor()
    ELSE app_actor_user_id() IS NULL OR app_rls_system_actor()
  END
$$;

COMMENT ON FUNCTION app_rls_legacy_mode() IS
'M4 strict switch: strict mode disables implicit no-actor bypass; only explicit system actor bypass remains.';
