# M4 RPC + RLS 语义迁移（第一批）

日期：2026-02-15  
分支：`migration/m0-m1-pg-baseline`

## 1. 本批次完成项

1. 新增 GUC 兼容层与 `auth.uid()` shim（迁移文件：`supabase/migrations/20260215030000_m4_rpc_rls_guc_hardening.sql`）。
2. 新增函数级权限收口（在注入 actor 上下文时生效）：
   - `set_default_service_instance`（admin）
   - `get_user_accessible_apps`（self/admin）
   - `check_user_app_permission`（self/admin）
   - `increment_app_usage`（self/admin）
   - `get_user_stats`（admin）
   - `get_user_detail_for_admin`（admin）
   - `safe_delete_user`（admin，禁止删除当前 actor）
   - `increment_api_key_usage`（admin）
   - `update_sso_provider_order`（admin）
3. 并发确定性补强：
   - `increment_app_usage` 对目标 `group_app_permissions` 行加 `FOR UPDATE`，避免并发超扣配额。
   - `set_default_service_instance` 使用 `pg_advisory_xact_lock`（按 provider 串行化）避免默认实例竞争翻转异常。
4. 新增服务端上下文执行器：`lib/server/pg/user-context.ts`（事务内注入 `app.current_user_id`）。
5. internal-data 路由透传 actor 到关键 DB 操作，驱动 DB 侧权限语义落地：
   - `app/api/internal/data/route.ts`
   - `lib/db/group-permissions.ts`
   - `lib/db/users.ts`
   - `lib/db/sso-providers.ts`

## 2. 验证与 Gate

新增命令：

- `pnpm m4:rpc:verify`  
  执行 `scripts/m4-rpc-rls-verify.mjs`，覆盖：
  - 正常输入返回结构
  - 越权拒绝（`42501`）
  - 不存在主键错误语义
  - 并发冲突确定性（配额、默认实例）
- `pnpm m4:gate:verify`  
  当前聚合 `m4:rpc:verify`。

## 3. 兼容性说明

1. 为避免一次性破坏历史调用，本批次采用“有 actor 即强约束、无 actor 保持旧行为”策略。
2. 当前收口优先覆盖 RPC 层；全表 RLS policy 的批量迁移仍在 M4 后续批次推进。
3. 前端调用面保持兼容：仍通过现有 internal API 动作名访问。

## 4. 本批次边界

1. 仅关键 RPC 进入 actor/GUC 强约束路径，非关键函数暂未统一。
2. 旧迁移中的大规模 `auth.uid()` policy 仍需分批迁移到本地 PG 的可运维策略包。
3. Storage / Realtime 不在本批次范围（分别属于 M5 / M6）。
