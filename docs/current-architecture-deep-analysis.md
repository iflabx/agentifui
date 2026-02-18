# 当前项目技术架构深度分析（问题与优化方案融合版）

更新时间：2026-02-18  
分析基线分支：`refactor/p0-arch-convergence`

## 0. 增量复核（2026-02-18，H 阶段）

本轮已完成以下收口：

1. 新增 Next 侧统一错误响应 helper：`lib/errors/next-api-error-response.ts`。
2. 已将高频内部路由切换到统一 `app_error + request_id` 返回（含 `/api/internal/apps`、`/api/internal/profile`、`/api/internal/realtime/*`、`/api/internal/storage/*`、`/api/internal/dify-config/[appId]`、`/api/auth/sso/providers`）。
3. 当前 `app/api/internal`、`app/api/admin`、`app/api/auth` 生产路由已清零 `{ success:false,error }` 旧返回结构（测试文件除外）。
4. 门禁验证通过：`pnpm gate:quality:verify`、`pnpm m9:gate:verify`。

当前仍建议保持关注的剩余点：

1. Fastify 路由内部仍存在 legacy 错误 payload 写法，当前依赖 `preSerialization` 统一兜底；可在后续统一改为显式 `app_error` 构造以降低隐式耦合。
2. `internal-apps/internal-profile` 的实时副作用一致性在 `REALTIME_SOURCE_MODE=app-direct` 场景仍建议补专门契约验证（默认 `db-outbox` 路径已可用）。

## 1. 执行摘要

当前项目已经具备完整替代 Supabase 的能力底座（`PostgreSQL + Redis + MinIO + better-auth + Fastify`），但仍处于迁移中间态。核心问题不是“功能缺失”，而是“同能力多路径并存”，导致：

1. 请求链路跳数偏高（部分请求先到 Fastify 再回源 Next）。
2. 认证读路径存在写副作用（会话解析触发 profile/属性更新）。
3. Next/Fastify 双实现存在行为漂移风险（同一路由不同实现细节）。
4. RLS strict 在双运行时上的一致性存在缺口（Fastify 侧 session options 与 Next 侧不同步）。

结论：下一步改造重点应从“继续加功能”转为“架构收口”。优先做 `A/B/C` 三步：

1. 认证读写分离。
2. Fastify 本地化身份解析（去 upstream profile-status 回调）。
3. `internal-data` 单后端收口与客户端 fail-open 去除。

---

## 2. 分析方法与证据范围

本次分析基于仓库代码实据，不基于抽象架构图。主要证据来源：

1. 网关与路由：`next.config.ts`, `apps/api/src/server.ts`, `apps/api/src/routes/*`
2. 认证与权限：`lib/auth/better-auth/*`, `middleware.ts`, `app/api/internal/auth/*`
3. 数据访问：`app/api/internal/data/route.ts`, `apps/api/src/routes/internal-data.ts`, `lib/db/internal-data-api.ts`
4. PG/RLS：`lib/server/pg/*`, `apps/api/src/lib/pg-context.ts`, `database/migrations/20260215050000_m4_table_rls_phase2.sql`
5. 实时与存储：`lib/server/realtime/*`, `app/api/internal/realtime/*`, `app/api/internal/storage/*`
6. 错误与观测：`lib/errors/app-error.ts`, `lib/server/errors/error-events.ts`

---

## 3. 系统拓扑（当前真实运行态）

## 3.1 运行模式

### 模式 A：Next-only

- 入口：`next dev` / `next start`
- API 全部由 Next Route Handler 处理

### 模式 B：Next + Fastify Sidecar（当前主迁移路径）

- 入口：`pnpm dev:all`（`dev:web` + `dev:api`）
- Next rewrite 将部分 `/api/*` 前缀转发到 Fastify
- Fastify 对未本地实现路径再回源 Next

关键代码：

- rewrite 前缀：`next.config.ts:23`, `next.config.ts:70`
- Fastify 路由注册：`apps/api/src/server.ts:50`
- Fastify fallback 代理：`apps/api/src/routes/proxy-fallback.ts:57`

## 3.2 默认 rewrite 前缀的现实影响

默认前缀包含：

- `/api/internal/data`
- `/api/internal/apps`
- `/api/internal/profile`
- `/api/internal/dify-config`
- `/api/internal/auth/local-password`
- `/api/internal/fastify-health`
- `/api/admin`
- `/api/translations`

证据：`next.config.ts:23`、`apps/api/src/config.ts:1`。

现状风险：rewrite 规则由 Next 构建期决定。若仅运行期开启 `FASTIFY_PROXY_ENABLED=1` 而未重建产物，会出现“切流命令成功但 rewrite 未生效”的假阳性。

---

## 4. 模块级“问题-方案”融合矩阵

| 模块          | 当前实现                               | 主要问题                                           | 优化方案                                                                | 优先级 |
| ------------- | -------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------- | ------ |
| 网关路由      | Next rewrite + Fastify fallback        | rewrite 由构建期决定，切流时易产生“未生效假阳性”   | cutover 前强制校验 `.next/routes-manifest.json` 与目标 Fastify 地址一致 | P0     |
| 认证身份      | `resolveSessionIdentity()` 统一解析    | 读路径有写副作用（last_login/外部属性）            | 拆分 read-only resolver 与 side-effect sync                             | P0     |
| Fastify 鉴权  | 本地会话解析（local-only）             | 历史命名仍含 upstream 语义，认知成本偏高           | 统一重命名 resolver，保持本地单路径                                     | P1     |
| internal-data | Next/Fastify 双实现 + 客户端 fail-open | 一致性风险与排障复杂度高                           | 收口为单实现（Fastify-first），去掉客户端重试绕行                       | P0     |
| RLS strict    | Next 侧连接支持 strict session option  | Fastify 侧 pg pool 未注入 strict session options   | 统一 PG 连接初始化策略，Fastify 同步 strict option                      | P0     |
| Next 管理 API | 多处 `getPgPool().query()` 直连        | strict 模式下缺 actor/GUC，存在阻断风险            | 迁移到 `queryRowsWithPgUserContext` / system context 明确化             | P1     |
| 数据访问层    | managed repo + raw SQL + compat 层并存 | 边界模糊，行为审计成本高                           | 增加“表级 owner 模式”，逐表收口                                         | P1     |
| Dify 代理     | Next route 中直接 fetch Dify           | 缺少统一 timeout/circuit breaker，异常路径不够可控 | 增加超时、熔断与错误分类策略                                            | P1     |
| 缓存          | 多处进程内缓存（Map/Record）           | 多实例一致性弱，失效策略分散                       | Redis L2 + 本地 L1，统一 key/ttl/失效协议                               | P1     |
| 错误处理      | 部分接口有 app_error envelope          | 错误返回格式不统一，观测汇总成本高                 | 统一错误 envelope 中间件与路由基类                                      | P2     |
| 存储上传      | presign 主链路 + relay fallback        | fallback 默认开放，吞吐/成本不可预测               | fallback 改应急开关，默认关闭并告警                                     | P2     |
| 文档基线      | README/架构文档与代码并存              | 存在漂移（如技术栈版本描述）                       | 加 CI 一致性校验（README vs package/env）                               | P2     |

---

## 5. 深入问题分析与落地方案

## 5.1 网关与路由编排

### 现状

1. Next rewrite 开启后，默认多个前缀先进入 Fastify。`next.config.ts:70`
2. Fastify 使用 `proxy-fallback` 将未实现路由回源 Next。`apps/api/src/routes/proxy-fallback.ts:57`

### 问题

1. rewrite 开关是构建期行为，运行期仅改环境变量不会重写已产出的 `.next/routes-manifest.json`。
2. 切流脚本若不做 manifest 验证，容易出现“启动成功但并未真正切流”。

### 优化方案

1. cutover 前校验 `.next/routes-manifest.json` 中目标 rewrite 是否指向当前 `FASTIFY_PROXY_BASE_URL`。
2. 校验失败时阻断切流并提示“带 `FASTIFY_PROXY_ENABLED=1` 重建 Next 产物”。
3. 切流后追加 `/api/internal/fastify-health` 冒烟，验证 rewrite 实际生效。

### 建议改动文件

1. `next.config.ts`
2. `apps/api/src/config.ts`
3. `packages/shared/src/fastify-proxy.ts`

### 验收

1. `pnpm fastify:cutover:on` 在 rewrite 缺失时应快速失败并给出重建命令。
2. rewrite 生效时，`/api/internal/fastify-health` 返回 200，且 `/api/internal/data` 返回 Fastify 语义 400。

---

## 5.2 认证与身份解析（读写耦合）

### 现状

1. `resolveSessionIdentity()` 同时承担：
   - 会话解析
   - profile upsert/update
   - `last_login` 更新
   - external attributes 同步
2. 该函数被高频路径调用：`middleware`、`profile-status`、多个内部 API。

关键代码：

- `lib/auth/better-auth/session-identity.ts:476`, `lib/auth/better-auth/session-identity.ts:800`
- `app/api/internal/auth/profile-status/route.ts:10`
- `middleware.ts:241`

### 问题

1. 读路径写放大，认证流量高时会压 DB 写。
2. 写失败会反向影响鉴权稳定性（读请求变故障请求）。
3. 业务观察上难区分“鉴权失败”与“同步失败”。

### 优化方案

1. 拆成 `resolveSessionIdentityReadOnly()` + `syncSessionIdentitySideEffects()`。
2. side effects 迁移到登录成功 hook 或异步任务（带最小同步周期）。
3. profile-status/middleware 仅走 read-only。

### 建议改动文件

1. `lib/auth/better-auth/session-identity.ts`
2. `app/api/internal/auth/profile-status/route.ts`
3. `middleware.ts`
4. `lib/auth/better-auth/server.ts`

### 验收

1. 高频 profile-status 压测下 `profiles.last_login` 不再同步增长。
2. `pnpm m2:gate:verify` 通过。

---

## 5.3 Fastify 鉴权自治化（已收口）

### 现状

1. Fastify 路由统一通过本地会话解析获取身份，不再调用 Next 的 `/api/internal/auth/profile-status`。
2. `resolveProfileStatusFromUpstream` 保留了历史函数名，但内部已是 local-only 实现（兼容路由调用点）。

### 剩余关注点

1. 函数命名仍保留 `FromUpstream` 历史语义，建议后续重命名为 `resolveProfileStatusFromSession` 并同步调用点。

### 优化方案

1. 保持本地解析为唯一实现，移除上游回退开关与相关配置项。
2. 后续做命名清理，消除“实现已收口但命名仍指向 upstream”的认知负担。

### 验收

1. Fastify 路由运行时不发起 `/api/internal/auth/profile-status` HTTP 请求。
2. inactive 用户直达 Fastify 路由被拒绝（403/401）。

---

## 5.4 `internal-data` 双实现与行为漂移

### 现状

1. Next 实现：`app/api/internal/data/route.ts`
2. Fastify 实现：`apps/api/src/routes/internal-data.ts`
3. 客户端 fail-open 二次绕行已移除，`internal-data` 默认单路径执行。

### 问题

1. Next 侧仍保留禁用 stub，调用方若误配切流仍会收到 503，需要配合 cutover 校验。

### 优化方案

1. 明确单后端真相（建议 Fastify-first）。
2. 删除 Next `internal-data` 业务实现，仅保留硬错误提示或 stub。
3. 删除客户端二次绕行逻辑与 bypass header 重试。

### 验收

1. 所有 internal-data action 都由单实现处理。
2. `m3` 相关验证全绿：`pnpm m3:gate:verify`。

---

## 5.5 RLS strict 的双运行时一致性缺口（新增高风险）

### 现状

1. Next PG pool 支持 session options（可注入 `app.rls_strict_mode=on`）。
   - `lib/server/pg/pool.ts:28`
   - `lib/server/pg/session-options.ts:9`
2. Fastify PG pool 未注入 strict session options。
   - `apps/api/src/lib/pg-context.ts:50`

### 问题

1. 在 strict-mode 语义上，Next/Fastify 可能出现执行行为不一致。
2. 这会导致“同业务路径在不同入口策略不同”，属于高隐蔽性风险。

### 优化方案

1. 将 `resolvePgSessionOptionsFromEnv()` 逻辑复用到 Fastify `pg-context`。
2. 在 Fastify `BEGIN` 后显式设置 strict GUC（双保险）。
3. 新增“Next/Fastify strict 一致性”门禁脚本。

### 验收

1. `APP_RLS_STRICT_MODE=1` 下，Next/Fastify 对同 actor/query 的允许/拒绝结果一致。

---

## 5.6 Next 路由中 raw pool 查询与 strict 兼容性

### 现状

仍有 Next API 使用 `getPgPool().query()` 直连查询，如：

1. `app/api/internal/profile/route.ts:91`
2. `app/api/admin/users/route.ts:17`
3. `app/api/admin/users/for-group/route.ts:25`

### 问题

1. 这些查询未设置 actor GUC。
2. strict 打开后，RLS 表访问可能直接失败或依赖 legacy 兼容行为。

### 优化方案

1. 全量迁移到：
   - `queryRowsWithPgUserContext`（用户路径）
   - `queryRowsWithPgSystemContext`（系统任务路径）
2. 建立 lint/静态扫描规则：禁止在 `app/api/**` 新增 raw pool 直连。

### 验收

1. strict=1 下管理与用户主路径可用。
2. 通过新增脚本 `guard:no-raw-pg-in-api`。

---

## 5.7 Next/Fastify 同路由行为漂移（重点）

## 典型案例 A：`/api/internal/apps` PATCH

1. Next 版本会调用 `publishTableChangeEvent`：`app/api/internal/apps/route.ts:401`
2. Fastify 版本当前无对应发布调用：`apps/api/src/routes/internal-apps.ts:384`

说明：默认 `REALTIME_SOURCE_MODE=db-outbox` 时此差异被触发器部分掩盖，但在 `app-direct/hybrid` 或未来演进中会变成真实行为差异。

## 典型案例 B：`/api/internal/profile` PATCH

1. Next 版本包含 realtime publish：`app/api/internal/profile/route.ts:187`
2. Fastify 版本无 publish：`apps/api/src/routes/internal-profile.ts:146`

### 优化方案

1. 统一“单实现优先”，避免长期并行。
2. 在未收口前，建立“同路由契约对齐测试”（状态码、返回体、副作用）。

---

## 5.8 Dify 代理链路

### 现状

1. Dify 代理核心：`app/api/dify/[appId]/[...slug]/route.ts`
2. 支持 stream 转发、媒体响应、友好错误包装。
3. Dify 配置读取依赖 `getDifyAppConfig()`，支持按 actor 作用域回退默认实例。
   - `lib/config/dify-config.ts`

### 问题

1. Dify fetch 未统一 timeout/circuit breaker（`fetch(targetUrl)` 直接调用）。
2. `getDifyAppConfig` 与 `cache-service` 都是进程内缓存，跨实例失效不一致。
3. “找不到指定实例时回退默认实例”虽然提高可用性，但会掩盖配置错误来源。

### 优化方案

1. 为 Dify 请求引入 `AbortController + 统一超时 + 错误码分层`。
2. 对配置缓存引入 Redis L2，并提供失效广播。
3. 默认实例回退增加显式可观测标记（日志 + 响应 metadata）。

---

## 5.9 数据访问层与缓存

### 现状

1. `DataService` 仍是混合实现：managed repository + raw SQL fallback。`lib/services/db/data-service.ts`
2. `cache-service` 为进程内 Map。`lib/services/db/cache-service.ts`

### 问题

1. 多路径实现降低语义清晰度，增加维护复杂度。
2. 缓存跨实例一致性不足，且日志噪音较大（大量 `cache hit/miss`）。

### 优化方案

1. 以“表”为单位定义 owner：managed-only / raw-only / migrate-in-progress。
2. 缓存改 `L1(本地) + L2(Redis)`，并统一 key schema 和失效协议。

---

## 5.10 错误处理与观测统一性

### 现状

1. 项目已有标准错误结构：`app_error` envelope。`lib/errors/app-error.ts`
2. 错误聚合写入 PG + Redis stream：`lib/server/errors/error-events.ts`

### 问题

1. 并非所有路由都输出统一 envelope，存在 `{success:false,error}` 与 `app_error` 混用。
2. 不同路由对 request-id 透传与记录深度不一致。

### 优化方案

1. 统一路由错误输出中间件（Next/Fastify 各一层，格式一致）。
2. 统一 request-id 生成/传递策略并纳入门禁。

---

## 6. 分阶段优化蓝图（融合版）

## Phase A（P0）：认证读写分离

目标：认证与 profile/status 查询只读化。  
输出：`resolveSessionIdentityReadOnly` + side-effect worker/hook。

依赖：无。  
风险门槛：登录成功率不能下降。

## Phase B（P0）：Fastify 本地身份解析

目标：Fastify 不再通过 upstream profile-status 取 actor。  
输出：共享 session resolver；upstream 逻辑降级为开关。

依赖：A。  
风险门槛：internal-data、internal-apps、internal-profile、local-password 全回归通过。

## Phase C（P0）：internal-data 单后端收口

目标：去双实现 + 去客户端 fail-open。  
输出：单实现 + 单契约 + 单错误语义。

依赖：B。  
风险门槛：`pnpm m3:gate:verify` 与生产冒烟通过。

## Phase D（P0/P1）：RLS strict 一致化

目标：Next/Fastify strict 行为一致。  
输出：Fastify pool 注入 session options，API raw query 清理。

依赖：B/C。  
风险门槛：strict=1 全链路通过。

## Phase E（P1）：缓存与 Dify 链路增强

目标：缓存一致性与上游调用稳态。  
输出：Redis L2 + Dify timeout/circuit breaker。

依赖：C。  
风险门槛：错误率与延迟指标稳定。

## Phase F（P2）：存储 fallback 收口

目标：presign+commit 主路径硬化，relay 仅应急。  
输出：fallback 默认关闭 + 告警。

依赖：E。  
风险门槛：`pnpm m5:gate:verify` 持续稳定。

## Phase G（P2）：工程基线治理

目标：防止架构回弹。  
输出：CI 校验（README/ENV/route-contract/raw-pg 规则）。

---

## 7. 立即可执行的改造清单（建议先做）

1. 缩减 `FASTIFY_PROXY_PREFIXES` 到已本地实现路径，先消除无意义 hop。
2. 拆分 `resolveSessionIdentity` 读写逻辑，profile-status 只读。
3. 统一 Fastify 身份解析，不再回调 Next profile-status。
4. 为 Fastify `pg-context` 补 `APP_RLS_STRICT_MODE` 注入。
5. 新增静态守卫：禁止 `app/api/**` 新增 `getPgPool().query()` 直连。
6. 去掉 `callInternalDataAction` 的 fail-open 二次重试。

---

## 8. 验收与门禁建议

基础门禁：

1. `pnpm m2:gate:verify`
2. `pnpm m3:gate:verify`
3. `pnpm m4:gate:verify`
4. `pnpm m5:gate:verify`
5. `pnpm m6:gate:verify`
6. `pnpm gate:quality:verify`

新增门禁（建议补充）：

1. `gate:strict-consistency:verify`（Next/Fastify strict 行为一致）。
2. `gate:single-path-internal-data`（确保单执行路径）。
3. `guard:no-raw-pg-in-api`（阻断新直连）。
4. `gate:route-contract-parity`（双实现阶段的契约对齐）。

---

## 9. 技术债热力图（按影响×紧急）

### 高影响高紧急

1. 认证读写耦合。
2. Fastify upstream 身份耦合。
3. internal-data 双实现。
4. strict 模式跨运行时不一致。

### 中影响中紧急

1. Dify timeout 与熔断策略不足。
2. 缓存跨实例一致性。
3. 错误 envelope 不统一。

### 中低影响

1. README/文档漂移。
2. 存储 relay fallback 默认策略。

---

## 10. 总结

项目已经具备生产化基础能力，但架构复杂度仍由“迁移中间态”主导。最关键的是先完成收口：

1. 把身份解析从“高频读+写”改为“高频读、低频写”。
2. 让 Fastify 成为真正自治的 API 面，而非 Next 的二次代理。
3. 消除双实现与双语义，把关键路径收敛为单真相。
4. 在此基础上再推进 strict、缓存、存储和治理，风险最小、收益最大。
