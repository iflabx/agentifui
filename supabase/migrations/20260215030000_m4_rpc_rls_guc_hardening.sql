-- M4: RPC + RLS 语义迁移（第一批）
-- 目标：
-- 1) 提供 auth.uid() 与 GUC 上下文兼容层（app.current_user_id）
-- 2) 收口关键 RPC 的权限语义（在设置 actor 上下文时生效）
-- 3) 补强并发确定性（配额累加、默认实例切换）

SET search_path = public;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION app_actor_user_id()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT app_actor_user_id()
$$;

CREATE OR REPLACE FUNCTION app_actor_is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.id = app_actor_user_id()
      AND p.role = 'admin'
  )
$$;

CREATE OR REPLACE FUNCTION app_enforce_admin()
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_actor UUID := app_actor_user_id();
BEGIN
  -- Legacy compatibility: when no actor context is injected, keep old behavior.
  IF v_actor IS NULL THEN
    RETURN;
  END IF;

  IF NOT app_actor_is_admin() THEN
    RAISE EXCEPTION 'admin role required'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION app_enforce_user_scope(target_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_actor UUID := app_actor_user_id();
BEGIN
  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'target user id cannot be null'
      USING ERRCODE = '22004';
  END IF;

  -- Legacy compatibility: when no actor context is injected, keep old behavior.
  IF v_actor IS NULL THEN
    RETURN;
  END IF;

  IF v_actor = target_user_id OR app_actor_is_admin() THEN
    RETURN;
  END IF;

  RAISE EXCEPTION 'forbidden: user scope mismatch'
    USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION set_default_service_instance(
  target_instance_id UUID,
  target_provider_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated_count INTEGER := 0;
BEGIN
  IF target_instance_id IS NULL OR target_provider_id IS NULL THEN
    RAISE EXCEPTION 'target_instance_id and target_provider_id cannot be null';
  END IF;

  PERFORM app_enforce_admin();

  -- Serialize default switching per provider to avoid concurrent flip conflicts.
  PERFORM pg_advisory_xact_lock(hashtext(target_provider_id::text));

  UPDATE service_instances
  SET is_default = FALSE,
      updated_at = NOW()
  WHERE provider_id = target_provider_id
    AND is_default = TRUE
    AND id <> target_instance_id;

  UPDATE service_instances
  SET is_default = TRUE,
      updated_at = NOW()
  WHERE id = target_instance_id
    AND provider_id = target_provider_id;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count = 0 THEN
    RAISE EXCEPTION 'Failed to set default service instance: instance not found for provider';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION get_user_accessible_apps(p_user_id UUID)
RETURNS TABLE (
  service_instance_id UUID,
  display_name TEXT,
  description TEXT,
  instance_id TEXT,
  api_path TEXT,
  visibility TEXT,
  config JSONB,
  usage_quota INTEGER,
  used_count INTEGER,
  quota_remaining INTEGER,
  group_name TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_is_admin BOOLEAN := FALSE;
BEGIN
  PERFORM app_enforce_user_scope(p_user_id);

  SELECT COALESCE(p.role = 'admin', FALSE)
  INTO v_is_admin
  FROM profiles p
  WHERE p.id = p_user_id;

  RETURN QUERY
  SELECT
    si.id AS service_instance_id,
    si.display_name,
    si.description,
    si.instance_id,
    si.api_path,
    si.visibility,
    si.config,
    gap.usage_quota,
    gap.used_count,
    CASE
      WHEN gap.usage_quota IS NULL THEN NULL
      ELSE GREATEST(0, gap.usage_quota - gap.used_count)
    END AS quota_remaining,
    g.name AS group_name
  FROM service_instances si
  LEFT JOIN group_app_permissions gap
    ON si.id = gap.service_instance_id
   AND gap.is_enabled = TRUE
  LEFT JOIN group_members gm
    ON gap.group_id = gm.group_id
   AND gm.user_id = p_user_id
  LEFT JOIN groups g
    ON gm.group_id = g.id
  WHERE
    si.visibility = 'public'
    OR (si.visibility = 'group_only' AND gm.user_id IS NOT NULL)
    OR (si.visibility = 'private' AND v_is_admin)
  ORDER BY si.display_name NULLS LAST, si.instance_id;
END;
$$;

CREATE OR REPLACE FUNCTION check_user_app_permission(
  p_user_id UUID,
  p_service_instance_id UUID
)
RETURNS TABLE (
  has_access BOOLEAN,
  permission_level TEXT,
  quota_remaining INTEGER,
  error_message TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_visibility TEXT;
  v_is_admin BOOLEAN := FALSE;
  v_quota INTEGER;
  v_used_count INTEGER;
BEGIN
  PERFORM app_enforce_user_scope(p_user_id);

  SELECT visibility
  INTO v_visibility
  FROM service_instances
  WHERE id = p_service_instance_id;

  IF v_visibility IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::INTEGER, 'service instance not found'::TEXT;
    RETURN;
  END IF;

  IF v_visibility = 'public' THEN
    RETURN QUERY SELECT TRUE, 'full'::TEXT, NULL::INTEGER, NULL::TEXT;
    RETURN;
  END IF;

  SELECT COALESCE(role = 'admin', FALSE)
  INTO v_is_admin
  FROM profiles
  WHERE id = p_user_id;

  IF v_visibility = 'private' THEN
    IF v_is_admin THEN
      RETURN QUERY SELECT TRUE, 'admin'::TEXT, NULL::INTEGER, NULL::TEXT;
    ELSE
      RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::INTEGER, 'admin role required'::TEXT;
    END IF;
    RETURN;
  END IF;

  IF v_visibility = 'group_only' THEN
    SELECT gap.usage_quota, gap.used_count
    INTO v_quota, v_used_count
    FROM group_app_permissions gap
    JOIN group_members gm ON gm.group_id = gap.group_id
    WHERE gap.service_instance_id = p_service_instance_id
      AND gm.user_id = p_user_id
      AND gap.is_enabled = TRUE
    ORDER BY gap.created_at ASC, gap.id ASC
    LIMIT 1;

    IF v_quota IS NULL AND v_used_count IS NULL THEN
      RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::INTEGER, 'no group permission'::TEXT;
      RETURN;
    END IF;

    IF v_quota IS NOT NULL AND v_used_count >= v_quota THEN
      RETURN QUERY SELECT FALSE, 'group'::TEXT, 0, 'quota exceeded'::TEXT;
      RETURN;
    END IF;

    RETURN QUERY
    SELECT
      TRUE,
      'group'::TEXT,
      CASE
        WHEN v_quota IS NULL THEN NULL::INTEGER
        ELSE GREATEST(0, v_quota - v_used_count)
      END,
      NULL::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::INTEGER, 'unknown visibility'::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION increment_app_usage(
  p_user_id UUID,
  p_service_instance_id UUID,
  p_increment INTEGER DEFAULT 1
)
RETURNS TABLE (
  success BOOLEAN,
  new_used_count INTEGER,
  quota_remaining INTEGER,
  error_message TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_visibility TEXT;
  v_target_permission_id UUID;
  v_quota INTEGER;
  v_used_count INTEGER;
  v_new_count INTEGER;
BEGIN
  PERFORM app_enforce_user_scope(p_user_id);

  IF p_increment IS NULL OR p_increment < 1 THEN
    RAISE EXCEPTION 'p_increment must be a positive integer';
  END IF;

  SELECT visibility
  INTO v_visibility
  FROM service_instances
  WHERE id = p_service_instance_id;

  IF v_visibility IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, NULL::INTEGER, 'service instance not found'::TEXT;
    RETURN;
  END IF;

  IF v_visibility IN ('public', 'private') THEN
    RETURN QUERY SELECT TRUE, 0, NULL::INTEGER, NULL::TEXT;
    RETURN;
  END IF;

  SELECT gap.id, gap.usage_quota, gap.used_count
  INTO v_target_permission_id, v_quota, v_used_count
  FROM group_app_permissions gap
  JOIN group_members gm ON gm.group_id = gap.group_id
  WHERE gap.service_instance_id = p_service_instance_id
    AND gm.user_id = p_user_id
    AND gap.is_enabled = TRUE
  ORDER BY gap.created_at ASC, gap.id ASC
  LIMIT 1
  FOR UPDATE OF gap;

  IF v_target_permission_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, NULL::INTEGER, 'no permission'::TEXT;
    RETURN;
  END IF;

  IF v_quota IS NOT NULL AND (v_used_count + p_increment) > v_quota THEN
    RETURN QUERY SELECT FALSE, v_used_count, GREATEST(0, v_quota - v_used_count), 'quota exceeded'::TEXT;
    RETURN;
  END IF;

  UPDATE group_app_permissions
  SET used_count = used_count + p_increment
  WHERE id = v_target_permission_id
  RETURNING used_count INTO v_new_count;

  RETURN QUERY
  SELECT
    TRUE,
    v_new_count,
    CASE
      WHEN v_quota IS NULL THEN NULL::INTEGER
      ELSE GREATEST(0, v_quota - v_new_count)
    END,
    NULL::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION get_user_stats()
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  result JSON;
BEGIN
  PERFORM app_enforce_admin();

  SELECT json_build_object(
    'totalUsers', (SELECT COUNT(*) FROM profiles),
    'activeUsers', (SELECT COUNT(*) FROM profiles WHERE status = 'active'),
    'suspendedUsers', (SELECT COUNT(*) FROM profiles WHERE status = 'suspended'),
    'pendingUsers', (SELECT COUNT(*) FROM profiles WHERE status = 'pending'),
    'adminUsers', (SELECT COUNT(*) FROM profiles WHERE role = 'admin'),
    'managerUsers', (SELECT COUNT(*) FROM profiles WHERE role = 'manager'),
    'regularUsers', (SELECT COUNT(*) FROM profiles WHERE role = 'user'),
    'newUsersToday', (
      SELECT COUNT(*) FROM profiles WHERE created_at >= CURRENT_DATE
    ),
    'newUsersThisWeek', (
      SELECT COUNT(*) FROM profiles WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
    ),
    'newUsersThisMonth', (
      SELECT COUNT(*) FROM profiles WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
    )
  )
  INTO result;

  RETURN COALESCE(result, '{}'::json);
END;
$$;

CREATE OR REPLACE FUNCTION get_user_detail_for_admin(target_user_id UUID)
RETURNS TABLE (
  id UUID,
  full_name TEXT,
  username TEXT,
  avatar_url TEXT,
  role user_role,
  status account_status,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  last_login TIMESTAMPTZ,
  auth_source TEXT,
  sso_provider_id UUID,
  has_email BOOLEAN,
  email_confirmed BOOLEAN,
  has_phone BOOLEAN,
  phone_confirmed BOOLEAN,
  last_sign_in_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM app_enforce_admin();

  RETURN QUERY
  SELECT
    p.id,
    p.full_name,
    p.username,
    p.avatar_url,
    COALESCE(p.role, 'user'::user_role),
    COALESCE(p.status, 'active'::account_status),
    p.created_at,
    p.updated_at,
    p.last_login,
    p.auth_source,
    p.sso_provider_id,
    (p.email IS NOT NULL),
    FALSE AS email_confirmed,
    (p.phone IS NOT NULL),
    FALSE AS phone_confirmed,
    p.last_login AS last_sign_in_at
  FROM profiles p
  WHERE p.id = target_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION safe_delete_user(target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_actor UUID := app_actor_user_id();
BEGIN
  PERFORM app_enforce_admin();

  IF target_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF v_actor IS NOT NULL AND target_user_id = v_actor THEN
    RAISE EXCEPTION 'cannot delete current actor'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM profiles
  WHERE id = target_user_id;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION increment_api_key_usage(key_id UUID)
RETURNS TABLE (
  success BOOLEAN,
  new_usage_count INTEGER,
  last_used_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_usage_count INTEGER;
  v_last_used_at TIMESTAMPTZ;
BEGIN
  PERFORM app_enforce_admin();

  IF key_id IS NULL THEN
    RAISE EXCEPTION 'key_id cannot be null';
  END IF;

  UPDATE api_keys AS ak
  SET
    usage_count = COALESCE(usage_count, 0) + 1,
    last_used_at = NOW(),
    updated_at = NOW()
  WHERE id = key_id
  RETURNING ak.usage_count, ak.last_used_at INTO v_usage_count, v_last_used_at;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::INTEGER, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, v_usage_count, v_last_used_at;
END;
$$;

CREATE OR REPLACE FUNCTION update_sso_provider_order(updates JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  update_item JSONB;
  v_provider_id UUID;
  v_display_order INTEGER;
  v_updated_count INTEGER := 0;
BEGIN
  PERFORM app_enforce_admin();

  IF updates IS NULL OR jsonb_typeof(updates) <> 'array' THEN
    RAISE EXCEPTION 'updates must be a JSON array';
  END IF;

  FOR update_item IN
    SELECT value
    FROM jsonb_array_elements(updates) AS t(value)
  LOOP
    IF NOT (update_item ? 'id') OR NOT (update_item ? 'display_order') THEN
      RAISE EXCEPTION 'Each update item must contain id and display_order';
    END IF;

    v_provider_id := (update_item->>'id')::UUID;
    v_display_order := (update_item->>'display_order')::INTEGER;

    UPDATE sso_providers
    SET
      display_order = v_display_order,
      updated_at = NOW()
    WHERE id = v_provider_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'SSO provider not found: %', v_provider_id;
    END IF;

    v_updated_count := v_updated_count + 1;
  END LOOP;

  RETURN v_updated_count;
END;
$$;

COMMENT ON FUNCTION auth.uid() IS
'M4 compatibility shim: resolves actor user id from app.current_user_id GUC.';
