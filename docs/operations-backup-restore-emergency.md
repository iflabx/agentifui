# AgentifUI 备份/恢复/应急运行手册

版本：v1  
日期：2026-02-16  
适用阶段：M9 收口与上线后运维

## 1. 目标与边界

目标：为当前运行基线（PostgreSQL + Redis + MinIO + better-auth）提供可执行的备份、恢复、应急流程，并沉淀 RTO/RPO 验收记录。

边界：

1. 本手册覆盖数据层与对象存储层。
2. 应用层可用性验证以最小冒烟为主，不替代完整业务回归。
3. 生产演练建议在变更窗口内执行。

## 2. 基线组件

1. PostgreSQL 18（主数据）
2. Redis 7.x（会话/实时等瞬态数据）
3. MinIO（对象数据：头像、内容图）
4. AgentifUI 应用（验证入口）

## 3. 备份策略

## 3.1 PostgreSQL

频率建议：

1. 每日全量逻辑备份（`pg_dump -Fc`）
2. 每小时增量/WAL 归档（如果已启用）

示例（全量）：

```bash
export PGHOST=127.0.0.1
export PGPORT=5432
export PGUSER=agentif
export PGPASSWORD=agentif
export PGDATABASE=agentifui

BACKUP_DIR=/var/backups/agentifui/postgres
mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%dT%H%M%S)

pg_dump -Fc -f "$BACKUP_DIR/agentifui-${STAMP}.dump" "$PGDATABASE"
sha256sum "$BACKUP_DIR/agentifui-${STAMP}.dump" > "$BACKUP_DIR/agentifui-${STAMP}.dump.sha256"
```

## 3.2 Redis

频率建议：

1. 保持 AOF 开启（如生产启用）
2. 每日落地 RDB 快照文件

示例：

```bash
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_DIR=/var/backups/agentifui/redis
mkdir -p "$REDIS_DIR"
STAMP=$(date +%Y%m%dT%H%M%S)

redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" BGSAVE
# 等待 bgsave 完成后复制 dump 文件（路径按你的 redis 配置）
cp /var/lib/redis/dump.rdb "$REDIS_DIR/dump-${STAMP}.rdb"
sha256sum "$REDIS_DIR/dump-${STAMP}.rdb" > "$REDIS_DIR/dump-${STAMP}.rdb.sha256"
```

## 3.3 MinIO

频率建议：

1. 每日对象镜像备份
2. 关键桶（`agentifui`）按目录分层保留

示例：

```bash
export MC_HOST_local=http://minioadmin:minioadmin@127.0.0.1:9000
BACKUP_DIR=/var/backups/agentifui/minio
STAMP=$(date +%Y%m%dT%H%M%S)
mkdir -p "$BACKUP_DIR/$STAMP"

mc mirror --overwrite local/agentifui "$BACKUP_DIR/$STAMP/agentifui"
```

## 4. 恢复演练（Drill）

## 4.1 演练前检查

1. 确认最新可用备份与校验和存在。
2. 记录演练开始时间（用于 RTO 计算）。
3. 准备隔离恢复目标（建议新库/新目录，不直接覆盖生产）。

## 4.2 PostgreSQL 恢复演练

```bash
export PGHOST=127.0.0.1
export PGPORT=5432
export PGUSER=agentif
export PGPASSWORD=agentif

RESTORE_DB=agentifui_restore_drill
createdb "$RESTORE_DB"
pg_restore -d "$RESTORE_DB" /var/backups/agentifui/postgres/agentifui-<STAMP>.dump
```

恢复后验证建议：

1. 关键表行数（`profiles`、`conversations`、`messages`）
2. 关键约束与索引存在性
3. 应用只读查询冒烟

## 4.3 Redis 恢复演练

1. 在隔离 Redis 实例中加载备份 RDB/AOF。
2. 校验关键 key 前缀是否可读（会话、realtime 流等）。

## 4.4 MinIO 恢复演练

```bash
export MC_HOST_local=http://minioadmin:minioadmin@127.0.0.1:9000
mc mirror --overwrite /var/backups/agentifui/minio/<STAMP>/agentifui local/agentifui-restore-drill
```

验证：

1. 抽样对象可下载
2. 对象路径与元数据完整

## 5. 应急流程（故障场景）

## 5.1 IdP/SSO 故障

1. 启用 break-glass 本地登录流程（见 `docs/break-glass-admin-usage-manual.md`）。
2. 管理员执行只读巡检与最小必要变更。
3. IdP 恢复后回切 SSO 主路径并审计登录日志。

## 5.2 PostgreSQL 故障

1. 应用置为维护模式（阻断写入）。
2. 执行最近可用备份恢复。
3. 冒烟验证通过后恢复写流量。

## 5.3 Redis 故障

1. 切换到备用 Redis 或重建实例。
2. 恢复会话后强制重新登录高风险用户（按策略）。
3. 验证实时订阅链路。

## 5.4 MinIO 故障

1. 切换到备用对象存储或恢复 bucket 数据。
2. 验证头像、内容图预签名上传/下载链路。

## 6. 验收记录模板（RTO/RPO）

每次演练记录以下字段：

1. 演练日期
2. 场景（PG/Redis/MinIO/综合）
3. 备份时间点
4. 故障发现时间
5. 服务恢复时间
6. 数据回退时间点
7. `RTO`（分钟）
8. `RPO`（分钟）
9. 结论（通过/未通过）
10. 改进项与负责人

建议目标（与迁移蓝图一致）：

1. `RTO <= 15 分钟`
2. `RPO <= 1 分钟`

## 7. M9 最终门禁建议

1. 至少完成 1 次 PostgreSQL 恢复演练并留档。
2. 至少完成 1 次 MinIO 对象恢复演练并留档。
3. 关键路径冒烟通过（Auth、Storage、Realtime）。
4. RTO/RPO 记录满足阈值或有明确豁免审批。
