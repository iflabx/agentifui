# AgentifUI 迁移任务蓝图（里程碑 + 依赖 + 风险门槛）

版本：v1  
日期：2026-02-16  
目标栈：PostgreSQL 18 + Drizzle ORM + Redis 7.x + MinIO + better-auth

## 1. 蓝图目标与约束

目标：

1. 在“前端尽量不变”的前提下替换 Supabase 后端能力。
2. 保持现有数据结构与关键 RPC 语义一致。
3. 以兼容层 + 分阶段切流方式完成迁移，避免一次性重写。

约束来源：

1. Supabase 依赖面覆盖 Auth/RPC/Storage/Realtime（`docs/target-stack-deep-analysis.md:11`, `docs/target-stack-deep-analysis.md:40`）
2. SQL 资产规模大（96 个迁移）（`docs/project-architecture-analysis.md:82`）
3. 当前存在 P0 缺口（RPC 缺失、管理 API 鉴权缺失）（`docs/implementation-readiness-gap-closure.md:21`）

## 2. 里程碑总览

| 里程碑 | 名称               | 核心目标                              | 预计时长 | 进入条件          | 退出条件             |
| ------ | ------------------ | ------------------------------------- | -------- | ----------------- | -------------------- |
| M0     | 基线封版与 P0 清零 | 清理迁移阻断项                        | 3-5 天   | 当前分析文档齐备  | P0 缺口全部关闭      |
| M1     | 基础设施骨架       | DB/Auth/Redis/Storage 工程骨架上线    | 5-7 天   | M0 完成           | 新骨架可本地联调     |
| M2     | Auth 与会话替换    | better-auth + CAS 适配上线（不切流）  | 7-10 天  | M1 完成           | 登录链路等价通过     |
| M3     | DB CRUD 兼容层     | Supabase CRUD 调用逐步接管到 BFF+Repo | 7-10 天  | M1 完成           | 核心表 CRUD 全通过   |
| M4     | RPC + RLS 语义迁移 | SQL 函数与权限策略等价                | 7-12 天  | M3 完成           | 关键 RPC 回归通过    |
| M5     | Storage 迁移       | MinIO 预签名与对象策略替换            | 5-7 天   | M1 + M3 完成      | 头像/内容图链路通过  |
| M6     | Realtime 迁移      | Redis + WS/SSE 替代 postgres_changes  | 7-10 天  | M2 + M3 完成      | 订阅行为和延迟达标   |
| M7     | 数据迁移与对账     | 全量迁移 + 增量校验 + 双读比对        | 5-8 天   | M4 + M5 + M6 完成 | 对账达标             |
| M8     | 灰度切流与回滚演练 | 5%->20%->50%->100%                    | 3-5 天   | M7 完成           | 稳定运行 24h         |
| M9     | 退场与收口         | Supabase 依赖清理、运维固化           | 3-5 天   | M8 完成           | 技术债清零与文档归档 |

## 2.1 当前进度（2026-02-16）

- M0：完成
- M1：完成
- M2：完成
- M3：完成（见 `docs/m3-db-crud-compatibility.md`）
- M4：完成（Phase1 + Phase2 + Phase3 + Hardening 已完成，见 `docs/m4-rpc-rls-compatibility.md`）
- M5：完成（`pnpm m5:storage:verify`、`pnpm m5:storage:slo:verify`、`pnpm m5:gate:verify` 已通过）
- M6：完成（`pnpm m6:realtime:verify`、`pnpm m6:realtime:slo:verify`、`pnpm m6:gate:verify` 已通过）
- M7：完成（Phase 1-4 已闭环：增量 checkpoint、双读/存储对账、滞后门禁、批次回滚、CI 运行时门禁）
- M8：进行中（已落地自动化 gate/rollout/rollback 脚本，见 `docs/m8-rollout-rollback-runbook.md`）
- M9：未开始

## 3. 里程碑详细任务

## 3.1 M0 基线封版与 P0 清零

关键任务：

1. 补齐缺失 RPC 定义：`increment_api_key_usage`、`update_sso_provider_order`（`docs/implementation-readiness-gap-closure.md:63`）
2. 管理 API 鉴权统一为 `requireAdmin()`（`docs/implementation-readiness-gap-closure.md:267`）
3. 冻结 schema 变更窗口，建立迁移分支策略。

产出物：

1. SQL 迁移补丁（含缺失函数定义）
2. 管理 API 鉴权收敛 PR
3. 迁移冻结公告与变更守则

Gate：

1. `docs/implementation-readiness-gap-closure.md:289` 至 `docs/implementation-readiness-gap-closure.md:293` 全部满足

## 3.2 M1 基础设施骨架

关键任务：

1. DB 单入口抽象（参考 `docs/lobehub-methods-benchmark.md:26`）
2. Redis Manager 与 prefix 机制（参考 `docs/lobehub-methods-benchmark.md:29`）
3. MinIO/S3 网关模块与 env 校验
4. BFF 目录与兼容客户端目录落位（`docs/backend-compatibility-components-checklist.md:177`）

产出物：

1. `lib/server/db/*`、`lib/infra/redis/*`、`lib/server/storage/*`
2. `lib/backend-client/*` 兼容层骨架
3. 本地 docker-compose 基础依赖（PostgreSQL/Redis/MinIO）

Gate：

1. 本地端到端可跑通：Auth 健康检查、DB 连接检查、Redis ping、MinIO bucket 探活

## 3.3 M2 Auth 与会话替换（不切流）

关键任务：

1. better-auth 中心化配置与 API 接入（参考 `docs/lobehub-methods-benchmark.md:27`）
2. CAS SSO provider registry + fail-fast（参考 `docs/lobehub-methods-benchmark.md:28`）
3. 会话与幂等态迁移到 Redis（二级存储）
4. 中间件替换 `supabase.auth.getUser()` 语义：保持账号状态与角色拦截等价（`middleware.ts:110`, `middleware.ts:196`, `middleware.ts:209`）

产出物：

1. 新 auth 路由与中间件
2. SSO 登录回调适配层
3. Auth 兼容 hook（替代 `lib/supabase/hooks.ts` 关键能力）

Gate：

1. 登录/登出/会话过期/找回密码/SSO 登录全部通过
2. API 与鉴权 SLO 达标（`docs/implementation-readiness-gap-closure.md:93`）

## 3.4 M3 DB CRUD 兼容层

关键任务：

1. 建立 Repo 层：Drizzle 接管 `.from(...).select/insert/update/delete`
2. 先兼容高频表：`profiles`, `conversations`, `messages`, `service_instances`, `providers`
3. 保留错误语义与 `Result` 包装，减少前端改动面
4. 替换 `DataService` 的 Supabase 依赖（`lib/services/db/data-service.ts:34`）

产出物：

1. CRUD 兼容实现与回归测试
2. 兼容 API 与旧调用映射文档

Gate：

1. 核心表 CRUD 用例通过率 >= 99%
2. 关键页面无行为回归（聊天、应用列表、设置页）

## 3.5 M4 RPC + RLS 语义迁移

关键任务：

1. 关键 RPC 保留为 PostgreSQL 函数并建立语义回归
2. RLS 从 `auth.uid()` 迁移为 GUC 注入模式（`docs/target-stack-deep-analysis.md:111`）
3. 重点验证：配额、默认实例、管理员查询、用户删除、SSO 相关函数
4. runtime/migrator 角色分离与 runtime role 硬化（禁止 superuser/bypassrls）
5. strict mode 开关与 legacy bypass 渐进收口

产出物：

1. SQL 函数迁移包 + RLS 策略迁移包
2. RPC 契约测试（正常/越权/并发/回滚）

Gate：

1. `docs/implementation-readiness-gap-closure.md:82` 至 `docs/implementation-readiness-gap-closure.md:88` 全部通过
2. 关键 RPC 结果结构与旧链路一致

## 3.6 M5 Storage 迁移（MinIO）

关键任务：

1. 预签名上传/下载 API
2. 对象路径策略收敛（`avatars`、`content-images`）
3. 头像与内容图流程替换前端直传 Supabase
4. 元数据校验（服务端 HeadObject）

产出物：

1. 存储网关 API
2. 上传/删除/清理任务
3. 对象路径与 ACL 策略文档

Gate：

1. 预签名 URL `p95 <= 150ms`（`docs/implementation-readiness-gap-closure.md:114`）
2. <=10MB 上传成功率 `>= 99.9%`（`docs/implementation-readiness-gap-closure.md:117`）

## 3.7 M6 Realtime 迁移（Redis + WS/SSE）

关键任务：

1. 建事件模型：PG 变更 -> Redis Streams/PubSub -> WS/SSE
2. 保持 `SubscriptionKeys` 订阅语义兼容（`lib/services/db/realtime-service.ts:251`）
3. 支持订阅复用、取消订阅、全量退订

产出物：

1. Realtime 网关服务
2. 前端兼容 realtime client
3. 延迟与丢包监控面板

Gate：

1. 事件送达延迟 `p95 <= 1s`, `p99 <= 2s`（`docs/implementation-readiness-gap-closure.md:105`）
2. 事件丢失率 `< 0.1%`（`docs/implementation-readiness-gap-closure.md:109`）

## 3.8 M7 数据迁移与对账

关键任务：

1. 全量迁移 + 增量补偿
2. 执行行数对账、分桶对账、哈希对账、约束对账
3. 存储对象对账（DB 引用与 MinIO 对象）

产出物：

1. 对账报告（每次迁移批次归档）
2. 差异清单与修复脚本

Gate：

1. 关键表误差为 0（或可解释且获批阈值）
2. 存储孤儿/失联引用率 <= 0.1%（`docs/implementation-readiness-gap-closure.md:231`）

## 3.9 M8 灰度切流与回滚演练

关键任务：

1. 按 5% -> 20% -> 50% -> 100% 放量（`docs/implementation-readiness-gap-closure.md:239`）
2. 每阶段执行冒烟 + 指标审查 + 抽样对账
3. 回滚演练至少 1 次

产出物：

1. 切流记录与每阶段验收报告
2. 回滚演练报告
3. 自动化执行脚本与 runbook（`docs/m8-rollout-rollback-runbook.md`）

Gate：

1. 满足回滚触发条件“零触发”
2. 100% 流量稳定运行 24h

## 3.10 M9 退场与收口

关键任务：

1. 清理 Supabase SDK 与环境变量
2. 清理旧 SQL/脚本与死代码路径
3. 完成运维手册（备份、恢复、应急）与交接

产出物：

1. 技术债清单归零
2. 迁移后基线文档（架构图、运行手册、告警规则）

Gate：

1. 代码仓中无运行时 Supabase 依赖
2. 备份/恢复演练通过（RTO/RPO 达标）

## 4. 依赖关系（关键链）

主依赖链：

1. `M0 -> M1 -> M2`
2. `M1 -> M3 -> M4`
3. `M1 + M3 -> M5`
4. `M2 + M3 -> M6`
5. `M4 + M5 + M6 -> M7 -> M8 -> M9`

外部依赖（需提前锁定）：

1. SMTP（邮件）
2. 短信供应商（OTP）
3. OAuth/CAS 凭据与回调域名
4. 生产基础设施（PgBouncer、Redis 高可用、MinIO 存储策略）
5. 观测系统（日志、指标、告警）

## 5. 风险门槛（Go/No-Go + 回滚触发）

## 5.1 全局 Go/No-Go 门槛

1. API 鉴权：

- 登录链路 `p95 <= 300ms`, `p99 <= 800ms`, `5xx < 0.3%`

2. 核心业务 API：

- 读 `p95 <= 350ms`, 写 `p95 <= 700ms`, `5xx < 0.5%`

3. Realtime：

- `p95 <= 1s`, `p99 <= 2s`, 丢失率 `<0.1%`

4. 存储：

- 预签名 `p95 <= 150ms`, 上传成功率 `>=99.9%`

5. 可用性与恢复：

- 可用性 `>=99.9%`, `RTO <= 15 分钟`, `RPO <= 1 分钟`

门槛来源：`docs/implementation-readiness-gap-closure.md:91` 至 `docs/implementation-readiness-gap-closure.md:127`

## 5.2 回滚触发条件（任一命中即回滚）

1. `5xx` 连续 5 分钟 > `1.0%`
2. Realtime `p95 > 2s` 持续 10 分钟
3. 登录失败率 > `1.0%` 持续 5 分钟
4. 关键表出现不可解释对账差异
5. 管理员越权/鉴权绕过事件

来源：`docs/implementation-readiness-gap-closure.md:251`

## 5.3 风险清单与缓解动作

| 风险             | 影响               | 触发信号                 | 缓解动作                                          |
| ---------------- | ------------------ | ------------------------ | ------------------------------------------------- |
| RPC 语义不一致   | 权限/配额错误      | 回归失败、线上配额异常   | 先保留 SQL 函数，后续再服务化                     |
| 鉴权收敛不彻底   | 管理接口越权       | 安全扫描命中未鉴权路由   | 强制 `requireAdmin()`；CI 扫描 `app/api/admin/**` |
| Realtime 丢事件  | 聊天与列表更新异常 | 延迟/丢失率上升          | Redis Stream 消费组 + 重放窗口 + 幂等消费         |
| 存储策略漂移     | 文件越权或失联     | 上传成功但 DB/对象不一致 | 路径规范 + Head 校验 + 定时对账                   |
| 迁移窗口变更冲突 | 反复返工           | 主分支 schema 频繁变更   | 冻结窗口 + schema 变更审批                        |

## 6. 执行模式（单开发者）

按“我单人全程开发”的模式执行，策略如下：

1. 严格按里程碑串行推进：`M0 -> M1 -> M2 -> ... -> M9`
2. 每完成一个里程碑，先做 Gate 验收，再进入下一个里程碑
3. 每个里程碑都保留可回滚状态点（代码、SQL、配置、数据对账快照）
4. 优先实现“垂直切片”验证链路：登录 + 会话 + 单表读写 + 单条 Realtime
5. 不做基于人力分工的子计划，全部以可交付产出和验收标准驱动
