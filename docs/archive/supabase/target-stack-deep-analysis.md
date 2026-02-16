# AgentifUI 目标技术栈深度完整分析（PostgreSQL 18 + Drizzle + Redis 7.x + MinIO + better-auth）

分析日期：2026-02-14

## 1. 结论先行

结论：该目标栈**可以完整替代** Supabase，但必须补齐若干基础组件与治理能力；否则只能替代“数据库存储”，无法替代“平台能力”。

核心判断：

- 现有项目对 Supabase 的依赖不是单一数据库，而是 Auth + RLS/RPC + Storage + Realtime 的组合平台能力：`package.json:75`, `package.json:76`, `lib/supabase/client.ts:1`, `lib/services/db/realtime-service.ts:94`, `lib/hooks/use-avatar-upload.ts:143`。
- 代码与 SQL 资产规模已达到“重构级迁移”：`supabase/migrations` 有 96 个迁移文件（项目分析文档已记录）：`docs/archive/supabase/project-architecture-analysis.md:82`。
- 若目标是“前端页面与交互基本不变”，最佳路线不是重写，而是“兼容层 + 分阶段切流”。

本文按 10 个分析维度完整给出结论、缺口与实施基线。

## 2. 分析范围与假设

范围：

- 目标栈：PostgreSQL 18、Drizzle ORM、Redis 7.x、MinIO、better-auth。
- 目标：尽量保持现有数据结构与前端交互语义。
- 输出：可直接进入任务计划的分析基线（含验收门槛）。

关键证据基线：

- 运行时 Supabase 客户端入口：`lib/supabase/client.ts:1`, `lib/supabase/server.ts:10`, `lib/supabase/server.ts:38`。
- 中间件鉴权/角色/状态拦截：`middleware.ts:102`, `middleware.ts:116`, `middleware.ts:156`。
- 数据层统一服务 + 内存缓存 + Realtime：`lib/services/db/data-service.ts:7`, `lib/services/db/cache-service.ts:16`, `lib/services/db/realtime-service.ts:66`。

## 3. 分析一：能力差距矩阵（Supabase -> 目标栈）

| Supabase 能力               | 当前项目用法                                                                                                                                                                                                                                                                                             | 目标栈对应能力                                     | 结论                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------- |
| Postgres 数据访问           | 大量 `.from(...).select/insert/update/delete`                                                                                                                                                                                                                                                            | PostgreSQL 18 + Drizzle + BFF                      | 可替代                 |
| Auth（邮箱/OAuth/OTP/重置） | `signInWithPassword/signUp/signInWithOAuth/signInWithOtp/verifyOtp/resetPasswordForEmail`：`components/auth/login-form.tsx:51`, `components/auth/register-form.tsx:75`, `components/auth/social-auth-buttons.tsx:45`, `components/auth/phone-auth.tsx:36`, `components/auth/forgot-password-form.tsx:33` | better-auth + OAuth provider + SMTP + SMS provider | 可替代，但需外部供应商 |
| CAS SSO                     | 回调 + session 建立链路：`app/api/sso/[providerId]/callback/route.ts:65`, `app/api/auth/sso-signin/route.ts:103`                                                                                                                                                                                         | better-auth 自定义 provider/插件 + 自建 CAS 适配   | 可替代，但需自研适配   |
| RLS + RPC                   | 群组权限和配额核心依赖 RPC：`lib/db/group-permissions.ts:472`, `lib/db/group-permissions.ts:498`, `lib/db/group-permissions.ts:543`                                                                                                                                                                      | PostgreSQL 原生 RLS + SQL 函数（Drizzle 不替代）   | 可替代                 |
| Storage                     | 头像/内容图直连 SDK：`lib/hooks/use-avatar-upload.ts:143`, `lib/services/content-image-upload-service.ts:150`                                                                                                                                                                                            | MinIO + 预签名 URL + 对象 ACL 策略                 | 可替代                 |
| Realtime(postgres_changes)  | `channel().on('postgres_changes')`：`lib/services/db/realtime-service.ts:94`, `lib/supabase/hooks.ts:243`                                                                                                                                                                                                | Redis Pub/Sub/Streams + WS/SSE Gateway             | 可替代，需新增网关     |

结论：

- “五件套”是核心，但还需补齐：BFF 网关、Realtime 网关、连接池、消息与邮件通道、可观测性与备份体系。

## 4. 分析二：数据库对象全量盘点（迁移对象基线）

### 4.1 迁移资产规模（历史）

- 迁移文件数：96（`supabase/migrations`）：`docs/archive/supabase/project-architecture-analysis.md:82`。
- 历史对象统计（基于迁移文本扫描）：
- `CREATE TABLE` 22
- `CREATE OR REPLACE FUNCTION` 95
- `CREATE POLICY` 122
- `ENABLE RLS` 34
- `CREATE VIEW` 9
- `CREATE TRIGGER` 30
- `CREATE TYPE` 11

说明：以上为“历史累计”，最终生效对象以当前 schema 为准。

### 4.2 当前运行时 schema 基线（以 `lib/supabase/types.ts` 为准）

- 表：16 个  
  `ai_configs` `api_keys` `api_logs` `app_executions` `auth_settings` `conversations` `domain_sso_mappings` `group_app_permissions` `group_members` `groups` `messages` `profiles` `providers` `service_instances` `sso_providers` `user_preferences`：`lib/supabase/types.ts:17`, `lib/supabase/types.ts:700`
- 视图：1 个  
  `public_sso_providers`：`lib/supabase/types.ts:732`
- 函数：29 个（关键函数见第 6 节）  
  示例：`check_user_app_permission` `get_user_accessible_apps` `increment_app_usage` `safe_delete_user` `set_default_service_instance`：`lib/supabase/types.ts:747`, `lib/supabase/types.ts:998`
- 枚举：7 个  
  `account_status` `execution_status` `execution_type` `message_role` `message_status` `sso_protocol` `user_role`：`lib/supabase/types.ts:1030`

### 4.3 Storage 资产基线

- Bucket：`avatars`、`content-images`：`supabase/migrations/20250628210700_setup_avatar_storage.sql:8`, `supabase/migrations/20250930172735_setup_content_images_storage.sql:8`
- 对象策略关键差异：
- 头像曾经要求 `user-{uid}` 路径：`supabase/migrations/20250628210700_setup_avatar_storage.sql:37`
- 后续头像策略放宽为“认证即可上传，路径由应用控制”：`supabase/migrations/20250628214015_create_avatar_storage_properly.sql:24`
- content-images 仍保持 `user-{uid}` 路径约束：`supabase/migrations/20250930172735_setup_content_images_storage.sql:37`

### 4.4 盘点结论

- 数据库迁移可行，但必须分两层管理：
- Drizzle 管理表结构、索引、常规变更。
- SQL migration 管理 RLS/函数/触发器/安全视图（不要“全 ORM 化”）。

## 5. 分析三：鉴权与授权重建设计

### 5.1 当前鉴权语义

- 中间件使用 `getUser()` 做 token 真伪校验，并读取 `profiles(role,status)` 执行二次授权：`middleware.ts:110`, `middleware.ts:156`, `middleware.ts:196`
- 前端依赖 session 变化事件：
- `getSession()` + `onAuthStateChange()`：`lib/supabase/hooks.ts:24`, `lib/supabase/hooks.ts:39`
- SSO 特殊链路：CAS 回调 -> SSO signin API -> session 建立：`app/api/sso/[providerId]/callback/route.ts:65`, `app/api/auth/sso-signin/route.ts:103`

### 5.2 目标态（better-auth + PG RLS）

建议授权分层：

1. 应用层（BFF）

- 负责登录态校验、路由级权限、管理员入口。

2. 数据库层（RLS + SQL 函数）

- 负责最终数据访问约束，避免“只靠 API 代码判断”。

3. 会话与幂等层（Redis）

- 存 session、nonce、短时幂等键、防重入键。

### 5.3 RLS 迁移建议（关键）

现有策略大量使用 `auth.uid()`（Supabase 注入上下文），迁移后建议改为应用注入 GUC：

```sql
-- 每个事务开始时由 BFF 注入
SELECT set_config('app.user_id', $1, true);
SELECT set_config('app.user_role', $2, true);
```

RLS 示例改造方向：

```sql
USING (user_id::text = current_setting('app.user_id', true))
```

### 5.4 鉴权重建风险点

- 当前有 API 存在未显式鉴权风险：`app/api/admin/status/route.ts:8`, `app/api/admin/translations/route.ts:164`
- 迁移时必须统一收敛为 `requireAuth/requireAdmin` 中间件。

## 6. 分析四：SQL/RPC 语义等价验证

### 6.1 代码实际调用的 RPC

调用点包含：

- `get_user_accessible_apps`：`lib/db/group-permissions.ts:472`
- `check_user_app_permission`：`lib/db/group-permissions.ts:498`
- `increment_app_usage`：`lib/db/group-permissions.ts:543`
- `get_user_stats`：`lib/db/users.ts:255`
- `get_user_detail_for_admin`：`lib/db/users.ts:282`
- `safe_delete_user`：`lib/db/users.ts:383`
- `set_default_service_instance`：`lib/db/service-instances.ts:372`
- 还包括 `increment_api_key_usage`、`update_sso_provider_order`：`lib/db/api-keys.ts:198`, `lib/db/sso-providers.ts:322`

### 6.2 迁移定义可追溯性检查

- 已在迁移中可追溯定义：
- `get_user_accessible_apps/check_user_app_permission/increment_app_usage`：`supabase/migrations/20250630021741_migrate_to_groups_system.sql:153`, `supabase/migrations/20250630021741_migrate_to_groups_system.sql:200`, `supabase/migrations/20250630021741_migrate_to_groups_system.sql:260`
- `get_user_stats`：`supabase/migrations/20250609214000_add_admin_user_functions.sql:63`
- `get_user_detail_for_admin`：`supabase/migrations/20250601000100_fix_user_view_security.sql:240`
- `safe_delete_user`：`supabase/migrations/20250610000000_add_safe_user_deletion.sql:7`
- `set_default_service_instance`：`supabase/migrations/20250529151827_add_set_default_service_instance_function.sql:4`

- 未在 `supabase/migrations` 检索到定义（需补齐）：
- `increment_api_key_usage`
- `update_sso_provider_order`

### 6.3 语义等价测试模板（必须）

每个 RPC 必须至少覆盖：

1. 输入参数验证（null/非法/越权）
2. 返回结构一致性（字段名、空值语义）
3. 副作用一致性（例如配额扣减、默认实例切换）
4. 并发一致性（同一资源并发更新）
5. 事务回滚一致性（中途失败后状态）

## 7. 分析五：Redis 职责与一致性策略

### 7.1 当前可迁移到 Redis 的现有内存能力

- 进程内 TTL 缓存：`lib/services/db/cache-service.ts:16`
- SSO 并发请求去重 Map：`app/api/auth/sso-signin/route.ts:12`

### 7.2 建议 Redis 角色拆分

1. Session Store

- better-auth session、refresh token、登录态黑名单。

2. 幂等与去重

- SSO signin 防重键：`idempotency:sso:{userId}:{loginTime}`。

3. 缓存

- 用户资料、应用列表、会话列表、配置数据。

4. 分布式锁

- 配额扣减、默认实例切换、关键状态机推进。

5. Realtime 中转

- PG 事件 -> Redis Streams -> WS/SSE 扇出。

### 7.3 Key/TTL 基线建议

- `sess:*`：按登录会话策略（例如 7d/30d）
- `cache:user:profile:*`：5m
- `cache:app:list:*`：2m
- `idem:sso:*`：1m
- `lock:quota:*`：5-10s
- `stream:realtime:*`：按消费延迟与回放窗口保留

### 7.4 一致性策略（必须明确）

- Cache-aside + 事件失效（写后删缓存）
- 对强一致业务（配额、权限）优先读 DB
- 对展示数据（列表、简介）优先读缓存

## 8. 分析六：迁移路径与切换 Runbook

### 8.1 建议阶段

1. Phase 0：基线冻结

- 冻结 schema 变更窗口，补齐函数缺失项。

2. Phase 1：引入兼容层（不切流）

- 新建 BFF 与 backend-client 适配层。

3. Phase 2：Auth 切换

- better-auth + CAS 适配，保留原页面交互。

4. Phase 3：DB CRUD 切换

- Drizzle Repo 接管 `.from(...)` 路径。

5. Phase 4：Storage 切换

- MinIO 预签名 URL，替换直连 SDK。

6. Phase 5：Realtime 切换

- Redis + WS/SSE 替代 `postgres_changes`。

7. Phase 6：灰度 + 双读对比

- 新旧路径并行比对，逐步流量放量。

8. Phase 7：正式切流与清理

- 移除 Supabase SDK、旧环境变量、旧依赖。

### 8.2 切换前硬门槛

- 鉴权一致性：登录、登出、会话过期、账号状态拦截全部通过。
- RPC 语义一致性：关键函数回归全通过。
- 存储一致性：上传/删除/URL 行为一致。
- Realtime 一致性：消息与会话更新延迟满足目标 SLO。

## 9. 分析七：数据校验与对账方案

### 9.1 对账维度

1. 行数对账

- 按表总量和按 `user_id` 分桶对账。

2. 关键字段哈希对账

- 例如 `conversations/messages/app_executions/profiles`。

3. 业务约束对账

- 配额字段、可见性规则、状态机合法性。

4. 存储对象对账

- MinIO 对象数量、目录规则、孤儿对象率。

### 9.2 样例校验清单

- 对话链路：
- `conversations` 数量 = 至少有 0..n 条 `messages`
- `messages` 排序键 `created_at + sequence_index + id` 行为稳定：`lib/services/db/message-service.ts:85`

- 执行链路：
- `app_executions.status` 转移合法：`pending -> running -> completed|failed|stopped`  
  参考表定义：`supabase/migrations/20250601124105_add_app_executions_table.sql:9`

## 10. 分析八：性能与容量评估

### 10.1 当前性能相关实现线索

- DB 查询重试：`lib/services/db/data-service.ts:75`
- 进程内缓存与清理：`lib/services/db/cache-service.ts:20`
- Realtime 订阅复用：`lib/services/db/realtime-service.ts:54`

### 10.2 目标栈容量设计建议

1. PostgreSQL

- PgBouncer（transaction pooling）
- 关键索引按查询路径校验
- 慢查询阈值与审计日志

2. Redis

- 主从 + Sentinel（或 Cluster）
- 内存上限与淘汰策略明确

3. MinIO

- 分布式部署（多节点多盘）
- 生命周期策略与清理任务

4. Realtime

- WS 网关水平扩展
- Redis Stream 消费组与背压控制

### 10.3 压测场景基线（建议）

- 聊天高并发写入（message insert + list refresh + realtime 推送）
- 应用列表高并发读取（权限 RPC + 缓存命中）
- SSO 峰值登录（去重键 + session 写入）
- 存储上传峰值（头像/内容图）

## 11. 分析九：运维与安全基线

### 11.1 备份与恢复

- PostgreSQL：全量 + WAL + PITR 演练
- Redis：RDB/AOF 策略与恢复演练
- MinIO：对象备份与跨节点恢复

### 11.2 安全控制

- 统一密钥管理（DB、OAuth、SMS、SMTP、CAS 密钥）
- 管理 API 强制鉴权
- 审计日志记录：权限变更、敏感读写、管理操作

### 11.3 现网已识别高风险（迁移前应先修）

- 配置表 RLS 过宽：`supabase/migrations/20250524230000_fix_dify_config_rls.sql:18`
- 部分管理 API 缺少显式鉴权：`app/api/admin/status/route.ts:8`, `app/api/admin/translations/route.ts:164`

## 12. 分析十：Go/No-Go 决策门槛

建议把以下条件作为“可进入详细任务计划”的前提：

1. 技术门槛

- 兼容层接口清单冻结
- 所有关键 RPC 定义可追溯且补齐缺失函数
- Realtime 网关 PoC 可稳定运行

2. 质量门槛

- 核心链路回归通过率 >= 99%
- 数据对账误差为 0（或有明确定义的可接受阈值并可解释）
- 压测达到目标 SLO（需在计划阶段明确数值）

3. 运维门槛

- 备份与回滚演练通过
- 告警链路闭环
- 生产变更窗口与应急预案就绪

## 13. 结论与建议

最终建议：

- 技术栈方向可行，不建议推翻。
- 先做“兼容层 + 分阶段替换”，不要一次性硬切。
- 在任务计划前，先补齐两类缺口：
- 缺失 RPC 定义追溯（`increment_api_key_usage`、`update_sso_provider_order`）
- 管理 API 统一鉴权治理

这两项补齐后，即可进入实施级任务计划（WBS + 里程碑 + 验收标准）。
