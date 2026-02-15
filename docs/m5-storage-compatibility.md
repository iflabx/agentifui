# M5 Storage 兼容迁移（MinIO）

## 1. 目标与范围

M5 目标：在不改动前端业务语义的前提下，用 MinIO 替换 Supabase Storage，并完成头像/内容图的上传、下载、删除、权限控制与验证闭环。

当前范围：

1. `avatars`
2. `content-images`

## 2. 已实现能力

### 2.1 预签名上传与下载

- 头像上传预签名：`POST /api/internal/storage/avatar/presign`
- 头像下载预签名：`GET /api/internal/storage/avatar/presign?path=...&userId=...`
- 内容图上传预签名：`POST /api/internal/storage/content-images/presign`
- 内容图下载预签名：`GET /api/internal/storage/content-images/presign?path=...&userId=...`
- 内容图上传 commit：`POST /api/internal/storage/content-images`（`application/json`，`{ userId, path }`）

### 2.2 兼容回退链路

- 头像仍保留 legacy 中转上传：`POST /api/internal/storage/avatar` (`formData`)
- 内容图仍保留 legacy 中转上传：`POST /api/internal/storage/content-images` (`formData`)

### 2.3 统一对象策略

- 策略定义：`lib/server/storage/object-policy.ts`
- 统一校验：
  1. MIME 白名单
  2. 最大体积限制（头像 5MB，内容图 10MB）
  3. 用户路径所有权（`user-{userId}/...`）

### 2.4 元数据与存在性校验

- 头像 commit 前通过 `HeadObject` 做对象存在性与元数据校验
- 内容图 commit 前通过 `HeadObject` 做对象存在性与元数据校验
- 下载预签名发放前同样进行 `HeadObject` 校验
- 头像 commit 失败时执行 best-effort 对象回收，避免悬挂文件

## 3. 鉴权与安全边界

### 3.1 路由内鉴权

所有 storage 路由通过 `resolveSessionIdentity` 解析会话，且要求：

1. 已登录
2. 账户状态必须为 `active`
3. 目标用户权限满足：本人或管理员

### 3.2 路径所有权约束

- 删除、下载、头像 commit 均校验 `assertOwnedObjectPath`
- 阻断跨用户路径伪造访问

### 3.3 中间件优化

- `middleware.ts` 对 `/api/internal/storage/*` 路径不再做额外 profile-status 远程校验
- storage 路由内已落地 `active` 状态检查，避免安全回退
- 目的：降低预签名接口额外开销，满足 SLO 验证需求

### 3.4 读模型与限流

- 增加 `S3_PUBLIC_READ_ENABLED`：
  1. `1`：对象公开读取，下载预签名作为兼容接口
  2. `0`：对象私有读取，下载预签名按用户路径校验
- MinIO `minio-init` 同步按该模式配置匿名下载策略
- `avatar/content-images` 预签名路由增加 Redis 固定窗口限流（默认每用户每分钟 300 次，可通过环境变量调整）

## 4. 客户端兼容层

### 4.1 Avatar

- Hook：`lib/hooks/use-avatar-upload.ts`
- 策略：
  1. 优先预签名直传（POST presign -> PUT 对象 -> POST commit）
  2. 失败自动回退 legacy 中转上传

### 4.2 Content Images

- Service：`lib/services/content-image-upload-service.ts`
- 策略：
  1. 优先预签名直传（POST presign -> PUT 对象 -> POST commit）
  2. 失败自动回退 legacy 中转上传

### 4.3 Backend Client

`lib/backend-client/client.ts` 新增：

1. `presignAvatarUpload`
2. `commitAvatarUpload`
3. `presignAvatarDownload`
4. `presignContentImageUpload`
5. `presignContentImageDownload`
6. `commitContentImageUpload`

## 5. 验证脚本与 Gate

### 5.1 功能冒烟

- `pnpm m5:storage:verify`
- 覆盖：
  1. 头像上传/commit/下载/删除
  2. 内容图上传/下载/列表/删除
  3. 跨用户越权拒绝
  4. legacy 回退链路

### 5.2 存储 SLO 验证

- `pnpm m5:storage:slo:verify`
- 指标：
  1. 预签名接口 `p95 <= 150ms`
  2. 上传成功率 `>= 99.9%`

### 5.3 M5 Gate 总入口

- `pnpm m5:gate:verify`
- 执行顺序：
  1. `m4:runtime-role:setup`
  2. `m4:gate:verify`
  3. `m5:storage:verify`
  4. `m5:storage:slo:verify`

## 6. 已知限制

1. 目前仅做“对象级”权限与路径约束，不包含对象级加密。
2. 内容图/头像的持久 URL 仍为稳定对象 URL（与现有前端行为兼容）。
3. 若后续要全量私有化读取，建议新增“按 path 动态换发下载 URL 的展示层”以避免前端持久化 URL 失效。

## 7. 验收记录（2026-02-15）

本次在本地测试栈（PostgreSQL + Redis + MinIO）完成 M5 收尾验收，结果如下：

1. `pnpm -s m5:storage:verify`：通过
2. `pnpm -s m5:storage:slo:verify`：通过
3. `pnpm -s m5:gate:verify`：通过

关键指标（来自 `m5:storage:slo:verify` 输出）：

1. `presignP95Ms=37.86`（阈值：`<=150ms`）
2. `uploadSuccessRate=1`（阈值：`>=0.999`）
3. `presignFailures=0`

## 8. 验证脚本稳定性增强（收尾补丁）

为降低门禁执行中的偶发启动不稳定，验证脚本增加了以下保护：

1. 应用启动重试（`M5_STORAGE_APP_START_RETRIES`、`M5_STORAGE_SLO_APP_START_RETRIES`）
2. 启动等待阶段的“进程早退出”检测（避免盲等超时）
3. 子进程优雅回收（`SIGTERM` -> `SIGKILL`）
4. 启动失败时输出 stderr tail 以便快速定位
5. 默认关闭 telemetry 并限制 SWC worker（降低进程压力）
