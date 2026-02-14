# AgentifUI 本地最小测试栈

更新时间：2026-02-14

## 1. 目标

用于迁移阶段的“最小可运行测试栈”，覆盖：

1. PostgreSQL（目标主库）
2. Redis（会话/缓存/幂等）
3. MinIO（对象存储）

对应文件：

1. `docker-compose.test-stack.yml`
2. `.env.test-stack.example`
3. `scripts/test-stack.sh`

## 2. 前置条件

1. 已安装 Docker Engine
2. 已安装 Docker Compose v2（`docker compose`）

快速检查：

```bash
docker --version
docker compose version
```

## 3. 启动

1. 首次启动（自动生成 `.env.test-stack`）：

```bash
pnpm stack:test:up
```

2. 查看状态：

```bash
pnpm stack:test:ps
```

3. 健康检查：

```bash
pnpm stack:test:health
```

## 4. 连接信息

默认端口：

1. PostgreSQL: `127.0.0.1:5432`
2. Redis: `127.0.0.1:6379`
3. MinIO API: `127.0.0.1:9000`
4. MinIO Console: `http://127.0.0.1:9001`

默认凭据（仅本地测试）：

1. PostgreSQL: `agentif / agentif`
2. MinIO: `minioadmin / minioadmin`
3. Bucket: `agentifui`（启动时自动创建）

## 5. 停止与清理

1. 停止容器：

```bash
pnpm stack:test:down
```

2. 重置（删除数据卷，慎用）：

```bash
pnpm stack:test:reset
```

## 6. 环境变量模板

基于 `.env.test-stack.example` 复制后使用：

```bash
cp .env.test-stack.example .env.test-stack
```

该文件已包含迁移栈常用连接变量示例：

1. `DATABASE_URL`
2. `REDIS_URL`
3. `S3_ENDPOINT` / `S3_BUCKET` / `S3_*`
4. `AUTH_SECRET`

## 7. 常见问题

1. 端口占用：

- 修改 `.env.test-stack` 中对应端口后重启 `pnpm stack:test:up`

2. MinIO bucket 未创建：

- 执行 `bash scripts/test-stack.sh init`

3. Docker 未安装：

- 按 `docs/QUICK-DEPLOYMENT.md` 的 Docker 安装章节先安装，再执行本文件步骤
