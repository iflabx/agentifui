# M6 Realtime 兼容迁移（Redis + SSE）

## 1. 目标

M6 目标：在不改前端订阅调用接口的前提下，用 Redis + SSE 替代原 `postgres_changes` 风格的实时通道，保留 `subscribe/unsubscribe/unsubscribeAll` 语义。

## 2. 架构

链路：

1. 应用写入成功后发布变更事件（`INSERT/UPDATE/DELETE`）
2. 事件写入 Redis Pub/Sub（实时分发）+ Redis Stream（短窗口追踪）
3. `/api/internal/realtime/stream` 通过 SSE 向浏览器推送
4. 浏览器 `realtime-service` 复用原订阅键与过滤语义分发到处理器

核心文件：

- `lib/services/db/realtime-service.ts`
- `lib/server/realtime/redis-broker.ts`
- `lib/server/realtime/publisher.ts`
- `lib/server/realtime/bridge.ts`
- `app/api/internal/realtime/stream/route.ts`

## 3. 订阅语义兼容

兼容键：

1. `user-profile:{userId}`
2. `sidebar-conversations:{userId}`
3. `all-conversations:{userId}`
4. `user-conversations:{userId}`
5. `conversation-messages:{conversationId}`
6. `providers`
7. `service-instances`
8. `api-keys`（管理员）

兼容配置：

- `schema/table/event/filter`（支持 `field=eq.value` 过滤）

## 4. 安全边界

SSE 路由按 key 做鉴权：

1. 用户域 key：本人或管理员
2. `conversation-messages:*`：会话拥有者或管理员
3. `api-keys`：仅管理员
4. 账号状态必须为 `active`

## 5. 写入发布点

当前发布点：

1. `lib/services/db/data-service.ts` 的 `create/update/delete`
2. `app/api/internal/profile/route.ts` 的 profile 更新路径

说明：

- 当前是“应用写路径发布”模型。若有库外写入（绕过应用层），不会自动进入实时通道；后续可在 M6 增强为 DB Trigger + `NOTIFY`/CDC。

## 6. 观测与验证

统计接口：

- `GET /api/internal/realtime/stats`（管理员）

验证命令：

1. `pnpm m6:realtime:verify`
2. `pnpm m6:realtime:slo:verify`
3. `pnpm m6:gate:verify`

SLO 门槛：

1. 送达延迟：`p95 <= 1s`，`p99 <= 2s`
2. 丢失率：`< 0.1%`
