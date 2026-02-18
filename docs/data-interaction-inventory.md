# 项目数据交互点全量盘点（系统边界分类）

> 统计时间：2026-02-17  
> 统计范围：`app/`、`components/`、`lib/`、`scripts/`、`database/migrations/`  
> 统计口径：全量（运行时 + 内部 API + 运维/验证脚本），按系统边界分类

## 1. 结论先行：除了 Dify 交互、数据库交互，还有什么？

除了你已提到的 `Dify`、`PostgreSQL`，本项目还有以下核心数据交互面：

1. `认证与身份数据流`：`better-auth`、本地密码、OIDC/CAS、会话与身份映射同步。
2. `Redis 数据流`：实时消息 broker、会话二级存储、对象存储 presign 限流。
3. `对象存储数据流`：MinIO/S3 预签名上传下载、对象提交、删除、元信息检查。
4. `实时订阅数据流`：SSE（`/api/internal/realtime/stream`）+ Redis Stream/PubSub。
5. `浏览器本地状态数据流`：`localStorage`、`sessionStorage`、`cookie`。
6. `文件系统数据流`：国际化翻译 JSON 读写与内存缓存。
7. `迁移/验证脚本数据流`：m0-m8 阶段脚本对 PG/Redis/S3/Auth 的读写与验收。
8. `敏感数据加密流`：管理端 API Key 加密（`API_ENCRYPTION_KEY`）。

## 2. 全量统计总览（按边界）

| 分类                 | 关键入口                                                          | 统计                                                          |
| -------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------- |
| API 路由（运行时）   | `app/api/**/route.ts`                                             | 30 个运行时路由                                               |
| 统一内部数据动作总线 | `app/api/internal/data/route.ts`                                  | 61 个 action case（43 admin + 18 auth）                       |
| Dify 代理与客户端    | `app/api/dify/[appId]/[...slug]/route.ts` + `lib/services/dify/*` | 1 个代理路由 + 13 个服务文件                                  |
| 数据库模块           | `lib/db/*` + `lib/services/db/*` + `lib/server/pg/*`              | 13 + 4 + 3 个文件                                             |
| 认证与 SSO           | `app/api/auth/*` + `lib/auth/better-auth/*`                       | 4 个 auth 路由 + 9 个核心认证文件                             |
| Redis                | `lib/infra/redis/*` + realtime + auth secondary                   | 11 个 app/lib 相关文件命中                                    |
| 对象存储（MinIO/S3） | `app/api/internal/storage/*` + `lib/server/storage/*`             | 4 个存储路由 + 2 个服务文件                                   |
| 实时 SSE             | `app/api/internal/realtime/*` + realtime broker                   | 2 个实时路由 + 5 个服务文件                                   |
| 浏览器本地存储       | local/session/cookie                                              | localStorage: 14 文件，sessionStorage: 1 文件，cookie: 2 文件 |
| 迁移与验收脚本       | `database/migrations/*` + `scripts/m*`                            | 15 个 migration，43 个 m 脚本，29 个 verify 脚本              |

## 3. 详细分类与交互点索引

## 3.1 Dify 数据交互

### 关键入口

1. `app/api/dify/[appId]/[...slug]/route.ts`
2. `lib/services/dify/app-service.ts`
3. `lib/services/dify/chat-service.ts`
4. `lib/services/dify/message-service.ts`
5. `lib/services/dify/workflow-service.ts`
6. `lib/services/dify/completion-service.ts`
7. `lib/services/dify/file-service.ts`
8. `lib/services/dify/app-browser-service.ts`
9. `lib/services/dify/app-parameters-service.ts`

### 交互特征

1. 浏览器端统一调用 `/api/dify/...`，后端代理再 `fetch` 到真实 Dify API。
2. 支持流式响应（SSE）透传。
3. Dify 配置由本地数据库配置项提供，不在前端暴露明文密钥。

### 统计

1. `/api/dify` 前缀引用（运行时代码）23 处。
2. Dify 服务文件 13 个。

## 3.2 内部数据总线与 PostgreSQL 主数据交互

### 统一入口

1. 浏览器入口：`lib/db/internal-data-api.ts`
2. 服务端分发：`app/api/internal/data/route.ts`

### 数据域分布（internal-data action）

| 域               | action 数 |
| ---------------- | --------: |
| groups           |        15 |
| users            |         8 |
| sso              |         8 |
| serviceInstances |         6 |
| appExecutions    |         6 |
| providers        |         5 |
| conversations    |         5 |
| messages         |         4 |
| apiKeys          |         4 |

### 关键数据库模块

1. `lib/db/users.ts`
2. `lib/db/group-permissions.ts`
3. `lib/db/providers.ts`
4. `lib/db/service-instances.ts`
5. `lib/db/api-keys.ts`
6. `lib/db/conversations.ts`
7. `lib/db/messages.ts`
8. `lib/db/app-executions.ts`
9. `lib/db/sso-providers.ts`
10. `lib/db/user-identities.ts`
11. `lib/db/profiles.ts`

### 统计

1. `callInternalDataAction` 引用 124 处，涉及 17 个文件。
2. 从调用端抽取到 47 个唯一 action（实际总线定义 61 个）。

## 3.3 直接 PG SQL 访问面（非 internal-data）

### 关键入口

1. `app/api/internal/apps/route.ts`
2. `app/api/internal/profile/route.ts`
3. `lib/server/pg/pool.ts`
4. `lib/server/pg/user-context.ts`
5. `lib/auth/better-auth/session-identity.ts`

### 交互特征

1. 用于细粒度 SQL 查询与用户上下文隔离（`queryRowsWithPgUserContext` / system context）。
2. 与 realtime 发布器联动，写后发布变更事件。

## 3.4 认证、会话、身份同步（better-auth + OIDC/CAS）

### 关键入口

1. `app/api/auth/better/[...all]/route.ts`
2. `app/api/auth/sso/providers/route.ts`
3. `app/api/internal/auth/local-password/route.ts`
4. `app/api/internal/auth/local-password/bootstrap/route.ts`
5. `app/api/internal/auth/local-password/change/route.ts`
6. `app/api/internal/auth/profile-status/route.ts`
7. `lib/auth/better-auth/server.ts`
8. `lib/auth/better-auth/session-identity.ts`
9. `lib/auth/better-auth/secondary-storage.ts`

### 交互特征

1. 会话主数据在 PG（auth 表），可接 Redis secondary storage。
2. 支持 SSO（native OIDC + CAS bridge 模式配置）。
3. 登录后会触发本地 profile / identity / external attributes 同步。

## 3.5 Redis 数据交互

### 关键入口

1. `lib/infra/redis/manager.ts`
2. `lib/server/realtime/redis-broker.ts`
3. `lib/auth/better-auth/secondary-storage.ts`
4. `lib/server/security/storage-rate-limit.ts`
5. `app/api/internal/realtime/stream/route.ts`

### 交互特征

1. 作为实时事件 PubSub + Stream 回放窗口。
2. 作为认证 secondary storage。
3. 作为存储预签名接口限流介质。

## 3.6 对象存储（MinIO/S3）数据交互

### 关键入口

1. `app/api/internal/storage/avatar/presign/route.ts`
2. `app/api/internal/storage/avatar/route.ts`
3. `app/api/internal/storage/content-images/presign/route.ts`
4. `app/api/internal/storage/content-images/route.ts`
5. `lib/server/storage/minio-s3.ts`
6. `lib/server/storage/object-policy.ts`
7. `lib/services/content-image-upload-service.ts`

### 交互特征

1. 前端先请求 presign，随后直传对象存储，再调用 commit 接口落业务记录。
2. 读路径支持 public/private 两种模式与路径归属校验。
3. 上传下载接口带 Redis 限流与用户权限检查。

## 3.7 实时订阅（SSE）数据交互

### 关键入口

1. `app/api/internal/realtime/stream/route.ts`
2. `app/api/internal/realtime/stats/route.ts`
3. `lib/services/db/realtime-service.ts`
4. `lib/server/realtime/outbox-dispatcher.ts`
5. `lib/server/realtime/publisher.ts`
6. `lib/server/realtime/redis-broker.ts`

### 交互特征

1. 服务端 SSE 出流，浏览器使用 `EventSource` 消费。
2. 订阅 key 做了权限范围校验（self/admin/conversation-owner）。
3. 事件来源支持 DB outbox -> Redis broker -> SSE fanout。

## 3.8 浏览器本地数据交互

### localStorage（14 文件）

1. `app/settings/appearance/page.tsx`
2. `components/chat-input/model-selector-button.tsx`
3. `components/settings/profile/profile-form.tsx`
4. `components/sidebar/sidebar-favorite-apps.tsx`
5. `components/ui/resizable-split-pane.tsx`
6. `lib/hooks/use-chat-interface.ts`
7. `lib/hooks/use-theme.ts`
8. `lib/hooks/use-user-timezone.ts`
9. `lib/services/admin/content/translation-service.ts`
10. `lib/stores/current-app-store.ts`
11. `lib/stores/favorite-apps-store.ts`
12. `lib/stores/sidebar-store.ts`
13. `lib/stores/ui/file-preview-cache-store.ts`
14. `lib/utils/cache-cleanup.ts`

### sessionStorage（1 文件）

1. `lib/hooks/use-profile.ts`

### cookie（2 文件）

1. `lib/config/language-config.ts`
2. `app/api/sso/[providerId]/logout/route.ts`

## 3.9 文件系统数据交互（翻译与配置文件）

### 关键入口

1. `app/api/translations/[locale]/route.ts`
2. `app/api/admin/translations/route.ts`

### 交互特征

1. 运行时直接读 `messages/*.json`。
2. 管理端支持翻译写入（文件锁 + 临时文件 + 原子替换）。
3. 接口层带内存缓存和 ETag/Cache-Control。

## 3.10 迁移、验收与运维脚本数据交互

### 统计

1. `database/migrations/`：15 个 SQL 文件。
2. `scripts/m*`：43 个阶段脚本。
3. `scripts/*verify*`：29 个验收脚本。
4. 脚本中涉及 PG/SQL：31 个文件。
5. 脚本中涉及 Redis：12 个文件。
6. 脚本中涉及 S3/MinIO：22 个文件。
7. 脚本中涉及 Auth/SSO：20 个文件。

### 代表文件

1. `scripts/m7-data-migrate.mjs`
2. `scripts/m7-incremental-migrate.mjs`
3. `scripts/m7-reconcile-verify.mjs`
4. `scripts/m5-storage-e2e-verify.mjs`
5. `scripts/m6-realtime-e2e-verify.mjs`
6. `scripts/m2-auth-e2e-verify.mjs`
7. `scripts/m2-sso-mock-e2e-verify.mjs`

## 3.11 敏感数据加密交互

### 关键入口

1. `app/api/admin/encrypt/route.ts`

### 交互特征

1. 管理端提交明文 API Key。
2. 服务端使用 `API_ENCRYPTION_KEY` 加密后返回密文。
3. 用于后续 API Key 落库前的敏感数据处理链路。

## 4. 关键端到端数据流程（E2E）

1. `Chat 主流程`
   `UI -> lib/services/dify/message-service -> /api/dify/... -> Dify`  
   `UI -> callInternalDataAction(messages.*) -> /api/internal/data -> PostgreSQL`
2. `Workflow/Text Execution`
   `UI hooks -> lib/services/client/app-executions-api -> /api/internal/data(appExecutions.*) -> PostgreSQL`
3. `SSO 登录与身份同步`
   `UI -> /api/auth/better/* -> better-auth -> PG(auth_*) + Redis secondary`  
   `session-identity -> profiles/user_identities/profile_external_attributes`
4. `本地密码兜底登录`
   `/api/internal/auth/local-password* -> policy + session-identity + better-auth sign-in/email`
5. `头像/内容图上传`
   `UI -> /api/internal/storage/*/presign -> MinIO PUT -> /api/internal/storage/* commit -> 业务可见 URL`
6. `实时订阅`
   `DB 变更 -> realtime publisher/outbox -> Redis broker -> /api/internal/realtime/stream(SSE) -> 浏览器 EventSource`
7. `翻译配置编辑`
   `Admin UI -> /api/admin/translations -> messages/*.json`  
   `前台 -> /api/translations/[locale] -> 读取缓存后的文件数据`

## 5. 迁移视角下的补充观察

1. 仓库运行时代码中已无 `supabase` 代码引用（静态扫描结果为空）。
2. 数据面已形成分层：`Dify 代理`、`内部数据总线`、`直接 PG 路由`、`存储/实时/认证子系统`。
3. 真正的迁移复杂度不只在 DB 表结构，还在 `认证会话`、`实时通道`、`对象存储`、`浏览器缓存一致性` 四条线。

## 6. 测试覆盖现状（按交互边界）

### 6.1 已完整通过（有阶段门禁记录）

1. `认证/会话/SSO`：`output/validation/20260216T071041Z/m2-gate.log`
2. `内部数据 CRUD（PG）`：`output/validation/20260216T071041Z/m3-gate.log`
3. `RLS/角色与网关`：`output/validation/20260216T071041Z/m4-gate.log`
4. `对象存储链路（presign/upload/commit）`：`output/validation/20260216T071041Z/m5-gate.log`
5. `实时通道（SSE + Redis）`：`output/validation/20260216T071041Z/m6-gate.log`
6. `数据迁移一致性门禁`：`artifacts/m7/20260216T072810Z/summary.json`
7. `灰度切流/回滚演练`：`output/validation/20260216T071041Z/m8-gate/summary.json`

### 6.2 部分通过（存在不稳定样本）

1. `全页面可视化流程（M9）`有通过样本：`output/playwright/m9-prod-20260216T091101Z/result.json`（`ok: true`）。
2. 同时存在失败/超时样本：
   `output/playwright/m9-real-fix-20260216T083340Z/playwright-run.log`、
   `output/playwright/m9-real-fix-20260216T082228Z/playwright-run.log`、
   `output/playwright/m9-real-fix-20260216T084259Z/playwright-run.log`。
3. 阶段日志内亦有同类不稳定记录：`output/validation/20260216T071041Z/m9-playwright*.log`。

### 6.3 本轮补测结果（2026-02-17）

1. `Dify 真实 provider 全链路`：已执行并通过（含 `blocking -> streaming` 执行回退），证据：
   `output/validation/20260217T010655Z/gap-tests/dify-real-provider-result.json`。
2. `浏览器本地状态一致性（localStorage/sessionStorage/cookie）`：已执行并通过，证据：
   `output/validation/20260217T010655Z/gap-tests/local-state-result.json`、
   `output/validation/20260217T010655Z/gap-tests/local-state-after.png`。
3. `翻译读写接口（/api/translations, /api/admin/translations）`：已执行并通过（写入、前台读取、回滚恢复），证据：
   `output/validation/20260217T010655Z/gap-tests/translations-api-result.json`。

### 6.4 仍待工程化项

1. 已新增统一入口：`pnpm m9:gap:verify`（`scripts/m9-gap-tests-verify.sh`）。
2. 已新增 M9 门禁：`pnpm m9:gate:verify`（`m9:gap:verify + gate:quality:verify`）。
3. CI 需注入三类检查命令：
   - `M9_GAP_DIFY_REAL_PROVIDER_COMMAND`
   - `M9_GAP_LOCAL_STATE_COMMAND`
   - `M9_GAP_TRANSLATIONS_COMMAND`
4. 如需强制三项都执行，设置 `M9_GAP_REQUIRE_ALL=1`。

### 6.5 结论

1. 核心后端数据交互（PG/Redis/S3/Auth/Realtime/迁移）已具备可审计的阶段门禁通过证据。
2. 历史缺口中的三类专项测试已补测通过，当前“功能覆盖”层面已闭环。
3. 下一步重点是把 `6.3` 的补测固化成常态化 gate，收敛为可持续的发布准入标准。

## 8. 附录：本次统计使用的核心口径

1. 动作总线：`app/api/internal/data/route.ts` 的 `case` 数量与 action 域分布。
2. 路由统计：仅统计 `route.ts`（排除 `*.test.ts`）。
3. 前端 API 前缀引用：`/api/dify`、`/api/internal`、`/api/auth`、`/api/admin`、`/api/translations`。
4. 本地存储统计：按包含 `localStorage`、`sessionStorage`、`document.cookie|set-cookie` 的运行时文件计数。
5. 脚本统计：`scripts/m*` 与 `scripts/*verify*` 文件名命中统计。
