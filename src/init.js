import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readJson, writeJson } from "./store.js";

const execFileAsync = promisify(execFile);

const CODECHARTER_DIR = ".codecharter";
const CODEX_DIR = ".codex";
const AGENTS_SKILLS_DIR = ".agents/skills";
const CODECHARTER_SKILL_DIR = `${AGENTS_SKILLS_DIR}/codecharter`;
const DEFAULT_ACTIVITY_PATH = `${CODECHARTER_DIR}/activity.jsonl`;
const DEFAULT_MAP_PATH = `${CODECHARTER_DIR}/codecharter.json`;
const ROOT_MAP_PATH = "codecharter.json";
const LEGACY_MAP_PATH = "codemap.json";
const MANAGED_START = "# >>> codecharter >>>";
const MANAGED_END = "# <<< codecharter <<<";
const MAP_HOOKS = ["post-checkout", "post-merge", "post-rewrite"];
const CODECHARTER_HOOK_COMMAND = 'node "$(git rev-parse --show-toplevel)/.codex/hooks/codecharter-codex-hook.mjs"';

export async function initializeCodecharter({
  root,
  mapPath,
  installCodex = true,
  installGitHooks = true,
  fresh = false,
  writeCodemap,
} = {}) {
  const resolvedMapPath = mapPath ?? join(root, DEFAULT_MAP_PATH);
  await mkdir(join(root, CODECHARTER_DIR), { recursive: true });
  await ensureCodecharterConfig(root, resolvedMapPath);

  const codemap = writeCodemap ? await writeCodemap({ root, out: resolvedMapPath, fresh }) : undefined;
  await ensurePackageDevDependency(root);
  if (installCodex) {
    await ensureCodecharterSkill(root);
    await ensureCodexAdapter(root);
  }
  if (installGitHooks) await ensureGitMapHooks(root, resolvedMapPath);

  return {
    mapPath: resolvedMapPath,
    configPath: join(root, CODECHARTER_DIR, "config.json"),
    codexAdapterInstalled: installCodex,
    codexSkillPath: installCodex ? join(root, CODECHARTER_SKILL_DIR, "SKILL.md") : undefined,
    gitHooksInstalled: installGitHooks,
    codemap,
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
    legacyMapPaths: existing.legacyMapPaths ?? [ROOT_MAP_PATH, LEGACY_MAP_PATH],
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
  await writeJson(hooksJsonPath, mergeCodexHooks(await readJson(hooksJsonPath, {}), codexHooksJson()));
  return { hookPath, hooksJsonPath };
}

export async function ensureCodecharterSkill(root) {
  const skillDir = join(root, CODECHARTER_SKILL_DIR);
  const skillPath = join(skillDir, "SKILL.md");
  await mkdir(skillDir, { recursive: true });
  await writeFile(skillPath, codecharterSkillMarkdown());
  return { skillPath };
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
  const handler = {
    type: "command",
    command: CODECHARTER_HOOK_COMMAND,
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

export function mergeCodexHooks(existing, desired) {
  const next = {
    ...objectOrEmpty(existing),
    hooks: { ...objectOrEmpty(existing?.hooks) },
  };

  for (const [eventName, groups] of Object.entries(next.hooks)) {
    next.hooks[eventName] = Array.isArray(groups)
      ? groups.map(withoutCodecharterHandlers)
      : groups;
  }

  for (const [eventName, desiredGroups] of Object.entries(desired.hooks)) {
    const existingGroups = Array.isArray(next.hooks[eventName]) ? next.hooks[eventName] : [];
    next.hooks[eventName] = mergeHookGroups(existingGroups, desiredGroups);
  }

  return next;
}

function mergeHookGroups(existingGroups, desiredGroups) {
  const groups = existingGroups.map((group) => ({
    ...group,
    hooks: Array.isArray(group.hooks) ? [...group.hooks] : [],
  }));

  for (const desiredGroup of desiredGroups) {
    const index = groups.findIndex((group) => (group.matcher ?? "") === (desiredGroup.matcher ?? ""));
    if (index === -1) {
      groups.push({
        ...desiredGroup,
        hooks: [...desiredGroup.hooks],
      });
      continue;
    }

    const group = groups[index];
    for (const hook of desiredGroup.hooks) {
      if (!group.hooks.some((existingHook) => sameHook(existingHook, hook))) group.hooks.push(hook);
    }
  }

  return groups;
}

function withoutCodecharterHandlers(group) {
  const hooks = Array.isArray(group.hooks) ? group.hooks.filter((hook) => !isCodecharterHook(hook)) : [];
  return { ...group, hooks };
}

function isCodecharterHook(hook) {
  return hook?.type === "command" && hook.command === CODECHARTER_HOOK_COMMAND;
}

function sameHook(left, right) {
  return left?.type === right?.type && left?.command === right?.command;
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
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

function codecharterSkillMarkdown() {
  return `---
name: codecharter
description: Use when a prompt contains a CodeCharter annotation, codecharter:// link, CodeCharter URL, browser annotation route, corner geohashes, or asks Codex to inspect a mapped code area.
---

# CodeCharter

Use this skill when the user gives you a CodeCharter annotation or asks you to inspect an area from the CodeCharter map.

## Annotation Prompts

CodeCharter annotation prompts may include:

- a \`codecharter://annotation/<id>\` deep link
- a browser route like \`#/annotation/<id>\`
- a local CodeCharter URL like \`http://127.0.0.1:<port>/#/annotation/<id>\`
- a spatial frame with four corner geohashes
- a user note describing what to investigate

## Workflow

1. If a CodeCharter URL is present, use it as the source of truth. The annotation JSON is available at \`<origin>/api/annotations/<id>\`.
2. If the server is not running, read \`.codecharter/named-places.json\` and find the annotation by id.
3. Use the annotation's \`resolvedTargets\` as the authoritative target list.
4. Read only the files or ranges needed to answer the user note.
5. Treat \`Corner geohashes\` as the selected rectangle's spatial frame. They are not a file list and should not be expanded into a broad repo scan.
6. If a resolved target is too broad, start with names, bounds, and nearby target metadata before opening source files.

## Fallbacks

- If no annotation JSON is available, use \`.codecharter/codecharter.json\` to resolve geohash-backed map addresses.
- If both map and annotation storage are unavailable, ask the user to start CodeCharter with \`codecharter dev\` or paste the annotation JSON.
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
