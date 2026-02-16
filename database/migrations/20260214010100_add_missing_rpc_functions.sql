-- 补齐缺失 RPC 函数定义：
-- 1) increment_api_key_usage
-- 2) update_sso_provider_order

-- 1) 增加 API Key 使用次数
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

COMMENT ON FUNCTION increment_api_key_usage(UUID) IS
'Increment usage_count and last_used_at for one API key.';

DO $$
BEGIN
  IF to_regrole('authenticated') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION increment_api_key_usage(UUID) TO authenticated';
  END IF;

  IF to_regrole('service_role') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION increment_api_key_usage(UUID) TO service_role';
  END IF;
END
$$;

-- 2) 批量更新 SSO Provider 显示顺序
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
  IF updates IS NULL OR jsonb_typeof(updates) <> 'array' THEN
    RAISE EXCEPTION 'updates must be a JSON array';
  END IF;

  -- 权限控制依赖调用者角色与表级 RLS/GRANT 规则
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

COMMENT ON FUNCTION update_sso_provider_order(JSONB) IS
'Batch update sso_providers.display_order in one transaction.';

DO $$
BEGIN
  IF to_regrole('authenticated') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION update_sso_provider_order(JSONB) TO authenticated';
  END IF;

  IF to_regrole('service_role') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION update_sso_provider_order(JSONB) TO service_role';
  END IF;
END
$$;
