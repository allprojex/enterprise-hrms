/**
 * Packaging regression for the api-server operator CLIs.
 *
 * `migrate:hr-roles` and `activate:wwm` are invoked in Production through the
 * package script (`pnpm --filter @workspace/api-server run <script>`), not with
 * `npx`. Both scripts shell out to `tsx`, but the package did not declare `tsx`
 * as a dependency. Under pnpm's strict isolation that resolved to nothing and
 * the governed release wrapper failed with:
 *
 *     sh: 1: tsx: not found
 *
 * It was masked in development because the scripts were run as
 * `npx tsx scripts/...`, which resolves tsx independently of the workspace.
 *
 * These assertions are deliberately fast and side-effect free: they check the
 * declaration and that tsx actually resolves FROM THIS PACKAGE. The end-to-end
 * environment check — `pnpm --filter @workspace/api-server exec tsx --version`
 * after a frozen-lockfile install — lives in CI, where the install layout is
 * the one Production uses. Spawning pnpm from inside the unit suite was tried
 * and rejected: it is slow, inherits the test environment, and starves
 * neighbouring tests under parallel workers.
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const pkgDir = path.resolve(__dirname, "..", ".."); // artifacts/api-server
const pkg = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8")) as {
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};

/** Scripts that shell out to tsx and therefore require it to be resolvable. */
const TSX_SCRIPTS = ["migrate:hr-roles", "activate:wwm"];

describe("api-server operator CLI packaging", () => {
  it("declares tsx as a dependency, using the workspace catalog", () => {
    expect(pkg.devDependencies?.tsx, "artifacts/api-server must declare tsx").toBeDefined();
    // Same convention lib/db already uses, so the version stays centrally pinned.
    expect(pkg.devDependencies?.tsx).toBe("catalog:");
  });

  it("every script that shells out to tsx is covered by that declaration", () => {
    const usingTsx = Object.entries(pkg.scripts ?? {})
      .filter(([, body]) => /(^|\s)tsx\s/.test(body))
      .map(([name]) => name);
    expect(usingTsx.length).toBeGreaterThan(0);
    for (const name of TSX_SCRIPTS) expect(usingTsx, `${name} should shell out to tsx`).toContain(name);
    expect(pkg.devDependencies?.tsx, "a tsx-based script exists but tsx is not declared").toBeDefined();
  });

  it("resolves tsx from this package, not from a parent or an ambient npx", () => {
    const requireFromPkg = createRequire(path.join(pkgDir, "package.json"));
    // Throws if tsx is not reachable from artifacts/api-server — the exact
    // condition that produced "sh: 1: tsx: not found" in Production.
    const resolved = requireFromPkg.resolve("tsx/package.json");
    expect(resolved).toBeTruthy();
    const tsxPkg = JSON.parse(readFileSync(resolved, "utf8")) as { name: string; version: string };
    expect(tsxPkg.name).toBe("tsx");
    expect(tsxPkg.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("links the tsx binary into this package's .bin, which is what the script invokes", () => {
    const bin = path.join(pkgDir, "node_modules", ".bin", "tsx");
    const present = existsSync(bin) || existsSync(`${bin}.CMD`) || existsSync(`${bin}.cmd`);
    expect(present, `${bin} is missing — the package scripts would fail with "tsx: not found"`).toBe(true);
  });
});
