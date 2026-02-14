-- M1 基线：本地 PostgreSQL 兼容 schema（不依赖 Supabase auth/storage/realtime）
-- 目标：
-- 1) 建立当前代码高频依赖的核心表结构
-- 2) 补齐非 Supabase 环境下仍会被调用的关键 RPC
-- 3) 保持可重复执行（尽量 IF NOT EXISTS / CREATE OR REPLACE）

SET search_path = public;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =========
-- Enums
-- =========

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('admin', 'manager', 'user');
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'user_role' AND e.enumlabel = 'manager'
     ) THEN
    ALTER TYPE user_role ADD VALUE 'manager';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_status') THEN
    CREATE TYPE account_status AS ENUM ('active', 'suspended', 'pending');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'message_role') THEN
    CREATE TYPE message_role AS ENUM ('user', 'assistant', 'system');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'message_status') THEN
    CREATE TYPE message_status AS ENUM ('sent', 'delivered', 'error');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'execution_type') THEN
    CREATE TYPE execution_type AS ENUM ('workflow', 'text-generation');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'execution_status') THEN
    CREATE TYPE execution_status AS ENUM (
      'pending',
      'running',
      'completed',
      'failed',
      'stopped',
      'deleted'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'execution_status')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'execution_status' AND e.enumlabel = 'deleted'
     ) THEN
    ALTER TYPE execution_status ADD VALUE 'deleted';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sso_protocol') THEN
    CREATE TYPE sso_protocol AS ENUM ('SAML', 'OAuth2', 'OIDC', 'CAS');
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sso_protocol')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'sso_protocol' AND e.enumlabel = 'CAS'
     ) THEN
    ALTER TYPE sso_protocol ADD VALUE 'CAS';
  END IF;
END
$$;

-- =========
-- Shared trigger function
-- =========

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- =========
-- Core tables
-- =========

CREATE TABLE IF NOT EXISTS providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  base_url TEXT NOT NULL,
  auth_type TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT providers_name_key UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS service_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID REFERENCES providers(id) ON DELETE CASCADE,
  instance_id TEXT NOT NULL,
  api_path TEXT DEFAULT '',
  display_name TEXT,
  description TEXT,
  is_default BOOLEAN DEFAULT FALSE,
  visibility TEXT DEFAULT 'public',
  config JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT service_instances_provider_id_instance_id_key UNIQUE (provider_id, instance_id),
  CONSTRAINT service_instances_visibility_check CHECK (visibility IN ('public', 'group_only', 'private'))
);

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID REFERENCES providers(id) ON DELETE CASCADE,
  service_instance_id UUID REFERENCES service_instances(id) ON DELETE CASCADE,
  user_id UUID,
  key_value TEXT NOT NULL,
  is_default BOOLEAN DEFAULT FALSE,
  usage_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sso_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  protocol sso_protocol NOT NULL,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  client_id TEXT,
  client_secret TEXT,
  metadata_url TEXT,
  enabled BOOLEAN DEFAULT TRUE,
  display_order INTEGER DEFAULT 0,
  button_text TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY,
  full_name TEXT,
  username TEXT UNIQUE,
  avatar_url TEXT,
  email TEXT,
  phone TEXT,
  auth_source TEXT NOT NULL DEFAULT 'password',
  sso_provider_id UUID REFERENCES sso_providers(id) ON DELETE SET NULL,
  employee_number TEXT,
  role user_role DEFAULT 'user',
  status account_status DEFAULT 'active',
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT profiles_employee_number_key UNIQUE (employee_number)
);

CREATE TABLE IF NOT EXISTS auth_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  allow_email_registration BOOLEAN DEFAULT FALSE,
  allow_password_login BOOLEAN DEFAULT TRUE,
  allow_phone_registration BOOLEAN DEFAULT FALSE,
  require_email_verification BOOLEAN DEFAULT TRUE,
  password_policy JSONB DEFAULT
    '{"min_length":8,"require_uppercase":true,"require_lowercase":true,"require_number":true,"require_special":false}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS domain_sso_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT UNIQUE NOT NULL,
  sso_provider_id UUID NOT NULL REFERENCES sso_providers(id) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS group_app_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  service_instance_id UUID NOT NULL REFERENCES service_instances(id) ON DELETE CASCADE,
  is_enabled BOOLEAN DEFAULT TRUE,
  usage_quota INTEGER,
  used_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (group_id, service_instance_id)
);

CREATE TABLE IF NOT EXISTS ai_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID,
  provider TEXT NOT NULL,
  app_id TEXT,
  api_key TEXT NOT NULL,
  api_url TEXT NOT NULL,
  settings JSONB DEFAULT '{}'::jsonb,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  ai_config_id UUID REFERENCES ai_configs(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  summary TEXT,
  settings JSONB DEFAULT '{}'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  status TEXT DEFAULT 'active',
  external_id VARCHAR(255),
  app_id VARCHAR(255),
  last_message_preview TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  role message_role NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  status message_status DEFAULT 'sent',
  external_id VARCHAR(255),
  token_count INTEGER,
  is_synced BOOLEAN DEFAULT TRUE,
  sequence_index INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  request JSONB DEFAULT '{}'::jsonb,
  response JSONB DEFAULT '{}'::jsonb,
  status_code INTEGER,
  latency_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  theme TEXT DEFAULT 'light',
  language TEXT DEFAULT 'zh-CN',
  notification_settings JSONB DEFAULT '{}'::jsonb,
  ai_preferences JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  service_instance_id UUID NOT NULL REFERENCES service_instances(id) ON DELETE CASCADE,
  execution_type execution_type NOT NULL,
  external_execution_id VARCHAR(255),
  task_id VARCHAR(255),
  title VARCHAR(500) NOT NULL,
  inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  outputs JSONB,
  status execution_status NOT NULL DEFAULT 'pending',
  error_message TEXT,
  total_steps INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  elapsed_time NUMERIC(10, 3),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- =========
-- Indexes
-- =========

CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_auth_source ON profiles(auth_source);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_status ON profiles(status);
CREATE INDEX IF NOT EXISTS idx_profiles_employee_number ON profiles(employee_number) WHERE employee_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_providers_type ON providers(type);
CREATE INDEX IF NOT EXISTS idx_providers_is_active ON providers(is_active);
CREATE UNIQUE INDEX IF NOT EXISTS providers_unique_default ON providers(is_default) WHERE is_default = TRUE;

CREATE INDEX IF NOT EXISTS idx_service_instances_provider_id ON service_instances(provider_id);
CREATE INDEX IF NOT EXISTS idx_service_instances_instance_id ON service_instances(instance_id);
CREATE INDEX IF NOT EXISTS idx_service_instances_visibility ON service_instances(visibility);
CREATE UNIQUE INDEX IF NOT EXISTS idx_service_instances_unique_default_per_provider
  ON service_instances(provider_id)
  WHERE is_default = TRUE;

CREATE INDEX IF NOT EXISTS idx_api_keys_provider_id ON api_keys(provider_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_service_instance_id ON api_keys(service_instance_id);

CREATE INDEX IF NOT EXISTS idx_sso_providers_enabled_order ON sso_providers(enabled, display_order, name);
CREATE INDEX IF NOT EXISTS idx_domain_sso_mappings_provider ON domain_sso_mappings(sso_provider_id);

CREATE INDEX IF NOT EXISTS idx_groups_created_by ON groups(created_by);
CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user_id ON group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_group_app_permissions_group_id ON group_app_permissions(group_id);
CREATE INDEX IF NOT EXISTS idx_group_app_permissions_service_instance_id ON group_app_permissions(service_instance_id);

CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON conversations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_app_status_updated ON conversations(app_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_external_id ON conversations(external_id) WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_external_id ON messages(external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_time_sequence
  ON messages(conversation_id, created_at ASC, sequence_index ASC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_stable_sort
  ON messages(conversation_id, created_at ASC, sequence_index ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_api_logs_conversation_id ON api_logs(conversation_id);
CREATE INDEX IF NOT EXISTS idx_api_logs_user_id ON api_logs(user_id);

CREATE INDEX IF NOT EXISTS idx_app_executions_user_created ON app_executions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_executions_service_instance ON app_executions(service_instance_id);
CREATE INDEX IF NOT EXISTS idx_app_executions_type_status ON app_executions(execution_type, status);
CREATE INDEX IF NOT EXISTS idx_app_executions_external_id ON app_executions(external_execution_id) WHERE external_execution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_app_executions_status ON app_executions(status);

-- =========
-- updated_at triggers
-- =========

DROP TRIGGER IF EXISTS update_profiles_updated_at ON profiles;
CREATE TRIGGER update_profiles_updated_at
BEFORE UPDATE ON profiles
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_providers_updated_at ON providers;
CREATE TRIGGER update_providers_updated_at
BEFORE UPDATE ON providers
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_service_instances_updated_at ON service_instances;
CREATE TRIGGER update_service_instances_updated_at
BEFORE UPDATE ON service_instances
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_api_keys_updated_at ON api_keys;
CREATE TRIGGER update_api_keys_updated_at
BEFORE UPDATE ON api_keys
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_sso_providers_updated_at ON sso_providers;
CREATE TRIGGER update_sso_providers_updated_at
BEFORE UPDATE ON sso_providers
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_auth_settings_updated_at ON auth_settings;
CREATE TRIGGER update_auth_settings_updated_at
BEFORE UPDATE ON auth_settings
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_domain_sso_mappings_updated_at ON domain_sso_mappings;
CREATE TRIGGER update_domain_sso_mappings_updated_at
BEFORE UPDATE ON domain_sso_mappings
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_ai_configs_updated_at ON ai_configs;
CREATE TRIGGER update_ai_configs_updated_at
BEFORE UPDATE ON ai_configs
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_conversations_updated_at ON conversations;
CREATE TRIGGER update_conversations_updated_at
BEFORE UPDATE ON conversations
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_preferences_updated_at ON user_preferences;
CREATE TRIGGER update_user_preferences_updated_at
BEFORE UPDATE ON user_preferences
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_app_executions_updated_at ON app_executions;
CREATE TRIGGER update_app_executions_updated_at
BEFORE UPDATE ON app_executions
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========
-- Compatibility view
-- =========

CREATE OR REPLACE VIEW public_sso_providers AS
SELECT
  id,
  name,
  protocol,
  enabled,
  display_order,
  button_text,
  settings,
  created_at
FROM sso_providers
WHERE enabled = TRUE;

-- =========
-- Core RPC compatibility
-- =========

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
  LIMIT 1;

  IF v_target_permission_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, NULL::INTEGER, 'no permission'::TEXT;
    RETURN;
  END IF;

  IF v_quota IS NOT NULL AND v_used_count >= v_quota THEN
    RETURN QUERY SELECT FALSE, v_used_count, 0, 'quota exceeded'::TEXT;
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

CREATE OR REPLACE FUNCTION get_admin_users(user_ids UUID[] DEFAULT NULL)
RETURNS TABLE (
  id UUID,
  email TEXT,
  phone TEXT,
  email_confirmed_at TIMESTAMPTZ,
  phone_confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  last_sign_in_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
  IF user_ids IS NOT NULL THEN
    RETURN QUERY
    SELECT
      p.id,
      p.email,
      p.phone,
      NULL::TIMESTAMPTZ AS email_confirmed_at,
      NULL::TIMESTAMPTZ AS phone_confirmed_at,
      p.created_at,
      p.updated_at,
      p.last_login AS last_sign_in_at
    FROM profiles p
    WHERE p.id = ANY(user_ids);
  ELSE
    RETURN QUERY
    SELECT
      p.id,
      p.email,
      p.phone,
      NULL::TIMESTAMPTZ AS email_confirmed_at,
      NULL::TIMESTAMPTZ AS phone_confirmed_at,
      p.created_at,
      p.updated_at,
      p.last_login AS last_sign_in_at
    FROM profiles p;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION get_user_stats()
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  result JSON;
BEGIN
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
BEGIN
  IF target_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  DELETE FROM profiles
  WHERE id = target_user_id;

  RETURN FOUND;
END;
$$;

-- =========
-- Grants (optional, only when roles exist)
-- =========

DO $$
BEGIN
  IF to_regrole('authenticated') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION set_default_service_instance(UUID, UUID) TO authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION get_user_accessible_apps(UUID) TO authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION check_user_app_permission(UUID, UUID) TO authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION increment_app_usage(UUID, UUID, INTEGER) TO authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION get_admin_users(UUID[]) TO authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION get_user_stats() TO authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION get_user_detail_for_admin(UUID) TO authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION safe_delete_user(UUID) TO authenticated';
  END IF;

  IF to_regrole('service_role') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION set_default_service_instance(UUID, UUID) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION get_user_accessible_apps(UUID) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION check_user_app_permission(UUID, UUID) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION increment_app_usage(UUID, UUID, INTEGER) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION get_admin_users(UUID[]) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION get_user_stats() TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION get_user_detail_for_admin(UUID) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION safe_delete_user(UUID) TO service_role';
  END IF;
END
$$;

-- =========
-- Seed defaults
-- =========

INSERT INTO auth_settings (id)
VALUES ('00000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE profiles IS 'User profile table used by local PG compatibility layer.';
COMMENT ON TABLE service_instances IS 'Service instance registry for app/provider mapping.';
COMMENT ON TABLE group_app_permissions IS 'Group-level app access and usage quota.';
COMMENT ON TABLE app_executions IS 'Execution history for workflow/text-generation apps.';
