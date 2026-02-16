# M7 数据迁移与对账（Source -> Target）

## 1. 目标

M7 目标：提供可重复执行的数据迁移与对账能力，覆盖：

1. 全量迁移（批量 upsert）
2. 增量迁移（checkpoint + watermark）
3. 源库/目标库对账（行数、哈希、分桶、约束）
4. 双读采样比对（关键读路径）
5. 存储对账（DB 引用 vs MinIO 对象）
6. 对账报告归档（JSON + Markdown）
7. 批次审批执行与 checkpoint 回滚自动化

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

8. `scripts/m7-lag-verify.mjs`

- 增量迁移新鲜度门禁
- 核心指标：`source.max(watermark)` 与 checkpoint `last_watermark` 的滞后秒数

9. `scripts/m7-batch-apply.mjs`

- 批次执行器（需要显式审批开关）
- 执行前保存 checkpoint 快照，执行后保存 summary
- 失败时可自动回滚 checkpoint（可关闭）

10. `scripts/m7-batch-rollback.mjs`

- 手动回滚 checkpoint 到指定快照

11. `scripts/m7-alert-notify.mjs`

- 读取最新 gate summary（或指定 summary）并发送 webhook
- 可配置仅失败通知，且可在 gate 失败时返回非 0 退出码

12. `scripts/m7-ci-verify.mjs`

- M7 静态 CI 门禁（语法、命令接线、文档命令清单）
- GitHub Workflow：`.github/workflows/m7-gate-ci.yml`

13. `scripts/m7-s3-bootstrap.mjs`

- MinIO bucket 自举（存在则跳过，不存在则创建）

14. `scripts/m7-ci-runtime-verify.sh`

- M7 运行时门禁：双库初始化、迁移、对账、存储联通
- 默认用于 CI 运行时 smoke（非静态语法检查）

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
10. `pnpm m7:lag:verify`
11. `pnpm m7:batch:apply`
12. `pnpm m7:batch:rollback`
13. `pnpm m7:alert:notify`
14. `pnpm m7:ci:verify`
15. `pnpm m7:s3:bootstrap`
16. `pnpm m7:ci:runtime:verify`

## 4. 关键环境变量

数据库：

1. `M7_SOURCE_DATABASE_URL`：源库（必填，不再回退 Supabase 变量）
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
8. `M7_DISABLE_LOCK`：禁用迁移 advisory lock（默认 `0`）
9. `M7_LOCK_KEY`：自定义 advisory lock key（默认 `m7:incremental:<pipeline>`）

存储对账参数：

1. `M7_STORAGE_MAX_USERS`：按用户前缀扫描的用户上限（默认 `2000`）
2. `M7_STORAGE_MAX_MISSING_RATE`：失联引用率阈值（默认 `0.001`）
3. `M7_STORAGE_MAX_ORPHAN_RATE`：孤儿对象率阈值（默认 `0.001`）
4. `M7_STORAGE_SCAN_STRATEGY`：`sample/all`（默认 `sample`）
5. `M7_STORAGE_REQUIRE_FULL_COVERAGE`：是否要求全量用户扫描（默认 `0`）
6. `M7_STORAGE_MIN_COVERAGE`：最小用户覆盖率（默认 `0`）
7. `S3_ENDPOINT` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` / `S3_BUCKET`

双读采样参数：

1. `M7_DUAL_READ_SAMPLE_USERS`：采样用户数（默认 `30`）
2. `M7_DUAL_READ_ROW_LIMIT`：每用户每路径最大读取行数（默认 `50`）
3. `M7_DUAL_READ_SAMPLE_STRATEGY`：`sample/all`（默认 `sample`）
4. `M7_DUAL_READ_REQUIRE_FULL_COVERAGE`：是否要求全量用户覆盖（默认 `0`）
5. `M7_DUAL_READ_MIN_COVERAGE`：最小用户覆盖率（默认 `0`）

门禁归档参数：

1. `M7_REPORT_DIR`：报告目录（默认 `artifacts/m7/<timestamp>/`）
2. `M7_GATE_RUN_MIGRATION_DRY_RUN`：是否执行全量 dry-run（默认 `1`）
3. `M7_GATE_RUN_INCREMENTAL_DRY_RUN`：是否执行增量 dry-run（默认 `1`）
4. `M7_GATE_RUN_DB_RECONCILE`：是否执行 DB 对账（默认 `1`）
5. `M7_GATE_RUN_DUAL_READ`：是否执行双读采样（默认 `1`）
6. `M7_GATE_RUN_STORAGE_RECONCILE`：是否执行存储对账（默认 `1`）
7. `M7_GATE_RUN_LAG_VERIFY`：是否执行滞后检查（默认 `1`）

滞后门禁参数：

1. `M7_MAX_LAG_SECONDS`：允许的最大滞后秒数（默认 `300`）
2. `M7_LAG_REQUIRE_CHECKPOINT`：是否要求有 checkpoint（默认 `1`）

批次执行参数：

1. `M7_BATCH_APPROVED`：审批开关，必须为 `1` 才能执行 `m7:batch:apply`
2. `M7_BATCH_AUTO_ROLLBACK`：失败是否自动回滚 checkpoint（默认 `1`）
3. `M7_BATCH_ID`：批次 ID（默认时间戳）
4. `M7_BATCH_DIR`：批次报告目录（默认 `artifacts/m7/batches/<batchId>/`）
5. `M7_BATCH_CHECKPOINT_SNAPSHOT`：`m7:batch:rollback` 使用的 checkpoint 快照路径
6. `M7_BATCH_CAPTURE_DATA_SNAPSHOT`：批次前是否创建目标库数据快照（默认 `1`）
7. `M7_BATCH_DATA_SNAPSHOT_SCHEMA`：数据快照 schema（默认 `m7_batch_snapshot_<batchId>`）
8. `M7_BATCH_DUAL_READ_STRATEGY`：批次内 dual-read 策略（默认 `all`）
9. `M7_BATCH_STORAGE_SCAN_STRATEGY`：批次内存储对账策略（默认 `all`）

告警参数：

1. `M7_ALERT_SUMMARY_PATH`：summary 路径（默认自动选取最新）
2. `M7_ALERT_WEBHOOK_URL`：webhook 地址
3. `M7_ALERT_NOTIFY_ON_SUCCESS`：成功是否通知（默认 `0`）
4. `M7_ALERT_FAIL_ON_GATE_FAILURE`：gate 失败是否返回非 0（默认 `1`）
5. `M7_ALERT_WEBHOOK_SECRET`：HMAC 签名密钥（header: `x-m7-signature`）
6. `M7_ALERT_MAX_RETRIES`：Webhook 最大重试次数（默认 `3`）
7. `M7_ALERT_RETRY_BASE_MS`：重试基础间隔（默认 `500`）

## 5. 当前阶段说明

当前交付已覆盖 M7 Phase 1 + Phase 2 + Phase 3 + Phase 4：

1. 滞后门禁（lag verify）已接入默认 gate
2. 告警通知已支持 webhook + 重试 + 签名
3. 批次执行已支持 checkpoint + 数据快照回滚
4. CI 已接入静态 + 运行时门禁
5. 已补充 `20260216023000_preserve_explicit_updated_at_in_trigger.sql`，确保迁移显式写入 `updated_at` 时不会被触发器覆盖，避免对账误差

## 6. 常用执行示例

1. 批次执行（同库演练）：
   `M7_BATCH_APPROVED=1 M7_ALLOW_SAME_SOURCE_TARGET=1 pnpm -s m7:batch:apply`
2. 回滚 checkpoint（参数传递）：
   `pnpm -s m7:batch:rollback -- artifacts/m7/batches/<batchId>/checkpoint-before.json`
3. 回滚 checkpoint（环境变量）：
   `M7_BATCH_CHECKPOINT_SNAPSHOT=artifacts/m7/batches/<batchId>/checkpoint-before.json pnpm -s m7:batch:rollback`
4. 回滚数据(schema) + checkpoint：
   `M7_BATCH_CHECKPOINT_SNAPSHOT=artifacts/m7/batches/<batchId>/checkpoint-before.json M7_BATCH_DATA_SNAPSHOT_SCHEMA=m7_batch_snapshot_<batchId> pnpm -s m7:batch:rollback`
5. 容器内 runtime smoke（源/目标/MinIO 在宿主）：
   `PG_ADMIN_URL=postgresql://agentif:agentif@172.20.0.1:5432/agentifui M7_SOURCE_DATABASE_URL=postgresql://agentif:agentif@172.20.0.1:5432/agentifui_source M7_TARGET_DATABASE_URL=postgresql://agentif:agentif@172.20.0.1:5432/agentifui_target M7_STORAGE_DATABASE_URL=postgresql://agentif:agentif@172.20.0.1:5432/agentifui_target S3_ENDPOINT=http://172.20.0.1:9000 S3_ACCESS_KEY_ID=minioadmin S3_SECRET_ACCESS_KEY=minioadmin S3_BUCKET=agentifui S3_ENABLE_PATH_STYLE=1 pnpm -s m7:ci:runtime:verify`
