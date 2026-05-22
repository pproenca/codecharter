import { execFile } from "node:child_process";
import type { ExecFileOptions } from "node:child_process";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readJson, writeJson } from "./store.ts";

type ExecFileAsync = (
  file: string,
  args: readonly string[],
  options: ExecFileOptions & { encoding?: BufferEncoding },
) => Promise<{ stdout: string; stderr: string }>;

const execFileAsync = promisify(execFile) as ExecFileAsync;

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
const MANAGED_POST_TOOL_MATCHERS = new Set([
  "Bash|apply_patch|Edit|Write",
  "Bash|apply_patch|Edit|Write|MultiEdit|functions.apply_patch|functions.exec_command",
  "Bash|exec_command|apply_patch|Edit|Write|MultiEdit|functions.apply_patch|functions.exec_command",
]);

type CodecharterConfig = {
  activityPath?: string;
  legacyMapPaths?: string[];
  agents?: {
    codex?: {
      activityPath?: string;
    };
  };
};

type PackageJson = {
  name?: string;
  version?: string;
  devDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  [key: string]: unknown;
};
type PackageDependencySection = "devDependencies" | "dependencies" | "optionalDependencies" | "peerDependencies";

type CodexHook = {
  type?: string;
  command?: string;
  timeout?: number;
  statusMessage?: string;
  [key: string]: unknown;
};

type CodexHookGroup = {
  matcher?: string;
  hooks?: CodexHook[];
  [key: string]: unknown;
};

type CodexHooksConfig = {
  hooks: Record<string, CodexHookGroup[]>;
  [key: string]: unknown;
};

export type InitializeCodecharterOptions = {
  root: string;
  mapPath?: string;
  installCodex?: boolean;
  installGitHooks?: boolean;
  fresh?: boolean;
  writeCodemap?: (options: { root: string; out: string; fresh: boolean }) => Promise<unknown>;
};

export class CodecharterInitializer {
  async initialize({
    root,
    mapPath,
    installCodex = true,
    installGitHooks = true,
    fresh = false,
    writeCodemap,
  }: InitializeCodecharterOptions) {
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
}

export class CodexHooksMerger {
  merge(existing: unknown, desired: CodexHooksConfig): CodexHooksConfig {
    const existingConfig = this.configOrEmpty(existing);
    const next = {
      ...existingConfig,
      hooks: { ...this.hooksRecord(existingConfig.hooks) },
    };

    for (const eventName in next.hooks) {
      if (!Object.hasOwn(next.hooks, eventName)) continue;
      const groups = next.hooks[eventName];
      if (!Array.isArray(groups)) continue;
      const keptGroups: CodexHookGroup[] = [];
      for (const group of groups) {
        const withoutManaged = this.withoutCodecharterHandlers(group);
        if (!this.isEmptyManagedHookGroup(eventName, withoutManaged)) keptGroups.push(withoutManaged);
      }
      next.hooks[eventName] = keptGroups;
    }

    for (const eventName in desired.hooks) {
      if (!Object.hasOwn(desired.hooks, eventName)) continue;
      const desiredGroups = desired.hooks[eventName] ?? [];
      const existingGroups = Array.isArray(next.hooks[eventName]) ? next.hooks[eventName] : [];
      next.hooks[eventName] = this.mergeHookGroups(existingGroups, desiredGroups);
    }

    return next;
  }

  mergeHookGroups(existingGroups: CodexHookGroup[], desiredGroups: CodexHookGroup[]): CodexHookGroup[] {
    const groups: CodexHookGroup[] = [];
    const groupIndexesByMatcher = new Map<string, number>();
    const hookKeysByGroup: Set<string>[] = [];

    for (const group of existingGroups) {
      const hooks = copyArray<CodexHook>(group.hooks);
      groups.push({ ...group, hooks });
      const matcher = group.matcher ?? "";
      if (!groupIndexesByMatcher.has(matcher)) groupIndexesByMatcher.set(matcher, groups.length - 1);
      hookKeysByGroup.push(this.hookKeySet(hooks));
    }

    for (const desiredGroup of desiredGroups) {
      const matcher = desiredGroup.matcher ?? "";
      const index = groupIndexesByMatcher.get(matcher);
      if (index === undefined) {
        const hooks = copyArray<CodexHook>(desiredGroup.hooks);
        groups.push({ ...desiredGroup, hooks });
        groupIndexesByMatcher.set(matcher, groups.length - 1);
        hookKeysByGroup.push(this.hookKeySet(hooks));
        continue;
      }

      const group = groups[index];
      const hookKeys = hookKeysByGroup[index];
      if (!group || !hookKeys) continue;
      for (const hook of desiredGroup.hooks ?? []) {
        const key = this.hookKey(hook);
        if (hookKeys.has(key)) continue;
        const hooks = group.hooks ?? [];
        hooks.push(hook);
        group.hooks = hooks;
        hookKeys.add(key);
      }
    }

    return groups;
  }

  withoutCodecharterHandlers(group: CodexHookGroup): CodexHookGroup {
    const hooks: CodexHook[] = [];
    if (Array.isArray(group.hooks)) {
      for (const hook of group.hooks) {
        if (!this.isCodecharterHook(hook)) hooks.push(hook);
      }
    }
    return { ...group, hooks };
  }

  isEmptyManagedHookGroup(eventName: string, group: CodexHookGroup): boolean {
    return eventName === "PostToolUse"
      && Array.isArray(group.hooks)
      && group.hooks.length === 0
      && MANAGED_POST_TOOL_MATCHERS.has(group.matcher ?? "");
  }

  isCodecharterHook(hook: CodexHook): boolean {
    return hook?.type === "command" && hook.command === CODECHARTER_HOOK_COMMAND;
  }

  sameHook(left: CodexHook, right: CodexHook): boolean {
    return left?.type === right?.type && left?.command === right?.command;
  }

  hookKeySet(hooks: CodexHook[] = []): Set<string> {
    const keys = new Set<string>();
    for (const hook of hooks) keys.add(this.hookKey(hook));
    return keys;
  }

  hookKey(hook: CodexHook): string {
    return JSON.stringify([hook?.type, hook?.command]);
  }

  configOrEmpty(value: unknown): CodexHooksConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) return { hooks: {} };
    const hooks = this.hooksRecord((value as { hooks?: unknown }).hooks);
    return { ...value, hooks } as CodexHooksConfig;
  }

  hooksRecord(value: unknown): Record<string, CodexHookGroup[]> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const hooks: Record<string, CodexHookGroup[]> = {};
    for (const eventName in value as Record<string, unknown>) {
      if (!Object.hasOwn(value, eventName)) continue;
      const groups = (value as Record<string, unknown>)[eventName];
      if (Array.isArray(groups)) hooks[eventName] = groups as CodexHookGroup[];
    }
    return hooks;
  }
}

function copyArray<T>(value: readonly T[] | undefined): T[] {
  if (!Array.isArray(value)) return [];
  const copy = new Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    copy[index] = value[index];
  }
  return copy;
}

export async function initializeCodecharter({
  root,
  mapPath,
  installCodex = true,
  installGitHooks = true,
  fresh = false,
  writeCodemap,
}: InitializeCodecharterOptions) {
  return new CodecharterInitializer().initialize({
    root,
    installCodex,
    installGitHooks,
    fresh,
    ...(mapPath === undefined ? {} : { mapPath }),
    ...(writeCodemap === undefined ? {} : { writeCodemap }),
  });
}

export async function ensurePackageDevDependency(root: string): Promise<{ skipped: boolean; changed?: boolean }> {
  const packagePath = join(root, "package.json");
  const packageJson = await readJson(packagePath, null) as PackageJson | null;
  if (!packageJson || packageJson.name === "codecharter") return { skipped: true };

  const version = await currentPackageVersion();
  const desiredSpec = `^${version}`;
  const dependencySections: PackageDependencySection[] = ["devDependencies", "dependencies", "optionalDependencies", "peerDependencies"];
  let existingSection: PackageDependencySection | undefined;
  for (const section of dependencySections) {
    if (!packageJson[section]?.codecharter) continue;
    existingSection = section;
    break;
  }

  if (existingSection) {
    const dependencies = packageJson[existingSection] ?? {};
    if (dependencies.codecharter === desiredSpec) return { skipped: false, changed: false };
    await writeJson(packagePath, {
      ...packageJson,
      [existingSection]: {
        ...dependencies,
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

export async function ensureCodecharterConfig(root: string, mapPath: string): Promise<string> {
  const configPath = join(root, CODECHARTER_DIR, "config.json");
  const existing = await readJson(configPath, {}) as CodecharterConfig;
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

export async function ensureCodexAdapter(root: string): Promise<{ hookPath: string; hooksJsonPath: string }> {
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

export async function ensureCodecharterSkill(root: string): Promise<{ skillPath: string; openaiYamlPath: string }> {
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

export async function ensureGitMapHooks(root: string, mapPath: string): Promise<{ skipped: boolean; hooks: string[] }> {
  const installed: string[] = [];
  const version = await currentPackageVersion();
  for (const hookName of MAP_HOOKS) {
    const hookPath = await gitPath(root, `hooks/${hookName}`);
    if (!hookPath) return { skipped: true, hooks: installed };
    await installManagedHookBlock(hookPath, gitMapHookBlock(root, mapPath, version));
    installed.push(hookName);
  }
  return { skipped: false, hooks: installed };
}

async function installManagedHookBlock(hookPath: string, block: string): Promise<void> {
  let current = "";
  try {
    current = await readFile(hookPath, "utf8");
  } catch (error) {
    if (!isErrnoException(error) || error.code !== "ENOENT") throw error;
  }

  const withoutManaged = current.replace(new RegExp(`\\n?${escapeRegExp(MANAGED_START)}[\\s\\S]*?${escapeRegExp(MANAGED_END)}\\n?`, "g"), "\n").trimEnd();
  const shebang = withoutManaged.startsWith("#!") ? "" : "#!/bin/sh\n";
  const separator = withoutManaged.length ? "\n\n" : "";
  await mkdir(dirname(hookPath), { recursive: true });
  await writeFile(hookPath, `${shebang}${withoutManaged}${separator}${block}\n`, { mode: 0o755 });
  await chmod(hookPath, 0o755);
}

function gitMapHookBlock(root: string, mapPath: string, version = "latest"): string {
  const mapRelative = normalizeRelative(root, mapPath);
  const mapRelativeShell = shellSingleQuote(mapRelative);
  const npxPackage = version === "latest" ? "codecharter" : `codecharter@${version}`;
  return `${MANAGED_START}
repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
map_path="$repo_root"/${mapRelativeShell}
if [ -x "$repo_root/node_modules/.bin/codecharter" ]; then
  "$repo_root/node_modules/.bin/codecharter" generate --root "$repo_root" --out "$map_path" --quiet >/dev/null 2>&1 || true
elif command -v codecharter >/dev/null 2>&1; then
  codecharter generate --root "$repo_root" --out "$map_path" --quiet >/dev/null 2>&1 || true
else
  npx --yes ${npxPackage} generate --root "$repo_root" --out "$map_path" --quiet >/dev/null 2>&1 || true
fi
${MANAGED_END}`;
}

function codexHooksJson(): CodexHooksConfig {
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

export function mergeCodexHooks(existing: unknown, desired: CodexHooksConfig): CodexHooksConfig {
  return new CodexHooksMerger().merge(existing, desired);
}

function codexHookShim(version = "latest"): string {
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

function codecharterSkillMarkdown(version = "latest"): string {
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

1. Run the pasted \`CLI:\` command exactly. If it includes \`--server <url>\`, keep it; that means the annotation belongs to the running viewer, not necessarily the current workspace.
2. If the binary is missing, rerun the same command as \`${npxCommand} --json resolve ...\`.
3. Treat \`resolvedTargets\` from the resolve output as the authoritative target list.
4. Read only the needed resolved target files and ranges with normal Codex file-reading tools. If those paths are not present in the current workspace, report a CodeCharter map/workspace mismatch instead of guessing.
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

function codecharterSkillOpenaiYaml(): string {
  return `interface:
  display_name: "CodeCharter"
  short_description: "Resolve CodeCharter map targets via CLI"
  default_prompt: "Use $codecharter to resolve mapped CodeCharter targets through the CLI."
policy:
  allow_implicit_invocation: true
`;
}

async function gitPath(root: string, path: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--git-path", path], { cwd: root });
    const resolvedPath = stdout.trim();
    return isAbsolute(resolvedPath) ? resolvedPath : join(root, resolvedPath);
  } catch {
    return null;
  }
}

function normalizeRelative(root: string, path: string): string {
  return relative(root, path).replaceAll("\\", "/");
}

function shellSingleQuote(value: string): string {
  if (/[\0\r\n]/.test(value)) throw new Error("Shell value cannot contain NUL or newline");
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function currentPackageVersion(): Promise<string> {
  const packagePath = fileURLToPath(new URL("../package.json", import.meta.url));
  const packageJson = await readJson(packagePath, { version: "0.1.0" }) as PackageJson;
  return packageJson.version ?? "0.1.0";
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
