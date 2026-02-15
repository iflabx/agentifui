-- M4: RPC + RLS 语义迁移（第二批）
-- 目标：
-- 1) 核心业务表启用 FORCE RLS
-- 2) 通过 app.current_user_id + app.current_user_role 承载 actor 身份
-- 3) 在保留 legacy（无 actor）兼容的前提下，收口 actor 场景下的越权访问

SET search_path = public;

-- =========================
-- Actor/GUC helpers
-- =========================

CREATE OR REPLACE FUNCTION app_actor_role()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_user_role', true), '')
$$;

CREATE OR REPLACE FUNCTION app_actor_is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_actor UUID := app_actor_user_id();
  v_role TEXT := app_actor_role();
BEGIN
  IF v_actor IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Fast path: when role is explicitly injected by application context.
  IF v_role IS NOT NULL THEN
    RETURN v_role = 'admin';
  END IF;

  -- Fallback path: allows compatibility for callers that only inject user_id.
  RETURN EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.id = v_actor
      AND p.role = 'admin'
  );
END;
$$;

CREATE OR REPLACE FUNCTION app_rls_legacy_mode()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT app_actor_user_id() IS NULL
$$;

CREATE OR REPLACE FUNCTION app_rls_self_or_admin(target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT
    app_rls_legacy_mode()
    OR (
      target_user_id IS NOT NULL
      AND app_actor_user_id() = target_user_id
    )
    OR app_actor_is_admin()
$$;

CREATE OR REPLACE FUNCTION app_rls_group_member(target_group_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT
    app_rls_legacy_mode()
    OR app_actor_is_admin()
    OR EXISTS (
      SELECT 1
      FROM group_members gm
      WHERE gm.group_id = target_group_id
        AND gm.user_id = app_actor_user_id()
    )
$$;

CREATE OR REPLACE FUNCTION app_rls_conversation_owner(target_conversation_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT
    app_rls_legacy_mode()
    OR app_actor_is_admin()
    OR EXISTS (
      SELECT 1
      FROM conversations c
      WHERE c.id = target_conversation_id
        AND c.user_id = app_actor_user_id()
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
    'profiles',
    'conversations',
    'messages',
    'groups',
    'group_members',
    'group_app_permissions',
    'app_executions'
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

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles FORCE ROW LEVEL SECURITY;

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations FORCE ROW LEVEL SECURITY;

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE ROW LEVEL SECURITY;

ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups FORCE ROW LEVEL SECURITY;

ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members FORCE ROW LEVEL SECURITY;

ALTER TABLE group_app_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_app_permissions FORCE ROW LEVEL SECURITY;

ALTER TABLE app_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_executions FORCE ROW LEVEL SECURITY;

-- =========================
-- profiles
-- =========================

CREATE POLICY m4_profiles_select
ON profiles
FOR SELECT
USING (
  app_rls_legacy_mode()
  OR id = app_actor_user_id()
  OR app_actor_role() = 'admin'
);

CREATE POLICY m4_profiles_insert
ON profiles
FOR INSERT
WITH CHECK (
  app_rls_legacy_mode()
  OR id = app_actor_user_id()
  OR app_actor_role() = 'admin'
);

CREATE POLICY m4_profiles_update
ON profiles
FOR UPDATE
USING (
  app_rls_legacy_mode()
  OR id = app_actor_user_id()
  OR app_actor_role() = 'admin'
)
WITH CHECK (
  app_rls_legacy_mode()
  OR id = app_actor_user_id()
  OR app_actor_role() = 'admin'
);

CREATE POLICY m4_profiles_delete
ON profiles
FOR DELETE
USING (
  app_rls_legacy_mode()
  OR id = app_actor_user_id()
  OR app_actor_role() = 'admin'
);

-- =========================
-- conversations
-- =========================

CREATE POLICY m4_conversations_select
ON conversations
FOR SELECT
USING (app_rls_self_or_admin(user_id));

CREATE POLICY m4_conversations_insert
ON conversations
FOR INSERT
WITH CHECK (app_rls_self_or_admin(user_id));

CREATE POLICY m4_conversations_update
ON conversations
FOR UPDATE
USING (app_rls_self_or_admin(user_id))
WITH CHECK (app_rls_self_or_admin(user_id));

CREATE POLICY m4_conversations_delete
ON conversations
FOR DELETE
USING (app_rls_self_or_admin(user_id));

-- =========================
-- messages
-- =========================

CREATE POLICY m4_messages_select
ON messages
FOR SELECT
USING (app_rls_conversation_owner(conversation_id));

CREATE POLICY m4_messages_insert
ON messages
FOR INSERT
WITH CHECK (app_rls_conversation_owner(conversation_id));

CREATE POLICY m4_messages_update
ON messages
FOR UPDATE
USING (app_rls_conversation_owner(conversation_id))
WITH CHECK (app_rls_conversation_owner(conversation_id));

CREATE POLICY m4_messages_delete
ON messages
FOR DELETE
USING (app_rls_conversation_owner(conversation_id));

-- =========================
-- groups
-- =========================

CREATE POLICY m4_groups_select
ON groups
FOR SELECT
USING (app_rls_group_member(id));

CREATE POLICY m4_groups_insert
ON groups
FOR INSERT
WITH CHECK (app_rls_legacy_mode() OR app_actor_is_admin());

CREATE POLICY m4_groups_update
ON groups
FOR UPDATE
USING (app_rls_legacy_mode() OR app_actor_is_admin())
WITH CHECK (app_rls_legacy_mode() OR app_actor_is_admin());

CREATE POLICY m4_groups_delete
ON groups
FOR DELETE
USING (app_rls_legacy_mode() OR app_actor_is_admin());

-- =========================
-- group_members
-- =========================

CREATE POLICY m4_group_members_select
ON group_members
FOR SELECT
USING (
  app_rls_legacy_mode()
  OR app_actor_is_admin()
  OR user_id = app_actor_user_id()
);

CREATE POLICY m4_group_members_insert
ON group_members
FOR INSERT
WITH CHECK (app_rls_legacy_mode() OR app_actor_is_admin());

CREATE POLICY m4_group_members_update
ON group_members
FOR UPDATE
USING (app_rls_legacy_mode() OR app_actor_is_admin())
WITH CHECK (app_rls_legacy_mode() OR app_actor_is_admin());

CREATE POLICY m4_group_members_delete
ON group_members
FOR DELETE
USING (app_rls_legacy_mode() OR app_actor_is_admin());

-- =========================
-- group_app_permissions
-- =========================

CREATE POLICY m4_group_app_permissions_select
ON group_app_permissions
FOR SELECT
USING (app_rls_group_member(group_id));

CREATE POLICY m4_group_app_permissions_insert
ON group_app_permissions
FOR INSERT
WITH CHECK (app_rls_legacy_mode() OR app_actor_is_admin());

CREATE POLICY m4_group_app_permissions_update
ON group_app_permissions
FOR UPDATE
USING (app_rls_group_member(group_id))
WITH CHECK (app_rls_group_member(group_id));

CREATE POLICY m4_group_app_permissions_delete
ON group_app_permissions
FOR DELETE
USING (app_rls_legacy_mode() OR app_actor_is_admin());

-- =========================
-- app_executions
-- =========================

CREATE POLICY m4_app_executions_select
ON app_executions
FOR SELECT
USING (app_rls_self_or_admin(user_id));

CREATE POLICY m4_app_executions_insert
ON app_executions
FOR INSERT
WITH CHECK (app_rls_self_or_admin(user_id));

CREATE POLICY m4_app_executions_update
ON app_executions
FOR UPDATE
USING (app_rls_self_or_admin(user_id))
WITH CHECK (app_rls_self_or_admin(user_id));

CREATE POLICY m4_app_executions_delete
ON app_executions
FOR DELETE
USING (app_rls_self_or_admin(user_id));

COMMENT ON FUNCTION app_actor_role() IS
'M4 phase2: actor role resolved from app.current_user_role GUC.';
