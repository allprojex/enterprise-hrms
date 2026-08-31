# Storage Migration Runbook

**Scope:** moving the HRMS's own uploaded binaries between storage backends —
filesystem to S3-compatible, or a legacy filesystem root to the durable one.

**This is not the Enterprise Migration Centre.** That is a future *business*
capability for onboarding a client's HR data from spreadsheets, legacy systems
and scanned records. This runbook covers platform-operations work on binary
storage infrastructure. The two share no code and no terminology.

**Nothing here has been run against Production.** WS-17 Pass 2 built and proved
this machinery in isolation; executing it against live data is a separately
authorized operation.

---

## What the tooling guarantees

**copy → verify → switch → retain source.** Never move-then-hope.

- No code path in `lib/storageReconciliation` deletes a source binary. Source
  cleanup does not exist yet, deliberately.
- Authority lives in exactly one column, `stored_objects.backend`, and moves
  only after a destination read-back matches the registered SHA-256.
- Every intermediate state is recovered by re-running reconciliation, which
  recomputes from live storage rather than reading remembered progress. A crash
  cannot leave stale state because there is no persisted progress to go stale.

---

## 1. Preflight

1. **Take a database backup.** `stored_objects` is what records where every
   binary lives; losing it after a partial migration means re-deriving
   authority by hand.
2. **Confirm the destination is configured** — `STORAGE_BACKEND`,
   `STORAGE_S3_BUCKET`, `STORAGE_S3_ACCESS_KEY_ID`,
   `STORAGE_S3_SECRET_ACCESS_KEY`, and `STORAGE_S3_ENDPOINT` /
   `STORAGE_S3_FORCE_PATH_STYLE` for non-AWS providers.
3. **Confirm destination health.** Migration refuses to start against an
   unhealthy destination — copying into an unreachable bucket would produce
   "verified" objects nobody can read.
4. **Confirm source accessibility**, including the legacy root if this is a
   Pass 0 upgrade (below).
5. **Check capacity** at the destination against the reported
   `estimatedMigrationBytes`.
6. **Decide on quiescing** — see *Do writes need to stop?* below. For most
   classes the answer is no.

## 2. Dry run

Run reconciliation read-only, then migration with `dryRun: true`.

Read-only reconciliation writes nothing: no checksum metadata, no
`stored_objects` rows, no copies, no business-record changes. Use it to obtain,
per organization: total references, healthy, `historical_unregistered`,
`missing_binary`, orphan counts, objects eligible to migrate, objects already
migrated, blocked objects, estimated bytes, and destination readiness.

**Investigate every `missing_binary` before migrating anything.** An
authoritative missing binary means business or legal data is already gone; it
is a finding to escalate, not a number to move past.

## 3. Register historical objects

Files written before Pass 1 have no checksum, and **objects without a
registered digest are never migrated** — there would be nothing to verify a
copy against. Register them first.

Registration reads each binary, computes SHA-256, records size and backend, and
**leaves the source untouched and the business key unchanged**. It is
idempotent: running it twice registers nothing new.

## 4. Copy

Migration is scoped **per organization** and may be narrowed to one reference
source and a batch size. There is deliberately no platform-wide
"migrate everything" mode.

Per object: read source → confirm the source still matches its registered
digest → write destination → read the destination back → compare digests →
switch authority under a row lock.

## 5. Verification

After each run, re-run reconciliation. Expect eligible objects to report
`migration_verified`. Investigate any:

- `checksum_mismatch` — the source changed after registration, or is corrupt.
  **Never accept a mismatch because sizes agree.**
- `destination_conflict` — the destination already holds different content
  under that key. Authority is not switched.
- `skipped_unregistered` — register it, then re-run.

## 6. Authority switch

The switch is the single-row `stored_objects.backend` update, performed inside
the same transaction that locks the row. Two operators running concurrently
serialize per object; the loser reports `already_migrated` rather than
switching twice.

## 7. Post-migration validation

- Reconcile again and confirm zero `migration_pending` in scope.
- Download a sample of migrated documents through the normal application
  routes — not the storage layer — to confirm authorization still governs
  access.
- Confirm the organization logo still renders on the public login page.
- Confirm private documents remain inaccessible without permission.

## 8. Source retention

**Retain the source binaries.** This runbook deliberately does not name a
retention duration: it depends on the installation's backup regime, its
regulatory obligations and the operator's confidence, and inventing a number
here would give false authority to a guess. Decide it explicitly, record it,
and do not shorten it after the fact.

## 9. Rollback

Because the source is retained and the key is unchanged, rollback is the
authority switch in reverse: set `stored_objects.backend` back to the source
backend for the affected objects. No binary needs to move. This is why the copy
is never a move.

## 10. Cleanup

**Separately authorized. Not part of this tooling.**

Source deletion and orphan removal are the only irreversible operations in the
whole workflow, and an apparently-orphaned file may simply reflect a reference
source the registry does not yet know about. Nothing in Pass 2 deletes
anything.

---

## The Pass 0 legacy-path upgrade

A deployment predating WS-17 Pass 0 may hold files under `/app/uploads` (the
old ephemeral container default) while the durable backend now uses
`/var/lib/hrms/uploads`.

Those files are **not** moved automatically, and the tooling never assumes the
old path exists or goes looking for it. The operator names the legacy root
explicitly, as configuration — it is never tenant input, there is no filesystem
browsing API, and no Super Admin path explorer exists.

1. Quiesce writes if the legacy path is still being written to.
2. Reconcile with the legacy root supplied as the source. Files invisible to
   the current backend appear as `historical_unregistered` rather than
   `missing_binary`.
3. Register them against the legacy source.
4. Migrate from the legacy source to the durable target.
5. Confirm counts and digests.
6. **Retain the old path.** Remove it only after explicit operational sign-off.

---

## Do writes need to stop?

Mostly no, and the reason is worth understanding rather than defaulting to a
global maintenance window.

- **Immutable classes** — document versions, generated documents, evidence,
  résumés, bulk-import sources — never change under a stable key. A new upload
  is a new key. These migrate safely under live traffic.
- **Replaceable classes** — organization logos and profile pictures — *can*
  change under a stable business record. They are still safe, for two
  independent reasons: replacement produces a **new** key, so the old object
  stops being referenced and is simply not selected for migration; and
  migration re-confirms the source digest against the registered one, so an
  object whose bytes changed after registration is **blocked**, never copied
  over a newer one.

Object-level consistency is therefore sufficient, and no global maintenance
mode was invented. Quiesce only if writing to a legacy path being drained.

---

## What this does not cover

Backup and restore control planes, orphan cleanup, source deletion, deployment
history, and the Enterprise Migration Centre. **A storage backend existing does
not mean anything has moved to it**, and a migrated object is not a backed-up
object: persistence is not backup.
