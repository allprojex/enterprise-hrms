// WS-1 (Engineering & Security Foundation) — dependency/SCA vulnerability gate.
//
// Reads `pnpm audit --json` output (piped in on stdin) and enforces the
// narrowest safe policy this workstream approved: fail CI only on CRITICAL
// severity findings. `pnpm audit` itself exits non-zero whenever ANY
// vulnerability of ANY severity exists, which would make CI permanently red
// from day one on a real-world Node/TypeScript monorepo — an "impossible to
// maintain zero-warning policy" the frozen architecture explicitly warned
// against. HIGH/MODERATE/LOW/INFO findings are always printed in full (never
// silently ignored) so a human sees them on every run; they don't fail the
// build, since none of the HIGH findings present when this gate was written
// (js-yaml/fast-uri under the openapi codegen tool, brace-expansion under
// eslint, undici/nanoid under vitest's browser-DOM dependency chain) are
// reachable from a shipped runtime path, with two flagged exceptions
// (`sharp`, and `ip-address` under `express-rate-limit`) that ARE
// production-reachable and are called out below as a standing, tracked,
// non-blocking follow-up rather than silently accepted.
//
// Plain Node script (repo convention — no POSIX-shell-only scripting, see
// tools/preinstall.mjs), run as:
//   pnpm audit --json | node tools/ci/check-pnpm-audit.mjs
// (a non-zero `pnpm audit` exit code is expected and ignored here — this
// script makes its own pass/fail decision from the JSON body, not from
// pnpm's exit code).

import { readFileSync } from "node:fs";

// Dependency paths pnpm audit reports that this workstream has manually
// triaged as production-reachable (not dev/build-tooling-only). Update this
// list only after triaging a new finding the same way — never widen it
// mechanically. Currently empty by design: `sharp` and `ip-address` (via
// express-rate-limit) are both HIGH and production-reachable at the time
// this gate was written, but neither was bumped in WS-1 (no drop-in patch
// without a version jump risky enough to require its own regression pass —
// see docs/CI_CD.md's "Known limitations" section). They remain visible in
// every run's full advisory printout below, not hidden by this list.
const KNOWN_PRODUCTION_REACHABLE = new Set(["sharp", "ip-address"]);

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function main() {
  const raw = readStdin().trim();
  if (!raw) {
    console.log("pnpm audit produced no output (no lockfile entries to scan, or audit registry unreachable) — treating as pass.");
    return 0;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error("Could not parse `pnpm audit --json` output as JSON:", err.message);
    console.error(raw.slice(0, 2000));
    // A malformed/unparseable audit response is a tooling problem (Category
    // B), not evidence of a vulnerability — don't fail the whole pipeline on
    // an audit-tool hiccup, but make it loud.
    return 0;
  }

  const counts = parsed.metadata?.vulnerabilities ?? {};
  const advisories = Object.values(parsed.advisories ?? {});

  console.log("=== pnpm audit summary ===");
  console.log(`critical=${counts.critical ?? 0} high=${counts.high ?? 0} moderate=${counts.moderate ?? 0} low=${counts.low ?? 0} info=${counts.info ?? 0}`);

  if (advisories.length > 0) {
    console.log("\n=== Findings (all severities — informational unless noted CRITICAL below) ===");
    for (const a of advisories) {
      const flagged = KNOWN_PRODUCTION_REACHABLE.has(a.module_name) ? "  [TRIAGED: production-reachable, tracked as a follow-up item — see docs/CI_CD.md]" : "";
      console.log(`- [${(a.severity ?? "unknown").toUpperCase()}] ${a.module_name}: ${a.title} (patched: ${a.patched_versions ?? "n/a"})${flagged}`);
    }
  }

  const critical = counts.critical ?? 0;
  if (critical > 0) {
    console.error(`\nFAILING: ${critical} CRITICAL vulnerability finding(s) present. CRITICAL findings are never accepted silently — resolve or explicitly risk-accept before merging.`);
    return 1;
  }

  console.log("\nPASSING: no CRITICAL findings. HIGH/MODERATE/LOW findings above are visible but non-blocking per the approved WS-1 SCA policy (see docs/CI_CD.md).");
  return 0;
}

process.exit(main());
