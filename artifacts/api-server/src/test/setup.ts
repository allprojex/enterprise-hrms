// @workspace/db throws at import time if DATABASE_URL is unset (see
// lib/db/src/index.ts). No test in this suite opens a real connection —
// pg's Pool only connects lazily on first query — so a placeholder value
// is enough to satisfy that guard. Tests that need query results mock
// @workspace/db directly (see organizations.test.ts).
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
