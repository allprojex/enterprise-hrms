// Enforces pnpm as the package manager and clears stray lockfiles left by
// npm/yarn. Replaces a previous `sh -c '...'` script that required a POSIX
// shell and could not run under plain Windows PowerShell/cmd.
import { rmSync } from "node:fs";

rmSync("package-lock.json", { force: true });
rmSync("yarn.lock", { force: true });

const userAgent = process.env.npm_config_user_agent ?? "";
if (!userAgent.startsWith("pnpm/")) {
  console.error("Use pnpm instead");
  process.exit(1);
}
