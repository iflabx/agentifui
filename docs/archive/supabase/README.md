# Supabase Historical Archive

This directory stores historical analysis and baseline documents from the pre-migration phase.

These files are preserved for traceability and audit, but are **not** the runtime source of truth for the current stack.

Current runtime baseline:

- PostgreSQL 18 + Drizzle ORM
- Redis 7.x
- MinIO (S3-compatible)
- better-auth

Archived documents:

1. `docs/archive/supabase/supabase-data-interaction-deep-dive.md`
2. `docs/archive/supabase/supabase-docs.md`
3. `docs/archive/supabase/target-stack-deep-analysis.md`
4. `docs/archive/supabase/project-architecture-analysis.md`
5. `docs/archive/supabase/backend-compatibility-components-checklist.md`
6. `docs/archive/supabase/lobehub-methods-benchmark.md`

For active migration execution status, refer to:

- `docs/migration-task-blueprint.md`
- `docs/m9-decommission-closeout.md`
- `docs/QUICK-DEPLOYMENT.md`
