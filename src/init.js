import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readJson, writeJson } from "./store.js";

const execFileAsync = promisify(execFile);

const CODECHARTER_DIR = ".codecharter";
const CODEX_DIR = ".codex";
const SCRATCH_DIR = ".scratch/codecharter";
const DEFAULT_ACTIVITY_PATH = `${SCRATCH_DIR}/activity.jsonl`;
const DEFAULT_MAP_PATH = "codecharter.json";
const LEGACY_MAP_PATH = "codemap.json";
const MANAGED_START = "# >>> codecharter >>>";
const MANAGED_END = "# <<< codecharter <<<";
const MAP_HOOKS = ["post-checkout", "post-merge", "post-rewrite"];

export async function initializeCodecharter({
  root,
  mapPath,
  installCodex = true,
  installGitHooks = true,
  fresh = false,
  writeCodemap,
} = {}) {
  const resolvedMapPath = mapPath ?? join(root, DEFAULT_MAP_PATH);
  await mkdir(join(root, SCRATCH_DIR), { recursive: true });
  await ensureCodecharterConfig(root, resolvedMapPath);

  if (writeCodemap) await writeCodemap({ root, out: resolvedMapPath, fresh });
  await ensurePackageDevDependency(root);
  if (installCodex) await ensureCodexAdapter(root);
  if (installGitHooks) await ensureGitMapHooks(root, resolvedMapPath);

  return {
    mapPath: resolvedMapPath,
    configPath: join(root, CODECHARTER_DIR, "config.json"),
    codexAdapterInstalled: installCodex,
    gitHooksInstalled: installGitHooks,
  };
}

export async function ensurePackageDevDependency(root) {
  const packagePath = join(root, "package.json");
  const packageJson = await readJson(packagePath, null);
  if (!packageJson || packageJson.name === "codecharter") return { skipped: true };

  const version = await currentPackageVersion();
  const devDependencies = packageJson.devDependencies ?? {};
  if (devDependencies.codecharter) return { skipped: false, changed: false };

  await writeJson(packagePath, {
    ...packageJson,
    devDependencies: {
      ...devDependencies,
      codecharter: `^${version}`,
    },
  });
  return { skipped: false, changed: true };
}

export async function ensureCodecharterConfig(root, mapPath) {
  const configPath = join(root, CODECHARTER_DIR, "config.json");
  const existing = await readJson(configPath, {});
  await writeJson(configPath, {
    version: 1,
    mapPath: normalizeRelative(root, mapPath),
    activityPath: existing.activityPath ?? DEFAULT_ACTIVITY_PATH,
    legacyMapPaths: existing.legacyMapPaths ?? [LEGACY_MAP_PATH],
    agents: {
      ...(existing.agents ?? {}),
      codex: {
        enabled: true,
        activityPath: existing.agents?.codex?.activityPath ?? DEFAULT_ACTIVITY_PATH,
      },
    },
  });
  return configPath;
}

export async function ensureCodexAdapter(root) {
  const hooksDir = join(root, CODEX_DIR, "hooks");
  await mkdir(hooksDir, { recursive: true });
  const hookPath = join(hooksDir, "codecharter-codex-hook.mjs");
  const hooksJsonPath = join(root, CODEX_DIR, "hooks.json");
  await writeFile(hookPath, codexHookShim(), { mode: 0o755 });
  await chmod(hookPath, 0o755);
  await writeJson(hooksJsonPath, codexHooksJson());
  return { hookPath, hooksJsonPath };
}

export async function ensureGitMapHooks(root, mapPath) {
  const installed = [];
  for (const hookName of MAP_HOOKS) {
    const hookPath = await gitPath(root, `hooks/${hookName}`);
    if (!hookPath) return { skipped: true, hooks: installed };
    await installManagedHookBlock(hookPath, gitMapHookBlock(root, mapPath));
    installed.push(hookName);
  }
  return { skipped: false, hooks: installed };
}

async function installManagedHookBlock(hookPath, block) {
  let current = "";
  try {
    current = await readFile(hookPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const withoutManaged = current.replace(new RegExp(`\\n?${escapeRegExp(MANAGED_START)}[\\s\\S]*?${escapeRegExp(MANAGED_END)}\\n?`, "g"), "\n").trimEnd();
  const shebang = withoutManaged.startsWith("#!") ? "" : "#!/bin/sh\n";
  const separator = withoutManaged.length ? "\n\n" : "";
  await mkdir(dirname(hookPath), { recursive: true });
  await writeFile(hookPath, `${shebang}${withoutManaged}${separator}${block}\n`, { mode: 0o755 });
  await chmod(hookPath, 0o755);
}

function gitMapHookBlock(root, mapPath) {
  const mapRelative = normalizeRelative(root, mapPath);
  return `${MANAGED_START}
repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
map_path="$repo_root/${mapRelative}"
if [ -x "$repo_root/node_modules/.bin/codecharter" ]; then
  "$repo_root/node_modules/.bin/codecharter" generate --root "$repo_root" --out "$map_path" --quiet >/dev/null 2>&1 || true
elif command -v codecharter >/dev/null 2>&1; then
  codecharter generate --root "$repo_root" --out "$map_path" --quiet >/dev/null 2>&1 || true
else
  npx --yes codecharter generate --root "$repo_root" --out "$map_path" --quiet >/dev/null 2>&1 || true
fi
${MANAGED_END}`;
}

function codexHooksJson() {
  const command = 'node "$(git rev-parse --show-toplevel)/.codex/hooks/codecharter-codex-hook.mjs"';
  const handler = {
    type: "command",
    command,
    timeout: 10,
    statusMessage: "Recording CodeCharter activity",
  };

  return {
    hooks: {
      SessionStart: [
        {
          matcher: "startup|resume|clear",
          hooks: [handler],
        },
      ],
      PostToolUse: [
        {
          matcher: "Bash|apply_patch|Edit|Write",
          hooks: [handler],
        },
      ],
      Stop: [
        {
          hooks: [handler],
        },
      ],
    },
  };
}

function codexHookShim() {
  return `#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const input = readFileSync(0, "utf8");
const gitRoot = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
const root = gitRoot.status === 0 ? gitRoot.stdout.trim() : process.cwd();
const localBin = join(root, "node_modules", ".bin", process.platform === "win32" ? "codecharter.cmd" : "codecharter");
const candidates = existsSync(localBin)
  ? [{ command: localBin, args: ["codex-hook"] }, { command: "codecharter", args: ["codex-hook"] }, { command: "npx", args: ["--yes", "codecharter", "codex-hook"] }]
  : [{ command: "codecharter", args: ["codex-hook"] }, { command: "npx", args: ["--yes", "codecharter", "codex-hook"] }];

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
`;
}

async function gitPath(root, path) {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--git-path", path], { cwd: root });
    const resolvedPath = stdout.trim();
    return isAbsolute(resolvedPath) ? resolvedPath : join(root, resolvedPath);
  } catch {
    return null;
  }
}

function normalizeRelative(root, path) {
  return relative(root, path).replaceAll("\\", "/");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function currentPackageVersion() {
  const packagePath = fileURLToPath(new URL("../package.json", import.meta.url));
  const packageJson = await readJson(packagePath, { version: "0.1.0" });
  return packageJson.version ?? "0.1.0";
}

export async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
