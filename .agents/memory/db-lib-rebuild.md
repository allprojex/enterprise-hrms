---
name: DB lib rebuild rule
description: Must rebuild lib declarations after adding new schema files before leaf artifact typechecks
---

**Rule:** After adding new files to `lib/db/src/schema/` and re-exporting from `lib/db/src/schema/index.ts`, always run `pnpm run typecheck:libs` before running `pnpm --filter @workspace/<artifact> run typecheck`.

**Why:** `lib/db` is a composite lib — leaf artifacts import from its emitted declarations, not source. If declarations are stale, `@workspace/db` exports the old surface and any new table/type imports in api-server routes show TS2305 "has no exported member" errors.

**How to apply:** The sequence is: edit schema → run `pnpm run typecheck:libs` → then typecheck leaf artifact. Codegen already runs `typecheck:libs` internally so no extra step is needed after codegen.
