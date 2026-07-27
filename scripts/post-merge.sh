#!/bin/bash
set -e
pnpm install --frozen-lockfile
# Schema changes are no longer applied automatically on merge. Run
# `pnpm --filter @workspace/db run generate` then review and manually run
# `pnpm --filter @workspace/db run migrate` against the target database.
