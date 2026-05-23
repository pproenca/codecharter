#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const input = readFileSync(0, "utf8");
const gitRoot = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
const root = gitRoot.status === 0 ? gitRoot.stdout.trim() : process.cwd();
const localBin = join(root, "node_modules", ".bin", process.platform === "win32" ? "codecharter.cmd" : "codecharter");
const localTsx = join(root, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
const localCli = join(root, "core", "bin", "codemap.mts");
const localSourceCli = existsSync(localTsx) && existsSync(localCli)
  ? [{ command: localTsx, args: [localCli, "codex-hook"] }]
  : [];
const candidates = existsSync(localBin)
  ? [{ command: localBin, args: ["codex-hook"] }, ...localSourceCli, { command: "codecharter", args: ["codex-hook"] }, { command: "npx", args: ["--yes", "codecharter@0.2.0", "codex-hook"] }]
  : [...localSourceCli, { command: "codecharter", args: ["codex-hook"] }, { command: "npx", args: ["--yes", "codecharter@0.2.0", "codex-hook"] }];

for (const candidate of candidates) {
  const result = spawnSync(candidate.command, candidate.args, {
    cwd: root,
    input,
    encoding: "utf8",
    stdio: ["pipe", "ignore", "ignore"],
  });
  if (result.status === 0) process.exit(0);
  if (result.error?.code !== "ENOENT") process.exit(0);
}
process.exit(0);
