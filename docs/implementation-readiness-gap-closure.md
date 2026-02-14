# AgentifUI 迁移实施前补齐包（可执行版）

分析日期：2026-02-14

## 1. 结论与用途

用途：补齐“已完成深度分析”到“可直接做实施计划（WBS）”之间的缺口。

当前判定：

- 决策层文档已足够：`docs/target-stack-deep-analysis.md:1`
- 实施前仍有 P0 缺口：`docs/target-stack-deep-analysis.md:347`

本文件输出 4 类可执行补齐件：

1. RPC 契约与缺失项闭环
2. 量化 SLO/SLI 门槛
3. 数据对账 SQL 模板
4. 切换与回滚触发条件（含 RTO/RPO）

## 2. P0 缺口清单（必须先闭环）

1. 缺失 RPC 定义追溯

- `increment_api_key_usage` 调用存在：`lib/db/api-keys.ts:198`
- `update_sso_provider_order` 调用存在：`lib/db/sso-providers.ts:322`
- 当前 `supabase/migrations` 未检索到上述函数定义（需补齐迁移来源或重建函数）。

2. 管理 API 鉴权治理

- `app/api/admin/status/route.ts` 未显式鉴权：`app/api/admin/status/route.ts:8`
- `app/api/admin/translations/route.ts` 未显式鉴权入口：`app/api/admin/translations/route.ts:164`

3. 切换门槛缺少量化阈值

- 已有“满足 SLO”文字，但未量化：`docs/target-stack-deep-analysis.md:240`, `docs/target-stack-deep-analysis.md:333`

4. 对账方案缺少脚本级定义

- 已有维度但未给 SQL 模板：`docs/target-stack-deep-analysis.md:244`

## 3. RPC 契约矩阵（实施基线）

### 3.1 已可追溯函数（代码 + SQL）

| 函数                           | 调用点                                            | SQL 定义                                                                             | 迁移状态 |
| ------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------ | -------- |
| `get_user_accessible_apps`     | `lib/db/group-permissions.ts:472`                 | `supabase/migrations/20250630021741_migrate_to_groups_system.sql:153`                | 已追溯   |
| `check_user_app_permission`    | `lib/db/group-permissions.ts:498`                 | `supabase/migrations/20250630021741_migrate_to_groups_system.sql:200`                | 已追溯   |
| `increment_app_usage`          | `lib/db/group-permissions.ts:543`                 | `supabase/migrations/20250630021741_migrate_to_groups_system.sql:260`                | 已追溯   |
| `get_admin_users`              | `lib/db/users.ts:146`                             | `supabase/migrations/20250609214000_add_admin_user_functions.sql:7`                  | 已追溯   |
| `get_user_stats`               | `lib/db/users.ts:255`                             | `supabase/migrations/20250609214000_add_admin_user_functions.sql:63`                 | 已追溯   |
| `get_user_detail_for_admin`    | `lib/db/users.ts:282`                             | `supabase/migrations/20250601000100_fix_user_view_security.sql:240`                  | 已追溯   |
| `safe_delete_user`             | `lib/db/users.ts:383`                             | `supabase/migrations/20250610000000_add_safe_user_deletion.sql:7`                    | 已追溯   |
| `set_default_service_instance` | `lib/db/service-instances.ts:372`                 | `supabase/migrations/20250529151827_add_set_default_service_instance_function.sql:4` | 已追溯   |
| `get_sso_provider_config`      | `lib/services/sso/generic-cas-service.ts:399`     | `supabase/migrations/20250709101517_fix_sso_login_secure_complete.sql:65`            | 已追溯   |
| `update_sso_user_login`        | `lib/services/admin/user/sso-user-service.ts:533` | `supabase/migrations/20250617185202_add_cas_sso_data.sql:221`                        | 已追溯   |

### 3.2 缺失函数（必须补齐）

| 函数                        | 调用点                        | 当前状态             | 处理要求                                          |
| --------------------------- | ----------------------------- | -------------------- | ------------------------------------------------- |
| `increment_api_key_usage`   | `lib/db/api-keys.ts:198`      | 未在迁移中检索到定义 | 先从现网导出定义，补迁移；若不存在则新建函数+回归 |
| `update_sso_provider_order` | `lib/db/sso-providers.ts:322` | 未在迁移中检索到定义 | 同上                                              |

### 3.3 现网导出脚本（先做）

```sql
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS args,
  pg_get_functiondef(p.oid) AS ddl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname IN ('increment_api_key_usage', 'update_sso_provider_order')
ORDER BY 1,2,3;
```

### 3.4 契约回归（最小用例）

每个函数至少包含：

1. 正常输入 -> 预期返回结构
2. 越权用户 -> 预期拒绝
3. 不存在主键 -> 预期错误码/错误消息
4. 并发冲突 -> 结果确定性（尤其配额、默认实例）

## 4. 量化 SLO/SLI（用于切流门槛）

### 4.1 API 与鉴权

1. 登录相关接口（`/api/auth/*`, `/api/sso/*`）

- `p95 <= 300ms`
- `p99 <= 800ms`
- `5xx < 0.3%`

2. 核心业务接口（`/api/dify/*`, `/api/db/*`）

- 读请求 `p95 <= 350ms`
- 写请求 `p95 <= 700ms`
- `5xx < 0.5%`

### 4.2 Realtime

1. 事件送达延迟（DB commit -> 前端收到）

- `p95 <= 1s`
- `p99 <= 2s`

2. 事件丢失率（按窗口对账）

- `< 0.1%`

### 4.3 存储（MinIO）

1. 预签名 URL 获取

- `p95 <= 150ms`

2. 上传成功率（<=10MB）

- `>= 99.9%`

### 4.4 可用性与恢复

1. 月可用性目标

- `>= 99.9%`

2. 故障恢复目标

- `RTO <= 15 分钟`
- `RPO <= 1 分钟`

## 5. 数据对账 SQL 模板（可直接执行）

说明：以下 SQL 用于“源库 vs 目标库”双边执行后比对结果。

### 5.1 行数对账

```sql
SELECT 'profiles' t, COUNT(*) c FROM profiles
UNION ALL
SELECT 'conversations', COUNT(*) FROM conversations
UNION ALL
SELECT 'messages', COUNT(*) FROM messages
UNION ALL
SELECT 'app_executions', COUNT(*) FROM app_executions
UNION ALL
SELECT 'groups', COUNT(*) FROM groups
UNION ALL
SELECT 'group_members', COUNT(*) FROM group_members
UNION ALL
SELECT 'group_app_permissions', COUNT(*) FROM group_app_permissions
UNION ALL
SELECT 'service_instances', COUNT(*) FROM service_instances
UNION ALL
SELECT 'api_keys', COUNT(*) FROM api_keys
UNION ALL
SELECT 'sso_providers', COUNT(*) FROM sso_providers;
```

### 5.2 分桶对账（按用户）

```sql
SELECT user_id, COUNT(*) AS conv_count
FROM conversations
GROUP BY user_id
ORDER BY user_id;

SELECT user_id, COUNT(*) AS msg_count
FROM messages
GROUP BY user_id
ORDER BY user_id;

SELECT user_id, COUNT(*) AS exec_count
FROM app_executions
GROUP BY user_id
ORDER BY user_id;
```

### 5.3 关键字段哈希对账

```sql
SELECT md5(string_agg(
  id::text || '|' ||
  COALESCE(external_id,'') || '|' ||
  user_id::text || '|' ||
  COALESCE(status,'') || '|' ||
  COALESCE(updated_at::text,'')
, '||' ORDER BY id)) AS conversations_checksum
FROM conversations;

SELECT md5(string_agg(
  id::text || '|' ||
  conversation_id::text || '|' ||
  role::text || '|' ||
  COALESCE(sequence_index::text,'') || '|' ||
  COALESCE(created_at::text,'')
, '||' ORDER BY id)) AS messages_checksum
FROM messages;
```

### 5.4 约束与一致性对账

```sql
-- orphan message
SELECT COUNT(*) AS orphan_messages
FROM messages m
LEFT JOIN conversations c ON c.id = m.conversation_id
WHERE c.id IS NULL;

-- group quota sanity
SELECT COUNT(*) AS invalid_quota_rows
FROM group_app_permissions
WHERE usage_quota IS NOT NULL
  AND used_count > usage_quota;

-- execution status enum sanity
SELECT status, COUNT(*)
FROM app_executions
GROUP BY status
ORDER BY status;
```

### 5.5 存储对象对账（头像/内容图）

1. 从 DB 导出引用路径

- `profiles.avatar_url`（头像）
- 内容编辑 JSON 中引用路径（如 `content-images/user-{uid}/...`）

2. 从 MinIO 导出对象清单

- `avatars/`
- `content-images/`

3. 比对指标

- 未引用对象率（孤儿对象率）
- 失联引用率（DB 引用但对象不存在）
- 目标阈值：两者均 `<= 0.1%`

## 6. 切换与回滚 Runbook（量化触发）

### 6.1 灰度节奏

1. 5%（30 分钟）
2. 20%（60 分钟）
3. 50%（120 分钟）
4. 100%（稳定 24 小时）

每一阶段都要执行：

- 错误率看板
- 延迟看板
- 对账抽样
- 关键路径冒烟（登录、聊天、权限、上传、SSO）

### 6.2 回滚触发条件（任一满足立即回滚）

1. `5xx` 连续 5 分钟 > `1.0%`
2. Realtime 送达延迟 `p95 > 2s` 持续 10 分钟
3. 登录失败率 > `1.0%` 持续 5 分钟
4. 数据对账出现不可解释差异（关键表误差 > 0）
5. 管理员权限越权或鉴权绕过事件

### 6.3 回滚动作（顺序）

1. 网关流量切回旧链路
2. 停止新链路写入（保留只读用于取证）
3. 触发回滚告警与变更冻结
4. 导出回滚窗口内差异数据
5. 执行复盘并更新阻断项

## 7. 管理 API 鉴权收敛（实施前必做）

统一改造目标：

- `app/api/admin/**` 必须通过统一 `requireAdmin()` 入口。
- 禁止路由内“遗漏鉴权”的分散实现。

优先修复：

1. `app/api/admin/status/route.ts:8`
2. `app/api/admin/translations/route.ts:164`

可复用现有鉴权样式参考：

- `app/api/admin/users/route.ts:13`
- `app/api/admin/users/for-group/route.ts:13`
- `app/api/admin/encrypt/route.ts:44`

## 8. 进入任务计划前的最终 Gate

全部满足才进入 WBS 编排：

1. RPC 缺失项补齐并合入迁移
2. Admin 鉴权收敛完成
3. SLO 基线确认并接入监控
4. 对账 SQL 在预发跑通并归档结果
5. 灰度回滚演练完成（至少 1 次）

满足后，可以开始“实施任务计划（里程碑/人天/依赖）”。
