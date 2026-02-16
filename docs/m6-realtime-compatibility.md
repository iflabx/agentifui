# M6 Realtime 兼容迁移（Redis + SSE）

## 1. 目标

M6 目标：在不改前端订阅调用接口的前提下，用 Redis + SSE 替代原 `postgres_changes` 风格的实时通道，保留 `subscribe/unsubscribe/unsubscribeAll` 语义。

## 2. 架构

链路：

1. PostgreSQL Trigger 将变更写入 `realtime_outbox_events`（覆盖应用内与库外写入）
2. outbox dispatcher 消费 outbox，发布到 Redis Pub/Sub（实时分发）+ Redis Stream（回放窗口）
3. `/api/internal/realtime/stream` 通过 SSE 向浏览器推送
4. 浏览器 `realtime-service` 复用原订阅键与过滤语义分发到处理器

核心文件：

- `lib/services/db/realtime-service.ts`
- `lib/server/realtime/redis-broker.ts`
- `lib/server/realtime/publisher.ts`
- `lib/server/realtime/outbox-dispatcher.ts`
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

1. 主路径：DB Trigger -> outbox -> dispatcher -> Redis
2. `publishTableChangeEvent` 默认 `REALTIME_SOURCE_MODE=db-outbox`（应用直发关闭，避免重复事件）
3. 可选兼容模式：`REALTIME_SOURCE_MODE=app-direct|hybrid`

说明：

- 已支持库外写入（绕过应用层）进入实时通道。
- 语义为至少一次投递（at-least-once）；消费侧需容忍极低概率重复事件。

## 6. 观测与验证

统计接口：

- `GET /api/internal/realtime/stats`（管理员）

附加观测字段：

1. `pubSubSubscriberCount`（集群订阅者数量）
2. `publishFailureTotal` / `publishFailureLastAt` / `publishFailureLastError`
3. `outboxPendingCount`

回放缺口提示：

- 当 `lastEventId` 回放结果超出窗口上限时，SSE 会发送 `event: replay-gap`（`reason=replay_window_truncated`），提示客户端执行全量重拉。

验证命令：

1. `pnpm m6:realtime:verify`
2. `pnpm m6:realtime:slo:verify`
3. `pnpm m6:gate:verify`

SLO 门槛：

1. 送达延迟：`p95 <= 1s`，`p99 <= 2s`
2. 丢失率：`< 0.1%`
