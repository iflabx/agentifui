# AgentifUI 本地化后端兼容组件清单

更新时间：2026-02-14

## 1. 目标与边界

目标：在尽量不改前端页面与交互的前提下，将后端替换为：

- PostgreSQL 18
- Drizzle ORM
- Redis 7.x
- MinIO
- better-auth

约束：

- 现有业务数据结构尽量保持不变。
- 前端可接受“数据接入层最小改动”，不接受大规模页面/状态管理重写。

## 2. 当前 Supabase 依赖面（用于兼容设计基线）

代码中已存在深度 Supabase 依赖：

- SDK 依赖：`package.json:75`, `package.json:76`
- 浏览器端单例 client：`lib/supabase/client.ts:1`
- 服务端与 admin client：`lib/supabase/server.ts:10`, `lib/supabase/server.ts:38`
- 中间件鉴权和角色/状态校验：`middleware.ts:102`, `middleware.ts:116`, `middleware.ts:156`

主要接口族：

- Auth：`getUser/getSession/onAuthStateChange/signInWithPassword/signUp/signInWithOAuth/signInWithOtp/verifyOtp/resetPasswordForEmail/setSession/exchangeCodeForSession`  
  参考：`components/auth/login-form.tsx:51`, `components/auth/register-form.tsx:75`, `components/auth/social-auth-buttons.tsx:45`, `components/auth/phone-auth.tsx:36`, `components/auth/forgot-password-form.tsx:33`, `components/auth/reset-password-form.tsx:40`, `app/api/auth/callback/route.ts:41`
- RPC：`get_user_accessible_apps/check_user_app_permission/increment_app_usage/...`  
  参考：`lib/db/group-permissions.ts:472`, `lib/db/group-permissions.ts:498`, `lib/db/group-permissions.ts:543`
- Storage：`upload/getPublicUrl/remove/list`  
  参考：`lib/hooks/use-avatar-upload.ts:143`, `lib/services/content-image-upload-service.ts:150`
- Realtime：`channel().on('postgres_changes').subscribe()`  
  参考：`lib/services/db/realtime-service.ts:66`, `lib/services/db/realtime-service.ts:94`, `lib/supabase/hooks.ts:243`

## 3. 兼容组件清单（P0 必须）

1. 兼容 SDK 层（前端适配层）

- 作用：对外保留“接近 Supabase 调用习惯”的接口，内部转发到你自建 BFF。
- 输出建议：
- `lib/backend-client/client.ts`（替代 `lib/supabase/client.ts`）
- `lib/backend-client/hooks.ts`（替代 `lib/supabase/hooks.ts`）
- 要求：先覆盖现有高频调用（Auth/DB/Storage/Realtime）。

2. BFF/API 网关层（统一数据入口）

- 作用：替代浏览器直连 DB/Storage，集中鉴权、审计、限流、错误语义。
- 必备能力：
- 会话鉴权中间件（替代 Supabase SSR cookie 语义）
- 统一 Result 格式（对齐当前前端错误处理）
- 管理 API 强制 `requireAdmin()`

3. Auth 服务（better-auth + 扩展）

- 作用：替代 Supabase Auth 全能力。
- 必补子模块：
- Email/Password 登录注册
- OAuth（至少 GitHub）
- 密码找回邮件流
- 手机 OTP（需短信供应商）
- CAS SSO 适配器（保留当前 SSO 流程）
- 关键兼容点：
- `onAuthStateChange/getSession/getUser/signOut` 事件与会话读取语义
- SSO 登录后 session 建立流程（现有 `app/api/auth/sso-signin/route.ts:103`）

4. PostgreSQL 权限与函数层（RLS/RPC 保持）

- 作用：承接原 Supabase SQL 策略与 RPC 语义。
- 必做：
- 保留/迁移 RLS 策略与 `SECURITY DEFINER` 函数
- Drizzle 管 schema 与普通 CRUD；复杂权限逻辑继续 SQL migration
- 重点函数：
- `get_user_accessible_apps`
- `check_user_app_permission`
- `increment_app_usage`
- `safe_delete_user`

5. MinIO 存储网关

- 作用：替代 Supabase Storage。
- 必做：
- 预签名上传/下载 URL
- 对象路径规则（如 `user-{uid}/...`）和 ACL 统一校验
- 删除与垃圾清理任务
- 关键兼容点：
- 现有头像、内容图上传流程保持（`lib/hooks/use-avatar-upload.ts:143`, `lib/services/content-image-upload-service.ts:150`）

6. Realtime 网关（Redis + WS/SSE）

- 作用：替代 `postgres_changes` 订阅模型。
- 建议实现：
- PG 变更事件 -> Redis Streams/PubSub -> WS/SSE 推送
- 前端订阅键保持与 `SubscriptionKeys` 一致
- 关键兼容点：
- `subscribe/unsubscribe/unsubscribeAll` 生命周期对齐 `lib/services/db/realtime-service.ts:49`

7. Redis 运行时组件

- 作用：承接会话、缓存、去重、锁、限流。
- 必做：
- Session store（better-auth）
- API 幂等与去重（替代当前内存 Map，参考 `app/api/auth/sso-signin/route.ts:12`）
- 分布式锁（配额扣减、关键更新）
- 热点缓存（用户资料、应用列表）

8. 连接池与数据库运维组件

- 作用：支撑高并发连接与稳定性。
- 必做：
- PgBouncer
- 备份/PITR
- 慢查询监控与索引治理

## 4. 兼容组件清单（P1 强烈建议）

1. 任务队列（BullMQ/等价）

- 用途：异步重试、清理过期对象、邮件短信发送、统计聚合。

2. 可观测性平台

- 用途：结构化日志、链路追踪、指标与告警。
- 最低要求：
- API 延迟/错误率
- PG 连接池/慢查询
- Redis 内存/命中率
- MinIO 错误率与容量

3. 密钥与配置中心

- 用途：管理 API 密钥、OAuth Secret、短信密钥、CAS 证书等。

4. 审计日志组件

- 用途：管理端操作、权限变更、敏感读写追踪。

## 5. 接口兼容映射（必须覆盖）

1. Auth 映射

- `supabase.auth.signInWithPassword` -> `POST /api/auth/login`
- `supabase.auth.signUp` -> `POST /api/auth/register`
- `supabase.auth.signInWithOAuth` -> `GET /api/auth/oauth/{provider}`
- `supabase.auth.resetPasswordForEmail` -> `POST /api/auth/password/forgot`
- `supabase.auth.verifyOtp(type='recovery'|'sms')` -> `POST /api/auth/otp/verify`
- `supabase.auth.signInWithOtp` -> `POST /api/auth/otp/send`
- `supabase.auth.getUser/getSession` -> `GET /api/auth/session`
- `supabase.auth.signOut` -> `POST /api/auth/logout`

2. 数据访问映射

- `supabase.from(table).select/insert/update/delete` -> `BFF + Repo(Drizzle)`
- `order/range/match/eq/single/maybeSingle` 语义保持，避免前端改动扩散。

3. RPC 映射

- 方式 A：保留 PG 函数并通过 BFF 调用 `SELECT fn(...)`
- 方式 B：迁移成应用服务逻辑（仅当需要跨库/跨系统事务）
- 建议：先 A 后 B，降低风险。

4. Storage 映射

- `upload` -> 获取预签名 PUT URL + 客户端上传
- `getPublicUrl` -> 公共网关 URL 或签名 GET URL
- `remove/list` -> 走鉴权后的服务端 API

5. Realtime 映射

- `channel(...).on('postgres_changes')` -> `ws://.../realtime?topic=...`
- payload 结构尽量与当前 `payload.new/payload.old` 保持一致。

## 6. 推荐目录（新组件落位）

```text
app/api/
  auth/...
  db/...
  storage/...
  realtime/...
lib/backend-client/
  client.ts
  hooks.ts
  realtime.ts
lib/server/
  auth/
  db/
  storage/
  permissions/
  rpc/
lib/infra/
  redis/
  queue/
  observability/
drizzle/
  schema/
  migrations/
```

## 7. 实施顺序（兼容优先）

1. 先做兼容 SDK + BFF 骨架（不切流）。
2. 切 Auth（better-auth + CAS）并保持前端登录流程不变。
3. 切 DB CRUD（Drizzle Repo）并保留 PG 函数/RLS。
4. 切 Storage（MinIO 预签名）。
5. 切 Realtime（Redis + WS/SSE）。
6. 最后清理 Supabase SDK 与环境变量。

## 8. 完成定义（DoD）

- 所有 `supabase.auth.*` 现有调用有等价实现。
- 所有 `rpc()` 调用函数返回结构不变。
- 头像与内容图上传/删除/清理行为一致。
- 会话列表与消息流实时更新无明显回归。
- 中间件路由保护、角色检查、状态检查行为一致。
- 压测下连接池、缓存、实时通道稳定。
