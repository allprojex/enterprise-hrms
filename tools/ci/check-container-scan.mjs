// WS-18 Pass 3 (F-3) — container vulnerability gate.
//
// Reads a Trivy JSON report (path as argv[2], or stdin) and enforces the
// approved WS-18 policy. Plain Node ESM, no dependencies — same convention as
// tools/ci/check-pnpm-audit.mjs and tools/ci/check-rls-coverage.mjs.
//
// ## The policy, and why it is this and not something simpler
//
// FAIL on any CRITICAL or HIGH finding **for which a fixed version exists**.
// Print everything else in full.
//
// "Fail on every CRITICAL/HIGH" sounds stricter and is actually worse. A Debian
// base image permanently carries a tail of CRITICAL/HIGH CVEs in packages that
// have no vendor fix — at the time this gate was written, `perl-base`, `zlib1g`,
// `util-linux`, `ncurses` and `gzip` accounted for every remaining CRITICAL and
// HIGH in this image, all with `FixedVersion` empty. A gate that fails on those
// is red on day one, stays red through every green build, and trains everyone
// to ignore it. That is how a real finding gets waved through.
//
// Keying on fixability makes the gate mean one specific, actionable thing:
// **something in this image can be patched and has not been.** That is always a
// real action item, and it is never noise.
//
// The unfixable tail is not dismissed — it is printed on every run, and §20
// requires a documented exploitability analysis for it (see docs/SECURITY.md
// §10). If one of those packages becomes reachable, that analysis is what has to
// change, not this threshold.
//
// This is deliberately NOT a blanket "ignore all HIGH": a HIGH with an available
// fix fails the build like a CRITICAL does.
//
// ## Suppressions
//
// There is no suppression list, on purpose. If one ever becomes necessary it
// must be per-CVE with a written justification and a review date (§25) — never
// a severity-wide or package-wide mute.
//
// Usage:
//   trivy image --format json --output trivy.json <image>
//   node tools/ci/check-container-scan.mjs trivy.json

import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("usage: node tools/ci/check-container-scan.mjs <trivy-report.json>");
  process.exit(2);
}

let report;
try {
  report = JSON.parse(readFileSync(path, "utf8"));
} catch (err) {
  console.error(`Could not read Trivy report at ${path}: ${err.message}`);
  process.exit(2);
}

const findings = [];
for (const result of report.Results ?? []) {
  for (const v of result.Vulnerabilities ?? []) {
    findings.push({
      severity: v.Severity,
      id: v.VulnerabilityID,
      pkg: v.PkgName,
      installed: v.InstalledVersion,
      fixed: v.FixedVersion ?? null,
      type: result.Type,
      path: v.PkgPath ?? result.Target ?? "",
    });
  }
}

const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };
for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;

const blocking = findings.filter(
  (f) => (f.severity === "CRITICAL" || f.severity === "HIGH") && f.fixed,
);
const unfixable = findings.filter(
  (f) => (f.severity === "CRITICAL" || f.severity === "HIGH") && !f.fixed,
);

console.log(`Container scan — ${report.ArtifactName ?? "(unknown artifact)"}`);
console.log(
  `  CRITICAL ${counts.CRITICAL}  HIGH ${counts.HIGH}  MEDIUM ${counts.MEDIUM}  ` +
    `LOW ${counts.LOW}  UNKNOWN ${counts.UNKNOWN}  (total ${findings.length})`,
);

if (unfixable.length > 0) {
  console.log(
    `\nNon-blocking: ${unfixable.length} CRITICAL/HIGH finding(s) with no vendor fix available.\n` +
      `These are base-image packages; see docs/SECURITY.md §10 for the standing\n` +
      `exploitability analysis. They are printed on every run, never suppressed:`,
  );
  for (const f of unfixable.sort((a, b) => a.severity.localeCompare(b.severity) || a.pkg.localeCompare(b.pkg))) {
    console.log(`  - [${f.severity}] ${f.id} ${f.pkg}@${f.installed} (${f.type}, no fix)`);
  }
}

if (blocking.length > 0) {
  console.error(
    `\n::error::Container scan FAILED — ${blocking.length} CRITICAL/HIGH finding(s) HAVE a fix available:\n`,
  );
  for (const f of blocking.sort((a, b) => a.severity.localeCompare(b.severity) || a.pkg.localeCompare(b.pkg))) {
    console.error(`  - [${f.severity}] ${f.id} ${f.pkg}@${f.installed} -> fixed in ${f.fixed}`);
    if (f.path) console.error(`      ${f.path}`);
  }
  console.error(
    `\nEach of these is patchable. Update the dependency, the base image pin, or the\n` +
      `apt upgrade layer in the Dockerfile, then re-scan.`,
  );
  process.exit(1);
}

console.log("\nPASSING: no CRITICAL or HIGH finding has an available fix.");
