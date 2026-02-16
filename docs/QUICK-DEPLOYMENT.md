# AgentifUI Quick Deployment Guide

## Overview

This guide deploys AgentifUI with the current backend baseline:

- PostgreSQL 18
- Redis 7.x
- MinIO (S3 compatible)
- better-auth
- Dify (optional, if your app depends on it)

Supabase CLI is no longer required for runtime deployment.

## 1. Host Prerequisites

Install the base toolchain:

```bash
sudo apt-get update && sudo apt-get upgrade -y
sudo apt-get install -y curl git jq ca-certificates gnupg lsb-release
```

Install Node.js (NVM), pnpm, PM2:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install --lts
nvm use --lts
npm install -g pnpm pm2
```

Install Docker:

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
sudo usermod -aG docker $USER
newgrp docker
```

## 2. Start Core Data Services

You can use your own managed services, or run local containers.

```bash
# PostgreSQL 18
docker run -d --name agentifui-postgres \
  -e POSTGRES_USER=agentif \
  -e POSTGRES_PASSWORD=agentif \
  -e POSTGRES_DB=agentifui \
  -p 5432:5432 postgres:18-alpine

# Redis 7
docker run -d --name agentifui-redis \
  -p 6379:6379 redis:7-alpine

# MinIO
docker run -d --name agentifui-minio \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  -p 9000:9000 -p 9001:9001 \
  bitnami/minio:latest
```

Create the bucket (once):

```bash
docker run --rm --network host \
  -e MC_HOST_local=http://minioadmin:minioadmin@127.0.0.1:9000 \
  minio/mc mb --ignore-existing local/agentifui
```

## 3. Deploy AgentifUI

```bash
git clone https://github.com/ifLabX/AgentifUI.git
cd AgentifUI
pnpm install
```

Create `.env.local` with current stack settings:

```env
NODE_ENV=production
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000

DATABASE_URL=postgresql://agentif:agentif@127.0.0.1:5432/agentifui
MIGRATOR_DATABASE_URL=postgresql://agentif:agentif@127.0.0.1:5432/agentifui

REDIS_URL=redis://127.0.0.1:6379/0

S3_ENDPOINT=http://127.0.0.1:9000
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_BUCKET=agentifui
S3_ENABLE_PATH_STYLE=1

BETTER_AUTH_SECRET=replace_with_32_plus_random_chars
```

Build and start:

```bash
pnpm build
pm2 start ecosystem.config.js --only AgentifUI --update-env
pm2 save
```

## 4. Health Checks

```bash
# App
curl -I http://127.0.0.1:3000

# PostgreSQL
pg_isready -h 127.0.0.1 -p 5432 -U agentif -d agentifui

# Redis
redis-cli -h 127.0.0.1 -p 6379 ping

# MinIO
curl -f http://127.0.0.1:9000/minio/health/live
```

## 5. Optional: Test Stack from Repository Scripts

If you are validating migration gates, you can use repository test-stack scripts:

```bash
pnpm stack:test:up
pnpm stack:test:health
```

## 6. Troubleshooting

1. `BETTER_AUTH_SECRET` warning:
   - Generate a strong secret: `openssl rand -base64 48`
2. MinIO upload fails:
   - Check `S3_ENDPOINT` and `S3_ENABLE_PATH_STYLE=1`
3. DB migration scripts fail:
   - Ensure your migration path uses `database/migrations/202602*.sql`
4. Port conflicts:
   - Change host ports and keep env values aligned

## 7. Next Steps

1. Run M5/M6/M8 gate checks after deployment.
2. Configure external IdP (OIDC/CAS bridge) for production SSO.
3. Add backup/restore and alerting as part of M9 final closeout.
