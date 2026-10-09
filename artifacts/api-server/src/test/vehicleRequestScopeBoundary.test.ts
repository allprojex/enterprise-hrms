/**
 * VR-02B — scope boundary, pinned in the source.
 *
 * VR-02B submits and reads. Deciding, reserving, overlap checking, cancelling
 * and vehicle release/return belong to VR-02C and VR-03, and they must arrive
 * as deliberate changes there — not creep in here. These checks read the
 * committed source so a later edit that crosses the line fails loudly.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");
/** Source with line and block comments stripped, so prose about VR-02C cannot trip a check. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const SUBMISSION = code(read("lib/vehicleRequestSubmission.ts"));
const ROUTES = code(read("routes/vehicleRequests.ts"));

function allSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "test" ? [] : allSourceFiles(full);
    return full.endsWith(".ts") ? [full] : [];
  });
}

describe("VR-02B does not implement VR-02C", () => {
  it("takes no advisory lock and runs no overlap/time-window query", () => {
    for (const src of [SUBMISSION, ROUTES]) {
      expect(src).not.toMatch(/pg_advisory|advisory/i);
      expect(src).not.toMatch(/tstzrange|overlap/i);
      expect(src).not.toMatch(/plannedTimeIn\s*,\s*[^)]*\blt\(|\bgt\(\s*vehicleRequestsTable\.plannedTimeIn/);
    }
  });

  it("writes no approval decision", () => {
    expect(SUBMISSION).not.toMatch(/vehicleRequestApprovalsTable/);
    expect(SUBMISSION).not.toMatch(/resolveApprovalAuthority|resolveStageAuthority/);
  });

  it("only ever inserts a pending request — never updates one", () => {
    expect(SUBMISSION).not.toMatch(/\.update\(\s*vehicleRequestsTable/);
    expect(SUBMISSION).not.toMatch(/\.delete\(\s*vehicleRequestsTable/);
    expect(SUBMISSION).toMatch(/status:\s*"pending"/);
    expect(SUBMISSION).not.toMatch(/status:\s*"(approved|rejected|cancelled)"/);
    expect(SUBMISSION).not.toMatch(/cancellationKind|cancelledAt|decidedAt|rejectionReason/);
  });

  it("never changes a vehicle", () => {
    expect(SUBMISSION).not.toMatch(/\.update\(\s*vehiclesTable/);
  });

  it("is the only non-test module that inserts a vehicle request", () => {
    const writers = allSourceFiles(SRC).filter((f) => /\.insert\(\s*vehicleRequestsTable\b/.test(code(readFileSync(f, "utf8"))));
    expect(writers.map((f) => f.replace(/\\/g, "/").split("/src/")[1])).toEqual(["lib/vehicleRequestSubmission.ts"]);
  });

  it("no module writes vehicle_request_approvals yet", () => {
    const writers = allSourceFiles(SRC).filter((f) => /\.insert\(\s*vehicleRequestApprovalsTable\b/.test(code(readFileSync(f, "utf8"))));
    expect(writers).toEqual([]);
  });
});

describe("VR-02B does not implement VR-03", () => {
  it("has no actual driver, actual times, released/received-by or return remarks", () => {
    for (const src of [SUBMISSION, ROUTES]) {
      expect(src).not.toMatch(/actualDriver|actualTimeOut|actualTimeIn|releasedBy|receivedBy|returnRemarks/i);
    }
  });
});
