# M1 本地 PostgreSQL 基线落地说明

日期：2026-02-14  
阶段：M1（Schema/RPC 兼容基线）

## 1. 已新增内容

1. 基线迁移 SQL：
   - `database/migrations/20260214020100_create_local_pg_baseline_schema.sql`
2. 一键验证脚本：
   - `scripts/m1-schema-verify.sh`
3. npm 脚本：
   - `pnpm m1:schema:verify`

## 2. 基线覆盖范围

## 2.1 核心表

1. `profiles`
2. `providers`
3. `service_instances`
4. `api_keys`
5. `sso_providers`
6. `groups`
7. `group_members`
8. `group_app_permissions`
9. `conversations`
10. `messages`
11. `app_executions`

同时补齐了兼容链路常用表：`auth_settings`、`domain_sso_mappings`、`ai_configs`、`api_logs`、`user_preferences`。

## 2.2 关键 RPC

1. `set_default_service_instance(uuid, uuid)`
2. `get_user_accessible_apps(uuid)`
3. `check_user_app_permission(uuid, uuid)`
4. `increment_app_usage(uuid, uuid, integer)`
5. `get_admin_users(uuid[])`
6. `get_user_stats()`
7. `get_user_detail_for_admin(uuid)`
8. `safe_delete_user(uuid)`

以及 M0 已补齐函数：

1. `increment_api_key_usage(uuid)`
2. `update_sso_provider_order(jsonb)`

## 3. 验证方式

执行：

```bash
pnpm m1:schema:verify
```

默认连接：

```text
postgresql://agentif:agentif@172.20.0.1:5432/agentifui
```

可覆盖：

```bash
PGURL='postgresql://user:pass@host:5432/db' pnpm m1:schema:verify
```

## 4. 当前结论

1. 所需核心表检查通过。
2. 所需关键函数检查通过。
3. 事务内烟测通过（建数 -> RPC 调用 -> 回滚）。
4. 可进入下一步：M2（Auth/BFF 接入）或 M3（Drizzle Repo 替换 Supabase CRUD）。
