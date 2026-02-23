# Agent Rules

## Internal-Only Migration Scripts

1. Put stage-specific, temporary, and migration-only scripts in `local_scripts/`.
2. Do not expose `local_scripts/*` via public `package.json` commands.
3. Do not reference `local_scripts/*` from public CI workflows under `.github/workflows/`.
4. Do not document `local_scripts/*` in public docs under `docs/`; keep those notes in `local_docs/`.
5. Keep `scripts/` for project runtime/deploy and public contributor workflows only.
