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
  const version = await currentPackageVersion();
  await writeFile(hookPath, codexHookShim(version), { mode: 0o755 });
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
  const version = await currentPackageVersion();
  for (const hookName of MAP_HOOKS) {
    const hookPath = await gitPath(root, `hooks/${hookName}`);
    if (!hookPath) return { skipped: true, hooks: installed };
    await installManagedHookBlock(hookPath, gitMapHookBlock(root, mapPath, version));
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

function gitMapHookBlock(root, mapPath, version = "latest") {
  const mapRelative = normalizeRelative(root, mapPath);
  const npxPackage = version === "latest" ? "codecharter" : `codecharter@${version}`;
  return `${MANAGED_START}
repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
map_path="$repo_root/${mapRelative}"
if [ -x "$repo_root/node_modules/.bin/codecharter" ]; then
  "$repo_root/node_modules/.bin/codecharter" generate --root "$repo_root" --out "$map_path" --quiet >/dev/null 2>&1 || true
elif command -v codecharter >/dev/null 2>&1; then
  codecharter generate --root "$repo_root" --out "$map_path" --quiet >/dev/null 2>&1 || true
else
  npx --yes ${npxPackage} generate --root "$repo_root" --out "$map_path" --quiet >/dev/null 2>&1 || true
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
          matcher: "Bash|exec_command|apply_patch|Edit|Write|MultiEdit|functions.apply_patch|functions.exec_command",
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

function codexHookShim(version = "latest") {
  const npxPackage = version === "latest" ? "codecharter" : `codecharter@${version}`;
  return `#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const input = readFileSync(0, "utf8");
const gitRoot = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
const root = gitRoot.status === 0 ? gitRoot.stdout.trim() : process.cwd();
const localBin = join(root, "node_modules", ".bin", process.platform === "win32" ? "codecharter.cmd" : "codecharter");
const candidates = existsSync(localBin)
  ? [{ command: localBin, args: ["codex-hook"] }, { command: "codecharter", args: ["codex-hook"] }, { command: "npx", args: ["--yes", "${npxPackage}", "codex-hook"] }]
  : [{ command: "codecharter", args: ["codex-hook"] }, { command: "npx", args: ["--yes", "${npxPackage}", "codex-hook"] }];

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
description: Use when a prompt asks Codex to inspect a CodeCharter map annotation, includes a codecharter:// deep link, includes a CodeCharter resolve command, or asks for code context from a CodeCharter selection.
---

# CodeCharter

Use the CodeCharter CLI as the communication path. For agents, the CLI contract is one command: \`resolve\`.

If \`command -v codecharter\` fails, run the same command through \`${npxCommand}\`. For example, \`${npxCommand} --json resolve "codecharter://annotation/<id>"\`.

## CodeCharter Prompts

CodeCharter prompts may include:

- one or more \`codecharter --json resolve ...\` commands
- a \`codecharter://annotation/<id>\` deep link
- a target count
- a user note describing what to investigate

## Workflow

1. Run \`codecharter --json resolve "codecharter://annotation/<id>"\` for the pasted CodeCharter annotation.
2. If the binary is missing, rerun the same command as \`${npxCommand} --json resolve ...\`.
3. Treat \`resolvedTargets\` from the resolve output as the authoritative target list.
4. Read only the needed resolved target files and ranges with normal Codex file-reading tools.
5. If no deep link or resolve command is present, ask the user to copy a fresh CodeCharter prompt from the viewer.

## Fallbacks

- Use \`${npxCommand} --json resolve ...\` when the local binary is unavailable.
- Ask the user to run \`codecharter init\` if the map sidecar is missing.
- Ask the user to run \`codecharter dev\` only when they need the local viewer or live activity overlay.

## Do Not

- Do not use any agent-facing CodeCharter command except \`resolve\`.
- Do not bulk-read every file under a selected area.
- Do not use CodeCharter as a source-file reader; Codex should read resolved target files directly.
- Do not use browser automation for normal CodeCharter prompt handling.
- Do not run human commands such as \`init\`, \`dev\`, or \`clear\` unless the user asks.

## Examples

\`\`\`sh
codecharter --json resolve "codecharter://annotation/<id>"
npx --yes codecharter@${version} --json resolve "codecharter://annotation/<id>"
\`\`\`
`;
}

function codecharterSkillOpenaiYaml() {
  return `interface:
  display_name: "CodeCharter"
  short_description: "Resolve CodeCharter map targets via CLI"
  default_prompt: "Use $codecharter to resolve mapped CodeCharter targets through the CLI."
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
