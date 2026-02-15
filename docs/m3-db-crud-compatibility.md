# M3 DB CRUD 兼容层落地记录

日期：2026-02-15  
分支：`migration/m0-m1-pg-baseline`

## 1. 本阶段完成项

1. 引入 Drizzle ORM（`drizzle-orm`），建立核心表 managed repository。
2. 新增 Repo 实现：`lib/server/db/repositories/managed-crud.ts`，覆盖以下 5 张高频表：
   - `profiles`
   - `conversations`
   - `messages`
   - `providers`
   - `service_instances`
3. `DataService` 已改为优先走 managed repo（Drizzle）：
   - `findOne`
   - `findMany`
   - `create`
   - `update`
   - `delete`
   - `count`
4. 非 managed 表保持现有 SQL fallback 路径，保证渐进迁移和兼容性。

## 2. 验证脚本与 Gate

新增命令：

- `pnpm m3:crud:verify`  
  执行 `__tests__/db/m3-managed-crud-repository.test.ts`，对 5 张核心表执行真实 CRUD 验证。
- `pnpm m3:gate:verify`  
  聚合执行 `m3:crud:verify + m3:oauth:mock:verify`。

## 3. 兼容性说明

1. 现有 `Result` 错误语义保持不变，前端调用面无需改动。
2. 缓存清理逻辑保持原行为：写操作后按 `table:*` 清理。
3. 事务接口 `runInTransaction`、`rawQuery`、`rawExecute` 暂继续走 PG 原生路径（为 M4 RPC/RLS 迁移预留）。

## 4. 当前边界（进入 M4 前的已知项）

1. 仅核心高频 CRUD 已切至 Drizzle，其他表尚未统一切换。
2. 权限/RLS 语义对齐属于 M4 范畴，本阶段不处理 GUC/RLS 完整迁移。
3. Realtime 与 Storage 迁移分别在 M6 / M5 阶段处理。
