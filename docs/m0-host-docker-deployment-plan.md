# M0 物理机 Docker 组件部署方案（给物理机 Codex 执行）

日期：2026-02-14  
阶段：M0（基础组件就绪，不开始业务改造）

## 1. 目标

在物理机上部署并验证以下组件，供“应用代码运行在容器内”时连接使用：

1. PostgreSQL 18
2. Redis 7.x
3. MinIO

使用仓库内现成资产：

1. `docker-compose.test-stack.yml`
2. `.env.test-stack.example`
3. `scripts/test-stack.sh`
4. `docs/local-test-stack-setup.md`

## 2. M0 完成标准（Gate）

全部满足才算 M0 基础组件完成：

1. 三个容器健康状态正常（PostgreSQL/Redis/MinIO）
2. MinIO bucket 自动初始化成功
3. 从物理机本机可连接三组件
4. 从应用容器可连接三组件（通过 `host.docker.internal`）
5. 形成可复用操作命令（up/down/health/logs）

## 3. 物理机 Codex 执行步骤

## 3.1 准备代码与环境

```bash
cd /path/to/agentifui
cp .env.test-stack.example .env.test-stack
```

可选：先改 `.env.test-stack` 中默认密码/端口。

## 3.2 安装 Docker（若未安装）

仅 Ubuntu/Debian 示例（其他系统用等价安装方式）：

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
newgrp docker
docker --version
docker compose version
```

## 3.3 启动组件

```bash
bash scripts/test-stack.sh up
```

## 3.4 健康检查

```bash
bash scripts/test-stack.sh ps
bash scripts/test-stack.sh health
```

## 3.5 本机连通性检查

```bash
pg_isready -h 127.0.0.1 -p ${TEST_PG_PORT:-5432} -U ${TEST_PG_USER:-agentif} -d ${TEST_PG_DB:-agentifui}
redis-cli -h 127.0.0.1 -p ${TEST_REDIS_PORT:-6379} ping
curl -sSf http://127.0.0.1:${TEST_MINIO_API_PORT:-9000}/minio/health/live
```

## 3.6 应用容器访问宿主机（关键）

如果应用容器不是 host 网络，需要能解析 `host.docker.internal`。

运行应用容器时增加：

```bash
--add-host=host.docker.internal:host-gateway
```

应用容器内连接示例（供后续开发阶段使用）：

```env
DATABASE_URL=postgresql://agentif:agentif@host.docker.internal:5432/agentifui
REDIS_URL=redis://host.docker.internal:6379/0
S3_ENDPOINT=http://host.docker.internal:9000
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_BUCKET=agentifui
S3_ENABLE_PATH_STYLE=1
```

## 4. 常用运维命令

```bash
# 查看状态
bash scripts/test-stack.sh ps

# 查看日志
bash scripts/test-stack.sh logs

# 停止
bash scripts/test-stack.sh down

# 全量重置（删除卷）
bash scripts/test-stack.sh reset
```

## 5. 给当前开发容器的回传内容（让当前 Codex 继续）

物理机 Codex 完成后，回传以下信息即可进入下一步开发：

1. `bash scripts/test-stack.sh ps` 输出
2. `bash scripts/test-stack.sh health` 输出
3. 应用容器内 `DATABASE_URL/REDIS_URL/S3_ENDPOINT` 的实际值
4. 若端口有改动，提供最终端口映射

回传后即可开始 M0 代码开发（先做 RPC 缺失补齐 + admin 鉴权收敛）。

## 6. M0 RPC 一键回归（可选）

当 `database/migrations/20260214010100_add_missing_rpc_functions.sql` 合入后，可在开发容器中执行：

```bash
bash scripts/m0-rpc-verify.sh
```

或：

```bash
pnpm m0:rpc:verify
```

如数据库地址不同，可覆盖：

```bash
PGURL='postgresql://user:pass@host:5432/dbname' bash scripts/m0-rpc-verify.sh
```
