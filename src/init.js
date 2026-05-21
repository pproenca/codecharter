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
  const desiredSpec = `^${version}`;
  const dependencySections = ["devDependencies", "dependencies", "optionalDependencies", "peerDependencies"];
  const existingSection = dependencySections.find((section) => packageJson[section]?.codecharter);

  if (existingSection) {
    if (packageJson[existingSection].codecharter === desiredSpec) return { skipped: false, changed: false };
    await writeJson(packagePath, {
      ...packageJson,
      [existingSection]: {
        ...packageJson[existingSection],
        codecharter: desiredSpec,
      },
    });
    return { skipped: false, changed: true };
  }

  await writeJson(packagePath, {
    ...packageJson,
    devDependencies: {
      ...(packageJson.devDependencies ?? {}),
      codecharter: desiredSpec,
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
  const agentsDir = join(skillDir, "agents");
  const openaiYamlPath = join(agentsDir, "openai.yaml");
  const version = await currentPackageVersion();
  await mkdir(skillDir, { recursive: true });
  await mkdir(agentsDir, { recursive: true });
  await writeFile(skillPath, codecharterSkillMarkdown(version));
  await writeFile(openaiYamlPath, codecharterSkillOpenaiYaml());
  return { skillPath, openaiYamlPath };
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

function codecharterSkillMarkdown(version = "latest") {
  const npxCommand = `npx --yes codecharter@${version}`;
  return `---
name: codecharter
description: Use when a prompt contains a CodeCharter annotation, codecharter:// annotation link, local CodeCharter URL, browser annotation route, corner geohashes, resolved target count, or asks Codex to inspect a mapped code area through the CodeCharter CLI.
---

# CodeCharter

Use the CodeCharter CLI as the communication path. Do not use browser automation to inspect annotations unless the user explicitly asks for visual UI testing.

If \`command -v codecharter\` fails, run the same command through \`${npxCommand}\`. For example, \`${npxCommand} --json annotation <id-or-url>\`.

## Annotation Prompts

CodeCharter annotation prompts may include:

- a \`codecharter://annotation/<id>\` deep link
- a browser route like \`#/annotation/<id>\`
- a local CodeCharter URL like \`http://127.0.0.1:<port>/#/annotation/<id>\`
- a spatial frame with four corner geohashes
- a user note describing what to investigate

## Workflow

1. Run \`codecharter --json doctor\` when setup state, hooks, skill installation, map storage, or server reachability is unclear.
2. If the binary is missing, rerun the prior command as \`${npxCommand} ...\`.
3. Run \`codecharter --json annotation <id-or-url>\` for pasted annotation prompts. Pass the full CodeCharter URL when available.
4. Use \`resolvedTargets\` from the command output as the authoritative target list.
5. Read only needed ranges with \`codecharter --json source <path> [lineStart] [lineEnd]\`.
6. Treat \`Corner geohashes\` as the selected rectangle's spatial frame, not as files to expand or scan.
7. If a target is too broad, inspect annotation names, bounds, and target metadata before reading source.

## Fallbacks

- \`codecharter --json annotation\` uses the local server when the URL includes one, otherwise it reads \`.codecharter/named-places.json\` and refreshes against \`.codecharter/codecharter.json\`.
- Use \`codecharter --json annotations\` to list known annotations.
- Use \`codecharter --json api /api/...\` with \`--server <url>\` only as a read-only GET escape hatch when a high-level command is missing.
- If both map and annotation storage are unavailable, ask the user to start CodeCharter with \`codecharter dev\` or paste the annotation JSON.

## Do Not

- Do not bulk-read every file under a selected area.
- Do not expand corner geohashes into broad repository scans.
- Do not write or delete annotations through raw API calls without explicit user approval.
- Do not prefer browser automation over CLI reads for normal annotation work.

## Examples

\`\`\`sh
codecharter --json doctor
npx --yes codecharter@${version} --json doctor
codecharter --json annotation codecharter://annotation/<id>
npx --yes codecharter@${version} --json annotation codecharter://annotation/<id>
codecharter --json annotation 'http://127.0.0.1:4173/#/annotation/<id>'
codecharter --json annotation <id> --root /path/to/repo
codecharter --json source src/app.ts 1 80
codecharter --json annotations --server http://127.0.0.1:4173 --limit 10
\`\`\`
`;
}

function codecharterSkillOpenaiYaml() {
  return `interface:
  display_name: "CodeCharter"
  short_description: "Inspect CodeCharter map annotations via CLI"
  default_prompt: "Use $codecharter to inspect a pasted CodeCharter annotation through the CLI."
policy:
  allow_implicit_invocation: true
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
