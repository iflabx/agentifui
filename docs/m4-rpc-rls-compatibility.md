# M4 RPC + RLS 语义迁移（Phase1 + Phase2）

日期：2026-02-15  
分支：`migration/m0-m1-pg-baseline`

## 1. Phase1（RPC/GUC）完成项

1. 新增 GUC 兼容层与 `auth.uid()` shim（`supabase/migrations/20260215030000_m4_rpc_rls_guc_hardening.sql`）。
2. 关键 RPC 权限收口（admin / self+admin）：
   - `set_default_service_instance`
   - `get_user_accessible_apps`
   - `check_user_app_permission`
   - `increment_app_usage`
   - `get_user_stats`
   - `get_user_detail_for_admin`
   - `safe_delete_user`
   - `increment_api_key_usage`
   - `update_sso_provider_order`
3. 并发确定性补强：
   - `increment_app_usage` + `FOR UPDATE`
   - `set_default_service_instance` + `pg_advisory_xact_lock`
4. actor 上下文执行器接入：
   - `lib/server/pg/user-context.ts`
   - `app/api/internal/data/route.ts`
   - `lib/db/group-permissions.ts`
   - `lib/db/users.ts`
   - `lib/db/sso-providers.ts`

## 2. Phase2（表级 RLS）完成项

1. 新增核心表 RLS 迁移包：`supabase/migrations/20260215050000_m4_table_rls_phase2.sql`。
2. 对以下核心表启用 `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`：
   - `profiles`
   - `conversations`
   - `messages`
   - `groups`
   - `group_members`
   - `group_app_permissions`
   - `app_executions`
3. 引入 RLS helper 函数与 actor 角色上下文：
   - `app_actor_role()`
   - `app_actor_is_admin()`（优先使用 `app.current_user_role`，兼容 fallback）
   - `app_rls_legacy_mode()`
   - `app_rls_self_or_admin()`
   - `app_rls_group_member()`
   - `app_rls_conversation_owner()`
4. 服务端上下文注入扩展为双 GUC：
   - `app.current_user_id`
   - `app.current_user_role`
5. 新增表级 RLS gate 脚本：`scripts/m4-table-rls-verify.mjs`。

## 3. 验证与 Gate

命令：

1. `pnpm m4:rpc:verify`
2. `pnpm m4:rls:verify`
3. `pnpm m4:gate:verify`（聚合 1 + 2）

当前结果（2026-02-15）：上述三项均通过。

## 4. 兼容性策略

1. 保持“有 actor 强约束、无 actor 兼容旧行为”：
   - 有 actor：执行 RLS 与 RPC 权限收口。
   - 无 actor：`app_rls_legacy_mode()` 允许旧链路继续工作。
2. 不改变前端调用契约：仍走 existing internal API action。

## 5. 当前边界

1. Phase2 聚焦“核心业务表”RLS；其余表的全量收口可在 M4 后续批次继续扩展。
2. Storage / Realtime 不在 M4 范围（分别属于 M5 / M6）。
