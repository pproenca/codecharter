#!/usr/bin/env node
import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { access, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { createActivityEvent } from "../src/activity.ts";
import { appendActivityEvents, clearActivityArchive, ensureActivityArchive } from "../src/activity-store.ts";
import { startActivityWatcher } from "../src/activity-watcher.ts";
import { runCodexHook } from "../src/codex-hook.ts";
import { parseCodemapDeepLink } from "../src/deep-links.ts";
import { generateCodemap } from "../src/generator.ts";
import { initializeCodecharter } from "../src/init.ts";
import { ensureCodecharterGitignore, ensureLocalGitExcludes } from "../src/local-git-exclude.ts";
import { resolveAddress } from "../src/resolver.ts";
import type { CodecharterCodemap } from "../src/resolver.js";
import { refreshPlaceResolution } from "../src/selections.ts";
import { startServer } from "../src/server.ts";
import { writeJson } from "../src/store.ts";
import type { ActivityStateInput } from "../src/activity.js";
import type { ActivityWatcherPayload, CodeChange } from "../src/activity-watcher.js";
import type { ParsedCodemapDeepLink } from "../src/deep-links.js";
import type { GeneratedCodemap } from "../src/generator.js";
import type { ResolvedAddress } from "../src/resolver.js";
import type { MapAnnotation } from "../src/selections.js";

type CommandContext = {
  args: string[];
  command: string | undefined;
  jsonOutput: boolean;
};

type CommandHandler = {
  aliases: string[];
  execute(context: CommandContext): Promise<void> | void;
};
type PackageMetadata = {
  name?: string;
  version: string;
  [key: string]: unknown;
};
type PackageJson = {
  name?: string;
  devDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  [key: string]: unknown;
};
type PackageDependencySection = "devDependencies" | "dependencies" | "optionalDependencies" | "peerDependencies";
type NamedPlacesFile = {
  places: MapAnnotation[];
};
type CliSetupOptions = {
  root: string;
  out: string;
  fresh: boolean;
  installCodex: boolean;
  installGitHooks: boolean;
};
type SetupAndRunDevOptions = {
  root: string;
  mapPath: string;
  fresh: boolean;
  installCodex: boolean;
  installGitHooks: boolean;
  port: number;
  agentId: string;
  watch: boolean;
  open: boolean;
  printHooksNext: boolean;
};
type WriteCodemapOptions = {
  root: string;
  out: string;
  fresh?: boolean;
  quiet?: boolean;
};
type ClearActivityOptions = {
  outPath: string;
  server?: string;
};
type DeepLinkResolveOptions = {
  root: string;
  mapPath: string;
  reference: string;
  server?: string;
};
type CliAddressRequest = {
  path: string;
  lineStartRaw?: string;
  lineEndRaw?: string;
  columnStartRaw?: string;
  columnEndRaw?: string;
};
type ServerOption = {
  server?: string;
};
type AnnotationReferenceOptions = {
  root: string;
  mapPath: string;
  reference: string;
  server?: string;
};
type AnnotationStorageOptions = {
  root: string;
  mapPath: string;
  id: string;
};
type AnnotationEnvelopeMetadata = {
  source: "server" | "storage";
  origin?: string;
};
type AnnotationEnvelope = AnnotationEnvelopeMetadata & {
  annotation: MapAnnotation;
  resolvedTargets: MapAnnotation["resolvedTargets"];
  targetCount: number;
};
type ParsedAnnotationReference = {
  id: string;
  origin?: string;
};
type ListAnnotationsOptions = ServerOption & {
  root: string;
  mapPath: string;
  limit?: number;
};
type ListedAnnotations = {
  source: "server" | "storage";
  origin?: string;
  count: number;
  totalCount: number;
  annotations: MapAnnotation[];
};
type ApiReadOptions = ServerOption & {
  reference: string;
};
type ApiReadResult = {
  source: "server";
  method: "GET";
  url: string;
  status: number;
  body: unknown;
};
type Range = {
  start: number;
  end: number;
};
type PathKind = "file" | "directory";
type PathStatus = {
  path: string;
  exists: boolean;
  ok: boolean;
  type?: string;
};
type JsonFileStatus = PathStatus & {
  validJson?: boolean;
  keys?: string[];
  error?: string;
};
type DoctorOptions = ServerOption & {
  root: string;
  mapPath: string;
};
type DoctorResult = {
  version: string;
  root: string;
  mapPath: string;
  setup: {
    ready: boolean;
    missing: string[];
    nextStep?: string;
  };
  checks: {
    cli: {
      recommendedCommand: string;
      packageDependency: { ok?: boolean };
    };
    map: JsonFileStatus;
    config: JsonFileStatus;
  } & Record<string, unknown>;
  [key: string]: unknown;
};

const DEFAULT_MAP_FILE = ".codecharter/codecharter.json";
const ROOT_MAP_FILE = "codecharter.json";
const LEGACY_MAP_FILE = "codemap.json";
const DEFAULT_ACTIVITY_ARCHIVE = ".codecharter/activity.jsonl";
const METADATA_EXCLUDE_PATHS = [
  DEFAULT_MAP_FILE,
  ROOT_MAP_FILE,
  LEGACY_MAP_FILE,
  ".codecharter/config.json",
  ".codex/hooks.json",
  ".codex/hooks/codecharter-codex-hook.mjs",
  ".agents/skills/codecharter/SKILL.md",
  ".agents/skills/codecharter/agents/openai.yaml",
];

function usage(): string {
  return `Usage:
  codecharter resolve <codecharter://...> [--json] [--root <dir>] [--map <file>] [--server <url>]
  codecharter resolve <path> [lineStart] [lineEnd] [--json] [--root <dir>] [--map <file>]
  codecharter init [--root <dir>]
  codecharter dev [--root <dir>] [--port <port>] [--open]
  codecharter clear [--json] [--server <url>] [--root <dir>] [--out <file.jsonl>]
  codecharter --version

For agents:
  Use resolve only. Humans use init, dev, and clear.
`;
}

function takeOption(args: string[], name: string, fallback: string): string;
function takeOption(args: string[], name: string, fallback: undefined): string | undefined;
function takeOption(args: string[], name: string, fallback: string | undefined): string | undefined {
  const index = optionIndex(args, name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value) throw new Error(`Missing value for ${name}`);
  args.splice(index, 2);
  return value;
}

function takeFlag(args: string[], name: string): boolean {
  const index = optionIndex(args, name);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function optionIndex(args: string[], name: string): number {
  const limit = optionSearchLimit(args);
  for (let index = 0; index < limit; index += 1) {
    if (args[index] === name) return index;
  }
  return -1;
}

function optionSearchLimit(args: string[]): number {
  const separatorIndex = args.indexOf("--");
  return separatorIndex === -1 ? args.length : separatorIndex;
}

async function main() {
  const args = process.argv.slice(2);
  let jsonOutput = takeFlag(args, "--json");
  takeFlag(args, "--plain");
  stripArgumentSeparator(args);
  const command = args.shift();
  jsonOutput = takeFlag(args, "--json") || jsonOutput;
  takeFlag(args, "--plain");

  const commandHandler = COMMAND_REGISTRY.commandFor(command);
  if (commandHandler) {
    await commandHandler.execute({ args, command, jsonOutput });
    return;
  }

  if (jsonOutput) throw new Error(`Unknown command: ${command}`);
  console.error(usage());
  process.exitCode = 1;
}

class CommandRegistry {
  private readonly commandsByName: Map<string, CommandHandler>;
  private readonly defaultCommand: CommandHandler;

  constructor(commands: CommandHandler[], defaultCommand: CommandHandler) {
    this.commandsByName = new Map(commands.flatMap((command) =>
      command.aliases.map((alias) => [alias, command])
    ));
    this.defaultCommand = defaultCommand;
  }

  commandFor(name: string | undefined): CommandHandler | undefined {
    return name ? this.commandsByName.get(name) : this.defaultCommand;
  }
}

class CliCommand {
  readonly aliases: string[];

  constructor(aliases: string[]) {
    this.aliases = aliases;
  }
}

class HelpCommand extends CliCommand {
  constructor() {
    super(["--help", "-h", "help"]);
  }

  async execute() {
    console.log(usage());
  }
}

class VersionCommand extends CliCommand {
  constructor() {
    super(["--version", "-V", "version"]);
  }

  async execute() {
    console.log((await packageMetadata()).version);
  }
}

class DoctorCommand extends CliCommand {
  constructor() {
    super(["doctor"]);
  }

  async execute({ args, jsonOutput }: CommandContext) {
    const root = resolvePath(takeOption(args, "--root", "."));
    const mapPath = resolveMapPath(root, takeOption(args, "--map", DEFAULT_MAP_FILE));
    const server = takeOption(args, "--server", undefined);
    stripArgumentSeparator(args);
    if (args.length > 0) throw new Error(`Unknown arguments: ${args.join(" ")}`);
    const result = await doctor({ root, mapPath, server });
    if (jsonOutput) printJson(result);
    else printDoctor(result);
  }
}

class GenerateCommand extends CliCommand {
  constructor() {
    super(["generate"]);
  }

  async execute({ args }: CommandContext) {
    const root = resolvePath(takeOption(args, "--root", "."));
    const out = resolveMapPath(root, takeOption(args, "--out", DEFAULT_MAP_FILE));
    const fresh = takeFlag(args, "--fresh");
    const quiet = takeFlag(args, "--quiet");
    stripArgumentSeparator(args);
    if (args.length > 0) throw new Error(`Unknown arguments: ${args.join(" ")}`);

    await writeCodemap({ root, out, fresh, quiet });
  }
}

class InitCommand extends CliCommand {
  constructor() {
    super(["init", "setup"]);
  }

  async execute({ args, command }: CommandContext) {
    const root = resolvePath(takeOption(args, "--root", "."));
    const out = resolveMapPath(root, takeOption(args, "--out", DEFAULT_MAP_FILE));
    const fresh = takeFlag(args, "--fresh");
    const yes = takeFlag(args, "--yes") || command === "setup";
    const startDev = command === "setup" ? !takeFlag(args, "--no-dev") : takeFlag(args, "--dev");
    const open = takeFlag(args, "--open");
    const port = Number(takeOption(args, "--port", "4173"));
    const agentId = takeOption(args, "--agent", process.env.CODEMAP_AGENT_ID ?? "codex");
    const watch = !takeFlag(args, "--no-watch");
    const noCodex = takeFlag(args, "--no-codex");
    const noGitHooks = takeFlag(args, "--no-git-hooks");
    assertPositiveIntegerPort(port);
    stripArgumentSeparator(args);
    if (args.length > 0) throw new Error(`Unknown arguments: ${args.join(" ")}`);

    const installCodex = noCodex ? false : yes ? true : await confirm("Install Codex activity tracking hooks?", true);
    const installGitHooks = noGitHooks ? false : yes ? true : await confirm("Install local Git hooks to refresh the map?", true);

    if (startDev) {
      await setupAndRunDev({
        root,
        mapPath: out,
        fresh,
        installCodex,
        installGitHooks,
        port,
        agentId,
        watch,
        open,
        printHooksNext: installCodex,
      });
      return;
    }

    await setupCodecharter({
      root,
      out,
      fresh,
      installCodex,
      installGitHooks,
    });
    console.log("next: codecharter dev");
  }
}

class DevCommand extends CliCommand {
  constructor() {
    super(["dev"]);
  }

  async execute({ args }: CommandContext) {
    const root = resolvePath(takeOption(args, "--root", "."));
    const mapPath = resolveMapPath(root, takeOption(args, "--map", DEFAULT_MAP_FILE));
    const port = Number(takeOption(args, "--port", "4173"));
    const agentId = takeOption(args, "--agent", process.env.CODEMAP_AGENT_ID ?? "codex");
    const watch = !takeFlag(args, "--no-watch");
    const fresh = takeFlag(args, "--fresh");
    const setup = takeFlag(args, "--setup");
    const open = takeFlag(args, "--open");
    assertPositiveIntegerPort(port);
    stripArgumentSeparator(args);
    if (args.length > 0) throw new Error(`Unknown arguments: ${args.join(" ")}`);

    if (setup) {
      await setupAndRunDev({
        root,
        mapPath,
        fresh,
        installCodex: true,
        installGitHooks: true,
        port,
        agentId,
        watch,
        open,
        printHooksNext: true,
      });
      return;
    }

    await runDevServer({ root, mapPath, port, agentId, watch, fresh, open });
  }
}

class ClearCommand extends CliCommand {
  constructor() {
    super(["clear"]);
  }

  async execute({ args, jsonOutput }: CommandContext) {
    await runClearActivityCommand(args, jsonOutput);
  }
}

class ResolveCommand extends CliCommand {
  constructor() {
    super(["resolve"]);
  }

  async execute({ args, jsonOutput }: CommandContext) {
    const root = resolvePath(takeOption(args, "--root", "."));
    const mapPath = await resolveCliMapPath(takeOption(args, "--map", undefined), root);
    const server = takeOption(args, "--server", undefined);
    const columnStartRaw = takeOption(args, "--column-start", undefined);
    const columnEndRaw = takeOption(args, "--column-end", undefined);
    stripArgumentSeparator(args);
    const [reference, lineStartRaw, lineEndRaw] = args;
    if (!reference) throw new Error("resolve requires a CodeCharter deep link or path");
    if (args.length > 3) throw new Error(`Unknown arguments: ${args.slice(3).join(" ")}`);

    if (isCodecharterDeepLink(reference)) {
      const resolved = await resolveDeepLink({ root, mapPath, reference, server });
      printResult(resolved, jsonOutput, printResolvedDeepLink);
      return;
    }

    const address = await resolveCliAddress(mapPath, { path: reference, lineStartRaw, lineEndRaw, columnStartRaw, columnEndRaw });
    printResult(address, jsonOutput, printResolvedAddress);
  }
}

class AnnotationCommand extends CliCommand {
  constructor() {
    super(["annotation"]);
  }

  async execute({ args, jsonOutput }: CommandContext) {
    const root = resolvePath(takeOption(args, "--root", "."));
    const mapPath = resolveMapPath(root, takeOption(args, "--map", DEFAULT_MAP_FILE));
    const server = takeOption(args, "--server", undefined);
    stripArgumentSeparator(args);
    const [reference] = args;
    if (!reference) throw new Error("annotation requires an id, codecharter://annotation link, or CodeCharter URL");
    if (args.length > 1) throw new Error(`Unknown arguments: ${args.slice(1).join(" ")}`);

    printResult(await readAnnotation({ root, mapPath, reference, server }), jsonOutput, printAnnotation);
  }
}

class AnnotationsCommand extends CliCommand {
  constructor() {
    super(["annotations"]);
  }

  async execute({ args, jsonOutput }: CommandContext) {
    const root = resolvePath(takeOption(args, "--root", "."));
    const mapPath = resolveMapPath(root, takeOption(args, "--map", DEFAULT_MAP_FILE));
    const server = takeOption(args, "--server", undefined);
    const limit = optionalNumber(takeOption(args, "--limit", undefined));
    stripArgumentSeparator(args);
    if (args.length > 0) throw new Error(`Unknown arguments: ${args.join(" ")}`);

    printResult(await listAnnotations({ root, mapPath, server, limit }), jsonOutput, printAnnotations);
  }
}

class ApiCommand extends CliCommand {
  constructor() {
    super(["api"]);
  }

  async execute({ args, jsonOutput }: CommandContext) {
    const server = takeOption(args, "--server", undefined);
    stripArgumentSeparator(args);
    const [reference] = args;
    if (!reference) throw new Error("api requires a local /api path or CodeCharter API URL");
    if (args.length > 1) throw new Error(`Unknown arguments: ${args.slice(1).join(" ")}`);

    printResult(await readApi({ reference, server }), jsonOutput, printApi);
  }
}

class ActivityCommand extends CliCommand {
  constructor() {
    super(["activity"]);
  }

  async execute({ args, jsonOutput }: CommandContext) {
    let hardFailure = false;
    try {
      if (args[0] === "clear") {
        args.shift();
        await runClearActivityCommand(args, jsonOutput);
        return;
      }

      const mapPath = await resolveCliMapPath(takeOption(args, "--map", undefined));
      const outPath = resolvePath(takeOption(args, "--out", DEFAULT_ACTIVITY_ARCHIVE));
      const agentId = takeOption(args, "--agent", "codex");
      const activityState = takeOption(args, "--state", "editing");
      const note = takeOption(args, "--note", "");
      const columnStartRaw = takeOption(args, "--column-start", undefined);
      const columnEndRaw = takeOption(args, "--column-end", undefined);
      stripArgumentSeparator(args);
      const [path, lineStartRaw, lineEndRaw] = args;
      if (!path) {
        hardFailure = true;
        throw new Error("activity requires a path");
      }

      const address = await resolveCliAddress(mapPath, { path, lineStartRaw, lineEndRaw, columnStartRaw, columnEndRaw });
      const event = createActivityEvent(address, { agentId, activityState, note });
      await appendActivityEvents(outPath, [event]);
      printResult({ accepted: true, event }, jsonOutput, printActivityResult);
    } catch (error) {
      printResult({ accepted: false, error: errorMessage(error) }, jsonOutput, printActivityResult);
      if (hardFailure) process.exitCode = 1;
    }
  }
}

class CodexHookCommand extends CliCommand {
  constructor() {
    super(["codex-hook"]);
  }

  async execute() {
    const hookInput = await readStdin();
    await runCodexHook({ input: hookInput, cwd: process.cwd() });
  }
}

class ServeCommand extends CliCommand {
  constructor() {
    super(["serve"]);
  }

  async execute({ args }: CommandContext) {
    const root = resolvePath(takeOption(args, "--root", "."));
    const mapPath = resolveMapPath(root, takeOption(args, "--map", DEFAULT_MAP_FILE));
    const port = Number(takeOption(args, "--port", "4173"));
    const open = takeFlag(args, "--open");
    assertPositiveIntegerPort(port);
    stripArgumentSeparator(args);
    if (args.length > 0) throw new Error(`Unknown arguments: ${args.join(" ")}`);

    const server = await startServer({ root, mapPath, port });
    await printViewerReady(server, { open });
  }
}

const CLI_COMMANDS = [
  new HelpCommand(),
  new VersionCommand(),
  new DoctorCommand(),
  new GenerateCommand(),
  new InitCommand(),
  new DevCommand(),
  new ClearCommand(),
  new ResolveCommand(),
  new AnnotationCommand(),
  new AnnotationsCommand(),
  new ApiCommand(),
  new ActivityCommand(),
  new CodexHookCommand(),
  new ServeCommand(),
];

const COMMAND_REGISTRY = new CommandRegistry(CLI_COMMANDS, new HelpCommand());

function assertPositiveIntegerPort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Port must be an integer from 1 to 65535");
  }
}

async function setupAndRunDev({
  root,
  mapPath,
  fresh,
  installCodex,
  installGitHooks,
  port,
  agentId,
  watch,
  open,
  printHooksNext,
}: SetupAndRunDevOptions): Promise<void> {
  const setupResult = await setupCodecharter({
    root,
    out: mapPath,
    fresh,
    installCodex,
    installGitHooks,
  });
  const initialCodemap = isCodecharterCodemap(setupResult.codemap) ? setupResult.codemap : undefined;
  await runDevServer({ root, mapPath, port, agentId, watch, fresh: false, open, initialCodemap });
  if (printHooksNext) console.log("next: /hooks");
}

async function runClearActivityCommand(args: string[], jsonOutput: boolean): Promise<void> {
  const root = resolvePath(takeOption(args, "--root", "."));
  const outPath = resolvePath(root, takeOption(args, "--out", DEFAULT_ACTIVITY_ARCHIVE));
  const server = takeOption(args, "--server", undefined);
  stripArgumentSeparator(args);
  if (args.length > 0) throw new Error(`Unknown arguments: ${args.join(" ")}`);

  printResult(await clearActivity({ outPath, server }), jsonOutput, printActivityClearResult);
}

async function clearActivity({ outPath, server }: ClearActivityOptions) {
  const origin = normalizeOrigin(server);
  if (origin) {
    const response = await fetch(`${origin}/api/activity`, { method: "DELETE" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? `${response.status} ${response.statusText}`);
    return { source: "server", origin, ...body };
  }

  await clearActivityArchive(outPath);
  return { source: "archive", path: outPath, cleared: true };
}

async function resolveDeepLink({ root, mapPath, reference, server }: DeepLinkResolveOptions) {
  const parsed = parseCodemapDeepLink(reference);
  if (parsed.kind === "annotation") {
    return {
      kind: "annotation",
      reference,
      ...await readAnnotation({ root, mapPath, reference, server }),
    };
  }

  if (parsed.metadata.path) {
    const codemap = JSON.parse(await readFile(mapPath, "utf8"));
    const address = resolveAddress(codemap, requestFromDeepLink(parsed));
    return {
      kind: address.targetType,
      reference,
      address,
    };
  }

  throw new Error(`Cannot resolve ${reference}: ${parsed.kind} links require a path in link metadata`);
}

async function resolveCliAddress(mapPath: string, { path, lineStartRaw, lineEndRaw, columnStartRaw, columnEndRaw }: CliAddressRequest): Promise<ResolvedAddress> {
  const columnStart = optionalNumber(columnStartRaw);
  const columnEnd = optionalNumber(columnEndRaw);
  const codemap = JSON.parse(await readFile(mapPath, "utf8"));
  const lineStart = optionalNumber(lineStartRaw);
  const lineEnd = lineEndRaw === undefined ? lineStart : optionalNumber(lineEndRaw);
  return resolveAddress(codemap, { path, lineStart, lineEnd, columnStart, columnEnd });
}

function requestFromDeepLink(parsed: ParsedCodemapDeepLink): CliAddressRequest & { lineStart?: number; lineEnd?: number; columnStart?: number; columnEnd?: number } {
  const request: { path: string; lineStart?: number; lineEnd?: number; columnStart?: number; columnEnd?: number } = { path: parsed.metadata.path };
  const lineRange = parseRange(parsed.metadata.lines);
  const columnRange = parseRange(parsed.metadata.columns);
  if (lineRange) {
    request.lineStart = lineRange.start;
    request.lineEnd = lineRange.end;
  }
  if (columnRange) {
    request.columnStart = columnRange.start;
    request.columnEnd = columnRange.end;
  }
  return request;
}

function parseRange(value: string | undefined): Range | undefined {
  if (!value) return undefined;
  const match = String(value).match(/^(\d+)(?:-(\d+))?$/);
  if (!match) throw new Error(`Invalid range in deep link metadata: ${value}`);
  return { start: Number(match[1]), end: Number(match[2] ?? match[1]) };
}

function isCodecharterDeepLink(value: string): boolean {
  return value.startsWith("codecharter://") || value.startsWith("codemap://");
}

async function doctor({ root, mapPath, server }: DoctorOptions): Promise<DoctorResult> {
  const configPath = join(root, ".codecharter", "config.json");
  const namedPlacesPath = join(root, ".codecharter", "named-places.json");
  const hooksJsonPath = join(root, ".codex", "hooks.json");
  const hookShimPath = join(root, ".codex", "hooks", "codecharter-codex-hook.mjs");
  const skillPath = join(root, ".agents", "skills", "codecharter", "SKILL.md");
  const skillUiPath = join(root, ".agents", "skills", "codecharter", "agents", "openai.yaml");
  const packageJson = await packageMetadata();
  const endpoint = server ? normalizeOrigin(server) : undefined;
  const serverStatus = endpoint ? await probeServer(endpoint) : { configured: false };
  const checks = {
    root: await pathStatus(root, "directory"),
    cli: await cliStatus(root, packageJson.version),
    map: await jsonFileStatus(mapPath),
    config: await jsonFileStatus(configPath),
    namedPlaces: await jsonFileStatus(namedPlacesPath),
    codexHooks: await jsonFileStatus(hooksJsonPath),
    codexHookShim: await pathStatus(hookShimPath, "file"),
    codexSkill: await pathStatus(skillPath, "file"),
    codexSkillUi: await pathStatus(skillUiPath, "file"),
    server: serverStatus,
  };
  const missingSetup = Object.entries({
    map: checks.map.exists,
    config: checks.config.exists,
    codexHooks: checks.codexHooks.exists,
    codexHookShim: checks.codexHookShim.exists,
    codexSkill: checks.codexSkill.exists,
    codexSkillUi: checks.codexSkillUi.exists,
    packageDependency: checks.cli.packageDependency.ok !== false,
  })
    .filter(([, exists]) => !exists)
    .map(([name]) => name);

  return {
    ok: missingSetup.length === 0 && checks.map.validJson !== false && checks.config.validJson !== false,
    command: "codecharter",
    version: packageJson.version,
    auth: { required: false, source: "none" },
    root,
    mapPath,
    setup: {
      ready: missingSetup.length === 0,
      missing: missingSetup,
      nextStep: missingSetup.length ? "Run `codecharter init` from the target repo." : undefined,
    },
    checks,
  };
}

async function cliStatus(root: string, currentVersion: string) {
  const localBinName = process.platform === "win32" ? "codecharter.cmd" : "codecharter";
  const packagePath = join(root, "package.json");
  const packageJson = await readOptionalJson<PackageJson>(packagePath);
  const expectedSpec = `^${currentVersion}`;
  return {
    command: "codecharter",
    currentVersion,
    invocation: process.argv[1],
    recommendedCommand: `npx --yes codecharter@${currentVersion}`,
    localBin: await pathStatus(join(root, "node_modules", ".bin", localBinName), "file"),
    packageDependency: packageDependencyStatus(packageJson, packagePath, expectedSpec),
  };
}

function packageDependencyStatus(packageJson: PackageJson | undefined, packagePath: string, expectedSpec: string) {
  if (!packageJson) {
    return { path: packagePath, packageJson: false, expected: expectedSpec, ok: true };
  }

  if (packageJson.name === "codecharter") {
    return { path: packagePath, packageJson: true, skipped: "self-package", expected: expectedSpec, ok: true };
  }

  const sections: PackageDependencySection[] = ["devDependencies", "dependencies", "optionalDependencies", "peerDependencies"];
  const section = sections.find((name) => packageJson[name]?.codecharter);
  if (!section) {
    return { path: packagePath, packageJson: true, found: false, expected: expectedSpec, ok: true };
  }

  const spec = packageJson[section].codecharter;
  return {
    path: packagePath,
    packageJson: true,
    found: true,
    section,
    spec,
    expected: expectedSpec,
    ok: spec === expectedSpec,
  };
}

async function setupCodecharter({ root, out, fresh, installCodex, installGitHooks }: CliSetupOptions) {
  await ensureCodecharterGitignore(root);
  await ensureLocalGitExcludes(root);
  const result = await initializeCodecharter({
    root,
    mapPath: out,
    fresh,
    installCodex,
    installGitHooks,
    writeCodemap: (options) => writeCodemap({ ...options, quiet: true }),
  });
  await ensureActivityStream(root);
  printSetupResult(root, result, { installCodex, installGitHooks });
  return result;
}

type RunDevServerOptions = {
  root: string;
  mapPath: string;
  port: number;
  agentId: string;
  watch: boolean;
  fresh: boolean;
  open: boolean;
  initialCodemap?: CodecharterCodemap;
};

async function runDevServer({ root, mapPath, port, agentId, watch, fresh, open, initialCodemap }: RunDevServerOptions) {
  await ensureCodecharterGitignore(root);
  await ensureLocalGitExcludes(root);
  let currentCodemap: CodecharterCodemap = initialCodemap ?? await writeCodemap({ root, out: mapPath, fresh, quiet: true });
  if (!initialCodemap) printMapResult(root, mapPath, currentCodemap);
  await ensureActivityStream(root);
  const server = await startServer({ root, mapPath, port });
  const actualPort = serverPort(server.address());
  await printViewerReady(server, { open });

  if (watch) {
    let lastRefreshSignature = "";
    startActivityWatcher({
      root,
      endpoint: `http://127.0.0.1:${actualPort}/api/activity`,
      agentId,
      activityState: "editing",
      prepareChanges: async (changes) => {
        const signature = changes
          .map((change) => `${change.path}:${change.signature}`)
          .sort()
          .join("\0");
        if (!signature || signature === lastRefreshSignature) return;
        lastRefreshSignature = signature;
        currentCodemap = await writeCodemap({ root, out: mapPath, quiet: true });
      },
      createActivityPayload: (change, { agentId: eventAgentId, activityState }) => {
        const address = resolveAddress(currentCodemap, change);
        return {
          agentId: eventAgentId,
          activityState,
          address,
          note: "codecharter dev watcher",
        };
      },
    });
    console.log(`activity: watching agent=${agentId}`);
  }

  return server;
}

async function printViewerReady(server: ReturnType<typeof startServer> extends Promise<infer T> ? T : never, { open }: { open: boolean }): Promise<void> {
  const url = viewerUrl(server);
  console.log(`viewer: ${url}`);
  if (open) await openBrowser(url);
}

function viewerUrl(server: ReturnType<typeof startServer> extends Promise<infer T> ? T : never): string {
  return `http://127.0.0.1:${serverPort(server.address())}`;
}

async function openBrowser(url: string): Promise<void> {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  await new Promise<void>((resolve) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.once("error", (error) => {
      console.warn(`warning: browser-open-failed ${error.message}`);
      console.warn(`viewer: ${url}`);
      resolve();
    });
    child.once("spawn", () => {
      child.unref();
      console.log("opened: true");
      resolve();
    });
  });
}

function stripArgumentSeparator(args: string[]): void {
  if (args[0] === "--") args.shift();
}

async function readOptionalJson<T = unknown>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeCodemap({ root, out, fresh = false, quiet = false }: WriteCodemapOptions): Promise<GeneratedCodemap> {
  const previousCodemap = fresh ? undefined : await readPreviousCodemap(root, out);
  const codemap = await generateCodemap({
    root,
    excludePaths: sortedUnique([relative(root, out), ...METADATA_EXCLUDE_PATHS]),
    previousCodemap,
  });
  await writeJson(out, codemap);
  if (!quiet) {
    printMapResult(root, out, codemap);
  }
  return codemap;
}

function printSetupResult(root: string, result: Awaited<ReturnType<typeof initializeCodecharter>>, { installCodex, installGitHooks }: { installCodex: boolean; installGitHooks: boolean }): void {
  console.log("init: ok");
  const codemap = isCodecharterCodemap(result.codemap) ? result.codemap : undefined;
  if (codemap) printMapResult(root, result.mapPath, codemap);
  else console.log(`map: ${displayPath(root, result.mapPath)}`);
  console.log(`config: ${displayPath(root, result.configPath)}`);
  console.log(`skill: ${installCodex && result.codexSkillPath ? displayPath(root, result.codexSkillPath) : "skipped"}`);
  console.log(`hooks: ${[installCodex && "codex", installGitHooks && "git"].filter(Boolean).join(",") || "skipped"}`);
  console.log(`activity: ${DEFAULT_ACTIVITY_ARCHIVE}`);
}

function printMapResult(root: string, mapPath: string, codemap: CodecharterCodemap): void {
  console.log(`map: ${displayPath(root, mapPath)}`);
  console.log(`files: ${Object.keys(codemap.files).length}`);
  console.log(`folders: ${Object.keys(codemap.folders).length}`);
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function serverPort(address: string | AddressInfo | null): number {
  if (!address || typeof address === "string") throw new Error("Server did not expose a TCP port");
  return address.port;
}

async function ensureActivityStream(root: string): Promise<void> {
  await ensureActivityArchive(join(root, DEFAULT_ACTIVITY_ARCHIVE));
}

async function listAnnotations({ root, mapPath, server, limit }: ListAnnotationsOptions): Promise<ListedAnnotations> {
  const origin = normalizeOrigin(server);
  const annotations = origin
    ? await listAnnotationsFromServer(origin)
    : await listAnnotationsFromStorage({ root, mapPath });
  const bounded = Number.isInteger(limit) && limit >= 0 ? annotations.slice(0, limit) : annotations;
  return {
    source: origin ? "server" : "storage",
    ...(origin ? { origin } : {}),
    count: bounded.length,
    totalCount: annotations.length,
    annotations: bounded,
  };
}

async function listAnnotationsFromServer(origin: string): Promise<MapAnnotation[]> {
  const response = await fetch(`${origin}/api/annotations`);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  const body = await response.json();
  return Array.isArray(body.annotations) ? body.annotations : [];
}

async function listAnnotationsFromStorage({ root, mapPath }: { root: string; mapPath: string }): Promise<MapAnnotation[]> {
  const storePath = join(root, ".codecharter", "named-places.json");
  const store = await readOptionalJson<NamedPlacesFile>(storePath) ?? { places: [] };
  const codemap = await readOptionalJson<CodecharterCodemap>(mapPath);
  return store.places
    .filter((place: { kind?: string }) => place.kind === "mapAnnotation")
    .map((annotation: MapAnnotation) => codemap ? refreshPlaceResolution(codemap, annotation) : annotation);
}

async function readAnnotation({ root, mapPath, reference, server }: AnnotationReferenceOptions): Promise<AnnotationEnvelope> {
  const parsed = parseAnnotationReference(reference);
  const origin = normalizeOrigin(parsed.origin ?? server);
  if (origin) {
    try {
      const response = await fetch(`${origin}/api/annotations/${encodeURIComponent(parsed.id)}`);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
      const body = await response.json();
      return annotationEnvelope(body.annotation, { source: "server", origin });
    } catch {}
  }

  const annotation = await readAnnotationFromStorage({ root, mapPath, id: parsed.id });
  return annotationEnvelope(annotation, { source: "storage" });
}

async function readAnnotationFromStorage({ root, mapPath, id }: AnnotationStorageOptions): Promise<MapAnnotation> {
  const storePath = join(root, ".codecharter", "named-places.json");
  const store = await readOptionalJson<NamedPlacesFile>(storePath) ?? { places: [] };
  const annotation = store.places.find((place: { kind?: string; id?: string }) => place.kind === "mapAnnotation" && place.id === id);
  if (!annotation) throw new Error(`No annotation found for id: ${id}`);

  const codemap = await readOptionalJson<CodecharterCodemap>(mapPath);
  return codemap ? refreshPlaceResolution(codemap, annotation) : annotation;
}

function annotationEnvelope(annotation: MapAnnotation, metadata: AnnotationEnvelopeMetadata): AnnotationEnvelope {
  return {
    ...metadata,
    annotation,
    resolvedTargets: annotation.resolvedTargets ?? [],
    targetCount: annotation.resolvedTargets?.length ?? 0,
  };
}

async function readApi({ reference, server }: ApiReadOptions): Promise<ApiReadResult> {
  const url = apiUrl(reference, server);
  if (new URL(url).pathname === "/api/source") throw new Error("api does not expose /api/source; use Codex file-reading tools for source files");
  const response = await fetch(url);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  return {
    source: "server",
    method: "GET",
    url,
    status: response.status,
    body,
  };
}

function apiUrl(reference: string, server?: string): string {
  if (/^https?:\/\//.test(reference)) {
    const url = new URL(reference);
    if (!url.pathname.startsWith("/api/")) throw new Error("api only supports CodeCharter /api URLs");
    return url.toString();
  }
  const origin = normalizeOrigin(server);
  if (!origin) throw new Error("api requires --server when the reference is a path");
  if (!reference.startsWith("/api/")) throw new Error("api path must start with /api/");
  return `${origin}${reference}`;
}

function parseAnnotationReference(reference: string): ParsedAnnotationReference {
  if (!reference) throw new Error("Annotation reference is required");
  if (reference.startsWith("codecharter://") || reference.startsWith("codemap://")) {
    const parsed = parseCodemapDeepLink(reference);
    if (parsed.kind !== "annotation") throw new Error(`Expected an annotation link, received: ${parsed.kind}`);
    return { id: parsed.locator };
  }

  if (reference.startsWith("#/annotation/")) {
    return { id: decodeURIComponent(reference.slice("#/annotation/".length).split(/[?#]/)[0]) };
  }

  if (/^https?:\/\//.test(reference)) {
    const url = new URL(reference);
    const hashMatch = url.hash.match(/^#\/annotation\/([^?]+)/);
    if (hashMatch) return { id: decodeURIComponent(hashMatch[1]), origin: url.origin };
    const apiMatch = url.pathname.match(/\/api\/annotations\/([^/]+)/);
    if (apiMatch) return { id: decodeURIComponent(apiMatch[1]), origin: url.origin };
    throw new Error("CodeCharter URL must contain #/annotation/<id> or /api/annotations/<id>");
  }

  return { id: reference };
}

function normalizeOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  return url.origin;
}

async function packageMetadata(): Promise<PackageMetadata> {
  const packagePath = fileURLToPath(new URL("../package.json", import.meta.url));
  return JSON.parse(await readFile(packagePath, "utf8"));
}

async function pathStatus(path: string, expectedType: PathKind): Promise<PathStatus> {
  try {
    const stats = await stat(path);
    return {
      path,
      exists: true,
      type: stats.isDirectory() ? "directory" : stats.isFile() ? "file" : "other",
      ok: expectedType === "directory" ? stats.isDirectory() : expectedType === "file" ? stats.isFile() : true,
    };
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return { path, exists: false, ok: false };
    throw error;
  }
}

async function jsonFileStatus(path: string): Promise<JsonFileStatus> {
  try {
    await access(path);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return { path, exists: false, ok: false };
    throw error;
  }
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    return {
      path,
      exists: true,
      ok: true,
      validJson: true,
      keys: value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).sort() : undefined,
    };
  } catch (error) {
    return {
      path,
      exists: true,
      ok: false,
      validJson: false,
      error: errorMessage(error),
    };
  }
}

async function probeServer(origin: string) {
  try {
    const response = await fetch(`${origin}/api/map-version`);
    if (!response.ok) return { configured: true, origin, ok: false, status: response.status };
    return { configured: true, origin, ok: true, status: response.status, mapVersion: await response.json() };
  } catch (error) {
    return { configured: true, origin, ok: false, error: errorMessage(error) };
  }
}

function printDoctor(result: DoctorResult): void {
  console.log(`version: ${result.version}`);
  console.log(`root: ${result.root}`);
  console.log(`map: ${displayPath(result.root, result.mapPath)}`);
  console.log(`setup: ${result.setup.ready ? "ready" : "missing"}`);
  if (result.setup.missing.length) console.log(`missing: ${result.setup.missing.join(",")}`);
  console.log(`fallback: ${result.checks.cli.recommendedCommand}`);
  if (result.setup.nextStep) console.log(`next: ${result.setup.nextStep.replace(/^Run `(.+)` from the target repo\.$/, "$1")}`);
}

function printResult<T>(value: T, jsonOutput: boolean, printPlain: (value: T) => void): void {
  if (jsonOutput) printJson(value);
  else printPlain(value);
}

function printResolvedAddress(address: ResolvedAddress): void {
  console.log(`target: ${address.targetType}`);
  console.log(`path: ${address.path}`);
  if (address.lineRange) console.log(`lines: ${address.lineRange.start}-${address.lineRange.end}`);
  if (address.tokenRange) console.log(`columns: ${address.tokenRange.start}-${address.tokenRange.end}`);
  console.log(`geohash: ${address.geohash}`);
  console.log(`link: ${address.deepLink}`);
}

function printResolvedDeepLink(result: { kind: string; reference: string; address?: ResolvedAddress } | ({ kind: "annotation"; reference: string } & AnnotationEnvelope)): void {
  if ("annotation" in result) {
    printAnnotation(result);
    return;
  }
  console.log(`kind: ${result.kind}`);
  console.log(`reference: ${result.reference}`);
  if ("address" in result && result.address) printResolvedAddress(result.address);
}

function printAnnotation(result: AnnotationEnvelope): void {
  console.log(`annotation: ${result.annotation.id}`);
  console.log(`source: ${result.source}`);
  if (result.origin) console.log(`origin: ${result.origin}`);
  console.log(`targets: ${result.targetCount}`);
  if (result.annotation.comment) console.log(`note: ${singleLine(result.annotation.comment)}`);
  for (const target of result.resolvedTargets.slice(0, 12)) {
    console.log(`target: ${target.path}${target.lineRange ? `:${target.lineRange.start}-${target.lineRange.end}` : ""}`);
  }
  if (result.targetCount > 12) console.log(`more: ${result.targetCount - 12}`);
  console.log(`json: codecharter --json resolve "${result.annotation.deepLink}"`);
}

function printAnnotations(result: ListedAnnotations): void {
  console.log(`source: ${result.source}`);
  if (result.origin) console.log(`origin: ${result.origin}`);
  console.log(`annotations: ${result.count}`);
  if (result.totalCount !== result.count) console.log(`total: ${result.totalCount}`);
  for (const annotation of result.annotations) {
    console.log(`annotation: ${annotation.id} targets=${annotation.resolvedTargets?.length ?? 0} note=${singleLine(annotation.comment ?? annotation.name ?? "")}`);
  }
}

function printApi(result: ApiReadResult): void {
  console.log(`method: ${result.method}`);
  console.log(`status: ${result.status}`);
  console.log(`url: ${result.url}`);
  if (result.body && typeof result.body === "object" && !Array.isArray(result.body)) {
    console.log(`keys: ${Object.keys(result.body).sort().join(",")}`);
  } else if (result.body !== null && result.body !== undefined) {
    console.log(`body: ${singleLine(String(result.body))}`);
  }
}

function printActivityResult(result: { accepted: boolean; event?: ReturnType<typeof createActivityEvent>; error?: string }): void {
  console.log(`accepted: ${result.accepted ? "true" : "false"}`);
  if (result.event) {
    console.log(`event: ${result.event.id}`);
    console.log(`state: ${result.event.activityState}`);
    console.log(`path: ${result.event.address?.path}`);
  }
  if (result.error) console.log(`error: ${result.error}`);
}

function printActivityClearResult(result: { cleared?: boolean; source: string; origin?: string; path?: string; events?: number }): void {
  console.log(`cleared: ${result.cleared ? "true" : "false"}`);
  console.log(`source: ${result.source}`);
  if (result.origin) console.log(`origin: ${result.origin}`);
  if (result.path) console.log(`path: ${result.path}`);
  if (Number.isInteger(result.events)) console.log(`events: ${result.events}`);
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function singleLine(value: unknown): string {
  return String(value).replace(/\s+/g, " ").trim();
}

function displayPath(root: string, path: string): string {
  const relativePath = relative(root, path);
  return relativePath && !relativePath.startsWith("..") && !isAbsolute(relativePath) ? relativePath : path;
}

function resolveMapPath(root: string, path: string): string {
  return isAbsolute(path) ? path : resolvePath(root, path);
}

function optionalNumber(value: string | undefined): number | undefined {
  return value === undefined ? undefined : Number(value);
}

function isCodecharterCodemap(value: unknown): value is CodecharterCodemap {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && typeof (value as { files?: unknown }).files === "object"
    && typeof (value as { folders?: unknown }).folders === "object";
}

async function readPreviousCodemap(root: string, out: string): Promise<CodecharterCodemap | undefined> {
  const current = await readOptionalJson<CodecharterCodemap>(out);
  if (current) return current;
  if (relative(root, out) === DEFAULT_MAP_FILE) {
    return await readOptionalJson<CodecharterCodemap>(join(root, ROOT_MAP_FILE)) ?? await readOptionalJson<CodecharterCodemap>(join(root, LEGACY_MAP_FILE));
  }
  return undefined;
}

async function resolveCliMapPath(option: string | undefined, root = "."): Promise<string> {
  const resolvedRoot = resolvePath(root);
  if (option) return resolveMapPath(resolvedRoot, option);
  const defaultMapPath = resolvePath(resolvedRoot, DEFAULT_MAP_FILE);
  const rootMapPath = resolvePath(resolvedRoot, ROOT_MAP_FILE);
  if (await readOptionalJson(defaultMapPath)) return defaultMapPath;
  if (await readOptionalJson(rootMapPath)) return rootMapPath;
  return resolvePath(resolvedRoot, LEGACY_MAP_FILE);
}

async function confirm(question: string, fallback: boolean): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return fallback;
  const rl = createInterface({ input, output });
  try {
    const suffix = fallback ? " [Y/n] " : " [y/N] ";
    const answer = (await rl.question(`${question}${suffix}`)).trim().toLowerCase();
    if (!answer) return fallback;
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

async function readStdin(): Promise<string> {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  return raw;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

main().catch((error) => {
  if (process.argv.slice(2).includes("--json")) {
    printJson({ ok: false, error: { message: errorMessage(error) } });
  } else {
    console.error(errorMessage(error));
  }
  process.exitCode = 1;
});
