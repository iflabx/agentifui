# M7 数据迁移与对账（Source -> Target）

## 1. 目标

M7 目标：提供可重复执行的数据迁移与对账能力，覆盖：

1. 全量迁移（批量 upsert）
2. 增量迁移（checkpoint + watermark）
3. 源库/目标库对账（行数、哈希、分桶、约束）
4. 双读采样比对（关键读路径）
5. 存储对账（DB 引用 vs MinIO 对象）
6. 对账报告归档（JSON + Markdown）

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

4. `scripts/m7-incremental-migrate.mjs`

- 增量迁移（按 `updated_at`，降级 `created_at`）
- checkpoint 表：`public.migration_sync_checkpoints`
- 水位推进策略：`(watermark, primary_key)` 复合游标

5. `scripts/m7-dual-read-verify.mjs`

- 抽样用户关键读路径做 source/target 比对
- 覆盖 `profile/conversations/messages/app_executions/user_identities` 用户域读
- 覆盖 `providers/service_instances/sso_providers` 全局读

6. `scripts/m7-gate-verify.mjs`

- M7 门禁总控（顺序执行 + 结果聚合）
- 归档到 `artifacts/m7/<timestamp>/`
  - 每项检查 `stdout/stderr` 日志
  - 每项检查 JSON 结果
  - `summary.json` + `summary.md`

7. `scripts/m7-gate-verify.sh`

- M7 门禁聚合：
  1. 环境变量归一化
  2. 调用 `m7-gate-verify.mjs`

## 3. NPM 命令

1. `pnpm m7:migrate:dry-run`
2. `pnpm m7:migrate:run`
3. `pnpm m7:migrate:incremental:dry-run`
4. `pnpm m7:migrate:incremental:run`
5. `pnpm m7:reconcile:verify`
6. `pnpm m7:dual-read:verify`
7. `pnpm m7:storage:verify`
8. `pnpm m7:gate:report`
9. `pnpm m7:gate:verify`

## 4. 关键环境变量

数据库：

1. `M7_SOURCE_DATABASE_URL`：源库（未设置时回退 `SUPABASE_DATABASE_URL`，再回退目标库）
2. `M7_TARGET_DATABASE_URL`：目标库（默认 `MIGRATOR_DATABASE_URL`/`DATABASE_URL`）
3. `M7_STORAGE_DATABASE_URL`：存储引用抽取用数据库（默认目标库）

迁移参数：

1. `M7_TABLES`：迁移/对账表列表（逗号分隔）
2. `M7_BATCH_SIZE`：批量 upsert 大小（默认 `1000`）
3. `M7_DRY_RUN`：`1/0`（`m7:migrate:dry-run` 与 `m7:migrate:run` 已封装）
4. `M7_INCREMENTAL_TABLES`：增量迁移表列表（默认同 `M7_TABLES`）
5. `M7_PIPELINE_NAME`：checkpoint 命名空间（默认 `default`）
6. `M7_CHECKPOINT_TABLE`：checkpoint 表名（默认 `migration_sync_checkpoints`）
7. `M7_ALLOW_SAME_SOURCE_TARGET`：允许 source/target 相同并执行 apply（默认 `0`，建议保持关闭）

存储对账参数：

1. `M7_STORAGE_MAX_USERS`：按用户前缀扫描的用户上限（默认 `2000`）
2. `M7_STORAGE_MAX_MISSING_RATE`：失联引用率阈值（默认 `0.001`）
3. `M7_STORAGE_MAX_ORPHAN_RATE`：孤儿对象率阈值（默认 `0.001`）
4. `S3_ENDPOINT` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` / `S3_BUCKET`

双读采样参数：

1. `M7_DUAL_READ_SAMPLE_USERS`：采样用户数（默认 `30`）
2. `M7_DUAL_READ_ROW_LIMIT`：每用户每路径最大读取行数（默认 `50`）

门禁归档参数：

1. `M7_REPORT_DIR`：报告目录（默认 `artifacts/m7/<timestamp>/`）
2. `M7_GATE_RUN_MIGRATION_DRY_RUN`：是否执行全量 dry-run（默认 `1`）
3. `M7_GATE_RUN_INCREMENTAL_DRY_RUN`：是否执行增量 dry-run（默认 `1`）

## 5. 当前阶段说明

当前交付已覆盖 M7 Phase 1 + Phase 2。

仍待 M7 后续补齐（Phase 3）：

1. 增量迁移与业务流量并行时的延迟指标告警
2. 对账结果接入 CI/告警平台
3. 迁移批次审批与回滚脚本自动化
