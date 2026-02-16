# M9 退场与收口执行记录

版本：v1  
日期：2026-02-16  
状态：进行中

## 1. 目标

M9 目标是完成迁移后的退场与收口：

1. 清理 Supabase 运行时依赖与环境变量回退。
2. 收敛活跃迁移资产路径与脚本入口。
3. 固化迁移后运行基线与验收记录。

## 2. 已完成

1. 移除运行时 Supabase SDK 依赖：
   - 删除依赖：`@supabase/ssr`、`@supabase/supabase-js`
   - 删除兼容残留：`lib/supabase/client.ts`、`lib/supabase/server.ts`、`lib/supabase/hooks.ts`、`lib/supabase/types.ts`
2. 清理 Supabase 环境变量回退：
   - `scripts/m7-shared.mjs` 仅接受 `M7_SOURCE_DATABASE_URL`
   - `scripts/m7-gate-verify.sh` 移除 `SUPABASE_DATABASE_URL` 回退
3. 清理会话列表命名残留：
   - `supabase_pk` -> `db_pk`
4. 活跃迁移文件重定位：
   - `supabase/migrations/202602*.sql` -> `database/migrations/202602*.sql`
   - 同步更新 M0/M1/M4/M6/M7 脚本、CI 与相关文档路径引用
5. 历史文档归档完成：
   - 归档目录：`docs/archive/supabase/`
   - 归档索引：`docs/archive/supabase/README.md`
6. 运维手册补齐：
   - 新增 `docs/operations-backup-restore-emergency.md`
   - 覆盖 PostgreSQL / Redis / MinIO 的备份、恢复与应急流程

## 3. 验证结果

1. `pnpm -s type-check` 通过
2. 迁移脚本语法检查通过：
   - `bash -n scripts/m0-rpc-verify.sh scripts/m1-schema-verify.sh scripts/m7-ci-runtime-verify.sh`
   - `node --check scripts/m4-rpc-rls-verify.mjs scripts/m4-table-rls-verify.mjs scripts/m6-realtime-e2e-verify.mjs scripts/m6-realtime-slo-verify.mjs`
3. 非文档代码已无以下残留：
   - `@supabase/*`
   - `lib/supabase/*`
   - `NEXT_PUBLIC_SUPABASE_*`
   - `SUPABASE_DATABASE_URL`

## 4. 待完成

1. 执行并留档至少 1 次 PostgreSQL 恢复演练（记录 RTO/RPO）。
2. 执行并留档至少 1 次 MinIO 对象恢复演练（记录恢复校验结果）。
3. 完成 M9 最终门禁评审并将状态由“进行中”改为“完成”。
