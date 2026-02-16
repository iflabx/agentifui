# M7 数据迁移与对账（Source -> Target）

## 1. 目标

M7 目标：提供可重复执行的数据迁移与对账能力，覆盖：

1. 全量迁移（批量 upsert）
2. 源库/目标库对账（行数、哈希、分桶、约束）
3. 存储对账（DB 引用 vs MinIO 对象）

## 2. 脚本清单

1. `scripts/m7-data-migrate.mjs`

- 全量迁移执行器，支持 dry-run 与 apply
- 以表级批量 `INSERT ... ON CONFLICT ...` 实现幂等迁移

2. `scripts/m7-reconcile-verify.mjs`

- 源/目标库对账
- 行数对账 + 主键排序哈希对账 + `user_id` 分桶对账
- 关键约束检查（孤儿消息、无效配额、会话 owner 孤儿）

3. `scripts/m7-storage-reconcile-verify.mjs`

- `profiles.avatar_url` 和 `messages` 内容中的 `content-images/*` 引用抽取
- 按用户前缀扫描 MinIO（`avatars/`、`content-images/`）并计算：
  - 失联引用率（DB 引用缺对象）
  - 孤儿对象率（对象无 DB 引用）

4. `scripts/m7-gate-verify.sh`

- M7 门禁聚合：
  1. 迁移 dry-run（可关闭）
  2. DB 对账
  3. 存储对账

## 3. NPM 命令

1. `pnpm m7:migrate:dry-run`
2. `pnpm m7:migrate:run`
3. `pnpm m7:reconcile:verify`
4. `pnpm m7:storage:verify`
5. `pnpm m7:gate:verify`

## 4. 关键环境变量

数据库：

1. `M7_SOURCE_DATABASE_URL`：源库（未设置时回退 `SUPABASE_DATABASE_URL`，再回退目标库）
2. `M7_TARGET_DATABASE_URL`：目标库（默认 `MIGRATOR_DATABASE_URL`/`DATABASE_URL`）
3. `M7_STORAGE_DATABASE_URL`：存储引用抽取用数据库（默认目标库）

迁移参数：

1. `M7_TABLES`：迁移/对账表列表（逗号分隔）
2. `M7_BATCH_SIZE`：批量 upsert 大小（默认 `1000`）
3. `M7_DRY_RUN`：`1/0`（`m7:migrate:dry-run` 与 `m7:migrate:run` 已封装）

存储对账参数：

1. `M7_STORAGE_MAX_USERS`：按用户前缀扫描的用户上限（默认 `2000`）
2. `M7_STORAGE_MAX_MISSING_RATE`：失联引用率阈值（默认 `0.001`）
3. `M7_STORAGE_MAX_ORPHAN_RATE`：孤儿对象率阈值（默认 `0.001`）
4. `S3_ENDPOINT` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` / `S3_BUCKET`

## 5. 当前阶段说明

当前交付为 M7 Phase 1（迁移与对账工具链）。后续会继续补齐：

1. 增量迁移 checkpoint（按 `updated_at` 或 WAL 位点）
2. 双读比对接入业务读路径采样
3. 对账报告归档与告警化
