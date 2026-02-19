# AgentifUI 开发与部署流程（最佳实践）

## 1. 目标与原则

本流程用于解决以下问题：

1. 避免开发环境改动影响线上稳定性。
2. 避免 `next dev` 与 `next start` 共享构建产物导致白屏。
3. 保障测试数据与生产数据严格隔离。
4. 在同一套代码下，实现可追溯、可回滚、可重复的发布流程。

核心原则：

1. 共享代码版本，不共享运行态。
2. 共享代码仓库，不共享数据资源。
3. 生产只运行“构建产物”，不直接在生产目录热更新源码。
4. 迁移采用 forward-only（前向迁移）优先，避免线上频繁回滚数据库结构。

## 2. 环境分层设计

建议至少三套环境：

1. `dev`：本地开发与热更新。
2. `staging`：预发布验收，配置尽量贴近生产。
3. `prod`：正式生产。

环境必须独立的维度：

1. 进程：独立 PM2 进程名与端口。
2. 构建目录：不能共用同一个 `.next`。
3. 环境变量：独立 `.env.*` 文件。
4. 数据：独立 PG/Redis/MinIO 资源或独立命名空间。
5. 密钥：`BETTER_AUTH_SECRET`、`API_ENCRYPTION_KEY` 等按环境分离。

## 3. 代码管理策略

代码仓库建议：

1. 单仓库（monorepo）继续保留。
2. 分支策略：
   - `feature/*`：功能开发分支。
   - `develop`：日常集成分支。
   - `main`：可发布分支。
3. 发布必须打 tag（例如 `v1.0.0`），保证可追溯。

运行目录建议（避免 dev/prod 冲突）：

1. 使用不同工作目录（推荐 `git worktree`）：
   - `/srv/agentifui-dev`
   - `/srv/agentifui-staging`
   - `/srv/agentifui-prod`
2. 禁止在同一目录同时运行 `next dev` 和 `next start`。

## 4. 数据与配置隔离矩阵

| 维度               | dev             | staging             | prod                          |
| ------------------ | --------------- | ------------------- | ----------------------------- |
| PostgreSQL         | `agentifui_dev` | `agentifui_staging` | `agentifui_prod`              |
| Redis              | `redis://.../1` | `redis://.../2`     | `redis://.../0`（或独立实例） |
| MinIO Bucket       | `agentifui-dev` | `agentifui-staging` | `agentifui-prod`              |
| BETTER_AUTH_SECRET | dev 专用        | staging 专用        | prod 专用                     |
| API_ENCRYPTION_KEY | dev 专用        | staging 专用        | prod 专用                     |
| 回调域名           | dev 域名/端口   | staging 域名        | prod 域名                     |

说明：

1. 即使使用同一台物理机，也必须通过库名、Redis DB、Bucket、密钥隔离。
2. `API_ENCRYPTION_KEY` 不可跨环境复用，否则会出现加密内容解密失败。

## 5. 开发流程（Day-to-Day）

1. 在 `feature/*` 分支开发。
2. 启动 `dev`：
   - `pnpm dev`（Next）
   - `pnpm dev:api`（Fastify）
3. 每次功能完成执行：
   - `pnpm type-check`
   - `pnpm lint`
   - 必要的门禁脚本（如 `pnpm m3:internal-data:verify`）
4. 提交并发起 PR 到 `develop`。

禁止项：

1. 在生产目录运行 `next dev`。
2. 直接在 `prod` 环境手工改代码文件。

## 6. 预发布与上线流程

### 6.1 PR 合并前（CI）

1. 静态检查：`lint + type-check`。
2. 单元/集成测试。
3. 迁移脚本有效性检查（至少 dry-run）。

### 6.2 部署 staging

1. 在 staging 目录拉取目标 commit/tag。
2. 安装依赖并构建：
   - `pnpm install --frozen-lockfile`
   - `pnpm build`
3. 执行迁移（staging DB）。
4. 启动/重启 staging PM2 进程。
5. 执行验收用 smoke 与关键业务流测试。

### 6.3 部署 prod

1. 仅从已验收的 tag 部署。
2. 发布前备份生产数据库（必须）。
3. 执行生产迁移。
4. 重启生产进程（PM2）。
5. 发布后立即执行 smoke。
6. 监控 15~30 分钟关键指标再宣布完成。

## 7. 数据库迁移策略

推荐策略：

1. 新安装版本：可使用当前最新 baseline + 增量迁移。
2. 生产升级：按迁移顺序执行，不跳步骤。
3. 优先可回放（idempotent）迁移脚本。
4. 尽量避免破坏性变更，采用“先兼容、后收敛”。

发布顺序建议：

1. 先备份。
2. 先迁移数据库。
3. 再部署应用。
4. 再执行应用级校验。

## 8. PM2 进程管理建议

建议使用独立进程名：

1. `AgentifUI-Dev`（可选，通常 dev 不建议用 PM2）
2. `AgentifUI-Staging`
3. `AgentifUI-Prod`
4. `AgentifUI-API-Staging`
5. `AgentifUI-API-Prod`

关键要求：

1. 每个环境使用独立 `env_file`。
2. 不同环境端口不能冲突。
3. 发布使用 `pm2 restart ... --update-env`。

## 9. 回滚策略

应用回滚：

1. 保留最近 N 个可用发布版本目录。
2. 回滚到上一个稳定 tag 并重启 PM2。

数据回滚：

1. 优先 forward-fix（补丁修复）而不是结构回滚。
2. 严重故障时才使用备份恢复（需停写并评估数据丢失窗口）。

## 10. 当前项目的落地建议（最小可执行）

第一阶段（立即执行）：

1. 拆分 `.env.dev`、`.env.staging`、`.env.prod`。
2. 拆分运行目录（至少 staging/prod 分开）。
3. 禁止同目录并行运行 dev/prod。

第二阶段（一周内）：

1. 补齐 staging 完整发布脚本（build/migrate/restart/smoke）。
2. 补齐生产发布前自动备份脚本。
3. 把门禁检查接入 CI。

第三阶段（稳定期）：

1. 建立版本化发布记录（tag + 变更说明 + 回滚点）。
2. 持续收敛告警与监控阈值。

## 10A. 两环境最小方案（当前推荐）

如果当前不准备维护完整 `dev/staging/prod` 三环境，可先采用“两环境最小方案”：

1. 仅保留 `dev` 与 `prod` 两套环境。
2. 两套环境使用同一仓库代码版本体系（同分支与 tag 流程），但运行态与数据严格隔离。

### 10A.1 运行与目录

1. `dev` 与 `prod` 必须使用不同目录（推荐 `git worktree`）。
2. `dev` 可以用 PM2 托管（例如 `AgentifUI-Dev`、`AgentifUI-API-Dev`）。
3. `prod` 用独立 PM2 进程（例如 `AgentifUI`、`AgentifUI-API`）。
4. 禁止在同一目录同时运行 `next dev` 与 `next start`。

### 10A.2 数据与配置隔离

1. `dev` 使用 `.env.dev`，`prod` 使用 `.env.prod`。
2. PostgreSQL 分离：
   - `agentifui_dev`
   - `agentifui_prod`
3. Redis 分离（独立实例或至少独立 DB 编号）。
4. MinIO 分离（独立 bucket 或明确前缀隔离）。
5. 密钥分离：
   - `BETTER_AUTH_SECRET`
   - `API_ENCRYPTION_KEY`
   - 其他认证/签名密钥

### 10A.3 最小发布流程（6 步）

1. 在 `dev` 完成功能开发与自测。
2. 执行基础检查：`pnpm type-check && pnpm lint`。
3. 提交并打发布 tag（例如 `v1.0.x`）。
4. `prod` 目录切换到该 tag，执行 `pnpm install --frozen-lockfile && pnpm build`。
5. 备份生产数据库并执行 migration。
6. 重启生产 PM2 进程并执行 smoke 验证。

### 10A.4 关于“用 PM2 跑 dev”

1. 可以跑，适合稳定管理开发进程与日志。
2. 但 PM2 不能本质解决热更新慢的问题，热更新性能主要受代码体量、编译配置、机器资源影响。
3. 如果热更新慢，优先优化：
   - 避免开发时开启不必要调试参数（如 `--inspect`）。
   - 尝试 `pnpm dev:web` 或 `pnpm dev:turbo`。
   - 控制同时运行的后台任务与日志 IO。
4. 无论是否用 PM2，`dev/prod` 并行冲突问题仍需通过“目录隔离 + env 隔离”解决。

## 11. 常见错误与规避

1. 错误：在同一目录先跑 `dev` 再跑 `prod`，出现白屏。
   - 规避：分目录运行，或每次生产启动前强制重新 `build`。
2. 错误：不同环境共用加密密钥或数据库。
   - 规避：环境级密钥与数据资源隔离。
3. 错误：未备份直接执行生产迁移。
   - 规避：将“备份成功”设为发布前置门槛。

---

维护建议：

1. 每次流程调整后同步更新本文件。
2. 每个发布版本在变更记录中附带“执行命令、迁移编号、回滚点”。
