#!/usr/bin/env node
import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
// Modernized CLI: a thin wiring layer over the single @codecharter/core barrel.
// (Legacy imported each src/* module directly; the logic now lives in core.)
import {
  createActivityEvent,
  appendActivityEvents,
  clearActivityArchive,
  ensureActivityArchive,
  startActivityWatcher,
  runCodexHook,
  parseCodemapDeepLink,
  generateCodemap,
  initializeCodecharter,
  MAP_LEVELS,
  ensureCodecharterGitignore,
  ensureLocalGitExcludes,
  resolveAddress,
  refreshPlaceResolution,
  startServer,
  writeJson,
  PACKAGE_DEPENDENCY_SECTIONS,
  errorMessage,
  isErrnoException,
  objectRecord,
  packageJsonFromValue,
  sortedUniqueStrings,
} from "../src/main/index.ts";
import type {
  AddressRequest,
  CodecharterCodemap,
  PackageJsonWithDependencies,
  ParsedCodemapDeepLink,
  GeneratedCodemap,
  ResolvedAddress,
  MapAnnotation,
} from "../src/main/index.ts";

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
type CliAddressRequestParts = {
  lineStartRaw: string | undefined;
  lineEndRaw: string | undefined;
  columnStartRaw: string | undefined;
  columnEndRaw: string | undefined;
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
const MAP_ANNOTATION_STRING_FIELDS = ["id", "name", "comment", "createdAt", "updatedAt", "deepLink", "browserHash", "codexPrompt"];

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

  const commandHandler = commandFor(command);
  if (commandHandler) {
    await commandHandler.execute({ args, command, jsonOutput });
    return;
  }

  if (jsonOutput) throw new Error(`Unknown command: ${command}`);
  console.error(usage());
  process.exitCode = 1;
}

function command(aliases: string[], execute: CommandHandler["execute"]): CommandHandler {
  return { aliases, execute };
}

const HELP_COMMAND = command(["--help", "-h", "help"], () => {
    console.log(usage());
});

const CLI_COMMANDS: CommandHandler[] = [
  HELP_COMMAND,
  command(["--version", "-V", "version"], async () => {
    console.log((await packageMetadata()).version);
  }),
  command(["doctor"], async ({ args, jsonOutput }) => {
    const root = resolvePath(takeOption(args, "--root", "."));
    const mapPath = resolveMapPath(root, takeOption(args, "--map", DEFAULT_MAP_FILE));
    const server = takeOption(args, "--server", undefined);
    stripArgumentSeparator(args);
    if (args.length > 0) throw new Error(`Unknown arguments: ${args.join(" ")}`);
    const result = await doctor({ root, mapPath, ...optionalProperty("server", server) });
    if (jsonOutput) printJson(result);
    else printDoctor(result);
  }),
  command(["generate"], async ({ args }) => {
    const root = resolvePath(takeOption(args, "--root", "."));
    const out = resolveMapPath(root, takeOption(args, "--out", DEFAULT_MAP_FILE));
    const fresh = takeFlag(args, "--fresh");
    const quiet = takeFlag(args, "--quiet");
    stripArgumentSeparator(args);
    if (args.length > 0) throw new Error(`Unknown arguments: ${args.join(" ")}`);

    await writeCodemap({ root, out, fresh, quiet });
  }),
  command(["init", "setup"], async ({ args, command }) => {
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
  }),
  command(["dev"], async ({ args }) => {
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
  }),
  command(["clear"], async ({ args, jsonOutput }) => {
    await runClearActivityCommand(args, jsonOutput);
  }),
  command(["resolve"], async ({ args, jsonOutput }) => {
    const root = resolvePath(takeOption(args, "--root", "."));
    const mapPath = await resolveCliMapPath(takeOption(args, "--map", undefined), root);
    const server = takeOption(args, "--server", undefined);
    const columnStartRaw = takeOption(args, "--column-start", undefined);
    const columnEndRaw = takeOption(args, "--column-end", undefined);
    stripArgumentSeparator(args);
    const [reference, lineStartRaw, lineEndRaw] = args;
    if (!reference) throw new Error("resolve requires a CodeCharter deep link or path");
    if (args.length > 3) throw new Error(`Unknown arguments: ${args.slice(3).join(" ")}`);

    if (reference.startsWith("codecharter://") || reference.startsWith("codemap://")) {
      const resolved = await resolveDeepLink({ root, mapPath, reference, ...optionalProperty("server", server) });
      printResult(resolved, jsonOutput, printResolvedDeepLink);
      return;
    }

    const address = await resolveCliAddress(mapPath, cliAddressRequest(reference, {
      lineStartRaw,
      lineEndRaw,
      columnStartRaw,
      columnEndRaw,
    }));
    printResult(address, jsonOutput, printResolvedAddress);
  }),
  command(["annotation"], async ({ args, jsonOutput }) => {
    const root = resolvePath(takeOption(args, "--root", "."));
    const mapPath = resolveMapPath(root, takeOption(args, "--map", DEFAULT_MAP_FILE));
    const server = takeOption(args, "--server", undefined);
    stripArgumentSeparator(args);
    const [reference] = args;
    if (!reference) throw new Error("annotation requires an id, codecharter://annotation link, or CodeCharter URL");
    if (args.length > 1) throw new Error(`Unknown arguments: ${args.slice(1).join(" ")}`);

    printResult(await readAnnotation({ root, mapPath, reference, ...optionalProperty("server", server) }), jsonOutput, printAnnotation);
  }),
  command(["annotations"], async ({ args, jsonOutput }) => {
    const root = resolvePath(takeOption(args, "--root", "."));
    const mapPath = resolveMapPath(root, takeOption(args, "--map", DEFAULT_MAP_FILE));
    const server = takeOption(args, "--server", undefined);
    const limit = optionalNumber(takeOption(args, "--limit", undefined));
    stripArgumentSeparator(args);
    if (args.length > 0) throw new Error(`Unknown arguments: ${args.join(" ")}`);

    printResult(await listAnnotations({
      root,
      mapPath,
      ...optionalProperty("server", server),
      ...optionalProperty("limit", limit),
    }), jsonOutput, printAnnotations);
  }),
  command(["api"], async ({ args, jsonOutput }) => {
    const server = takeOption(args, "--server", undefined);
    stripArgumentSeparator(args);
    const [reference] = args;
    if (!reference) throw new Error("api requires a local /api path or CodeCharter API URL");
    if (args.length > 1) throw new Error(`Unknown arguments: ${args.slice(1).join(" ")}`);

    printResult(await readApi({ reference, ...optionalProperty("server", server) }), jsonOutput, printApi);
  }),
  command(["activity"], async ({ args, jsonOutput }) => {
    let hardFailure = false;
    try {
      if (args[0] === "clear") {
        args.shift();
        await runClearActivityCommand(args, jsonOutput);
        return;
      }

      const mapPathOption = takeOption(args, "--map", undefined);
      const outPath = resolvePath(takeOption(args, "--out", DEFAULT_ACTIVITY_ARCHIVE));
      const server = takeOption(args, "--server", undefined);
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

      if (server) {
        const result = await postActivityToServer(server, {
          path,
          agentId,
          activityState,
          note,
          ...optionalProperty("lineStart", lineStartRaw),
          ...optionalProperty("lineEnd", lineEndRaw),
          ...optionalProperty("columnStart", columnStartRaw),
          ...optionalProperty("columnEnd", columnEndRaw),
        });
        printResult(result, jsonOutput, printActivityResult);
        return;
      }

      const mapPath = await resolveCliMapPath(mapPathOption);
      const address = await resolveCliAddress(mapPath, cliAddressRequest(path, {
        lineStartRaw,
        lineEndRaw,
        columnStartRaw,
        columnEndRaw,
      }));
      const event = createActivityEvent(address, { agentId, activityState, note });
      await appendActivityEvents(outPath, [event]);
      printResult({ accepted: true, event }, jsonOutput, printActivityResult);
    } catch (error) {
      printResult({ accepted: false, error: errorMessage(error) }, jsonOutput, printActivityResult);
      if (hardFailure) process.exitCode = 1;
    }
  }),
  command(["codex-hook"], async () => {
    const hookInput = await readStdin();
    await runCodexHook({ input: hookInput, cwd: process.cwd() });
  }),
  command(["serve"], async ({ args }) => {
    const root = resolvePath(takeOption(args, "--root", "."));
    const mapPath = resolveMapPath(root, takeOption(args, "--map", DEFAULT_MAP_FILE));
    const port = Number(takeOption(args, "--port", "4173"));
    const open = takeFlag(args, "--open");
    assertPositiveIntegerPort(port);
    stripArgumentSeparator(args);
    if (args.length > 0) throw new Error(`Unknown arguments: ${args.join(" ")}`);

    const server = await startServer({ root, mapPath, port });
    await printViewerReady(server, { open });
  }),
];

const COMMANDS_BY_NAME = new Map(CLI_COMMANDS.flatMap((handler) =>
  handler.aliases.map((alias) => [alias, handler] as const)
));

function commandFor(name: string | undefined): CommandHandler | undefined {
  return name ? COMMANDS_BY_NAME.get(name) : HELP_COMMAND;
}

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
  await runDevServer({
    root,
    mapPath,
    port,
    agentId,
    watch,
    fresh: false,
    open,
    ...optionalProperty("initialCodemap", initialCodemap),
  });
  if (printHooksNext) console.log("next: /hooks");
}

async function runClearActivityCommand(args: string[], jsonOutput: boolean): Promise<void> {
  const root = resolvePath(takeOption(args, "--root", "."));
  const outPath = resolvePath(root, takeOption(args, "--out", DEFAULT_ACTIVITY_ARCHIVE));
  const server = takeOption(args, "--server", undefined);
  stripArgumentSeparator(args);
  if (args.length > 0) throw new Error(`Unknown arguments: ${args.join(" ")}`);

  printResult(await clearActivity({ outPath, ...optionalProperty("server", server) }), jsonOutput, printActivityClearResult);
}

async function clearActivity({ outPath, server }: ClearActivityOptions) {
  const origin = normalizeOrigin(server);
  if (origin) {
    const response = await fetch(`${origin}/api/activity`, { method: "DELETE" });
    const body = (objectRecord(await response.json().catch(() => ({}))) ?? {}) as { error?: string };
    if (!response.ok) throw new Error(body.error ?? `${response.status} ${response.statusText}`);
    return { source: "server", origin, ...body };
  }

  await clearActivityArchive(outPath);
  return { source: "archive", path: outPath, cleared: true };
}

async function postActivityToServer(server: string, body: Record<string, unknown>) {
  const origin = normalizeOrigin(server);
  if (!origin) throw new Error("Activity server must be a valid URL");
  const response = await fetch(`${origin}/api/activity`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const responseBody = (objectRecord(await response.json().catch(() => ({}))) ?? {}) as { accepted?: boolean; error?: string };
  if (!response.ok) throw new Error(responseBody.error ?? `${response.status} ${response.statusText}`);
  return {
    source: "server",
    origin,
    accepted: responseBody.accepted === true,
    path: body.path,
  };
}

async function resolveDeepLink({ root, mapPath, reference, server }: DeepLinkResolveOptions) {
  const parsed = parseCodemapDeepLink(reference);
  if (parsed.kind === "annotation") {
    return {
      kind: "annotation",
      reference,
      ...await readAnnotation({ root, mapPath, reference, ...optionalProperty("server", server) }),
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
  return resolveAddress(codemap, addressRequest(path, { lineStart, lineEnd, columnStart, columnEnd }));
}

function requestFromDeepLink(parsed: ParsedCodemapDeepLink): CliAddressRequest & { lineStart?: number; lineEnd?: number; columnStart?: number; columnEnd?: number } {
  const path = parsed.metadata.path;
  if (!path) throw new Error("Deep link does not include path metadata");
  const lineRange = parseRange(parsed.metadata.lines);
  const columnRange = parseRange(parsed.metadata.columns);
  return {
    path,
    ...(lineRange ? { lineStart: lineRange.start, lineEnd: lineRange.end } : {}),
    ...(columnRange ? { columnStart: columnRange.start, columnEnd: columnRange.end } : {}),
  };
}

function parseRange(value: string | undefined): Range | undefined {
  if (!value) return undefined;
  const match = value.match(/^(\d+)(?:-(\d+))?$/);
  if (!match) throw new Error(`Invalid range in deep link metadata: ${value}`);
  return { start: Number(match[1]), end: Number(match[2] ?? match[1]) };
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
      ...optionalProperty("nextStep", missingSetup.length ? "Run `codecharter init` from the target repo." : undefined),
    },
    checks,
  };
}

async function cliStatus(root: string, currentVersion: string) {
  const localBinName = process.platform === "win32" ? "codecharter.cmd" : "codecharter";
  const packagePath = join(root, "package.json");
  const packageJson = packageJsonFromValue(await readOptionalJson(packagePath)) ?? undefined;
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

function packageDependencyStatus(packageJson: PackageJsonWithDependencies | undefined, packagePath: string, expectedSpec: string) {
  if (!packageJson) {
    return { path: packagePath, packageJson: false, expected: expectedSpec, ok: true };
  }

  if (packageJson.name === "codecharter") {
    return { path: packagePath, packageJson: true, skipped: "self-package", expected: expectedSpec, ok: true };
  }

  const section = PACKAGE_DEPENDENCY_SECTIONS.find((name) => packageJson[name]?.codecharter);
  if (!section) {
    return { path: packagePath, packageJson: true, found: false, expected: expectedSpec, ok: true };
  }

  const spec = packageJson[section]?.codecharter ?? "";
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

function optionalProperty<K extends string, T>(
  key: K,
  value: T,
): Partial<Record<K, Exclude<T, undefined>>> {
  return value === undefined ? {} : { [key]: value } as Partial<Record<K, Exclude<T, undefined>>>;
}

function cliAddressRequest(
  path: string,
  { lineStartRaw, lineEndRaw, columnStartRaw, columnEndRaw }: CliAddressRequestParts,
): CliAddressRequest {
  return {
    path,
    ...optionalProperty("lineStartRaw", lineStartRaw),
    ...optionalProperty("lineEndRaw", lineEndRaw),
    ...optionalProperty("columnStartRaw", columnStartRaw),
    ...optionalProperty("columnEndRaw", columnEndRaw),
  };
}

function addressRequest(
  path: string,
  { lineStart, lineEnd, columnStart, columnEnd }: {
    lineStart: AddressRequest["lineStart"] | undefined;
    lineEnd: AddressRequest["lineEnd"] | undefined;
    columnStart: AddressRequest["columnStart"] | undefined;
    columnEnd: AddressRequest["columnEnd"] | undefined;
  },
): AddressRequest {
  return {
    path,
    ...optionalProperty("lineStart", lineStart),
    ...optionalProperty("lineEnd", lineEnd),
    ...optionalProperty("columnStart", columnStart),
    ...optionalProperty("columnEnd", columnEnd),
  };
}

async function readOptionalJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeCodemap({ root, out, fresh = false, quiet = false }: WriteCodemapOptions): Promise<GeneratedCodemap> {
  const previousCodemap = fresh ? undefined : await readPreviousCodemap(root, out);
  const codemap = await generateCodemap({
    root,
    excludePaths: sortedUniqueStrings([relative(root, out), ...METADATA_EXCLUDE_PATHS]),
    ...optionalProperty("previousCodemap", previousCodemap),
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
  const bounded = limit !== undefined && Number.isInteger(limit) && limit >= 0 ? annotations.slice(0, limit) : annotations;
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
  const body = (objectRecord(await response.json()) ?? {}) as { annotations?: MapAnnotation[] };
  return Array.isArray(body.annotations) ? body.annotations : [];
}

async function listAnnotationsFromStorage({ root, mapPath }: { root: string; mapPath: string }): Promise<MapAnnotation[]> {
  const storePath = join(root, ".codecharter", "named-places.json");
  const store = namedPlacesFileFromValue(await readOptionalJson(storePath));
  const codemap = codemapFromValue(await readOptionalJson(mapPath));
  return store.places.map((annotation) => codemap ? refreshPlaceResolution(codemap, annotation) : annotation);
}

async function readAnnotation({ root, mapPath, reference, server }: AnnotationReferenceOptions): Promise<AnnotationEnvelope> {
  const parsed = parseAnnotationReference(reference);
  const origin = normalizeOrigin(parsed.origin ?? server);
  if (origin) {
    try {
      const response = await fetch(`${origin}/api/annotations/${encodeURIComponent(parsed.id)}`);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
      const body = (objectRecord(await response.json()) ?? {}) as { annotation: MapAnnotation };
      return annotationEnvelope(body.annotation, { source: "server", origin });
    } catch {}
  }

  const annotation = await readAnnotationFromStorage({ root, mapPath, id: parsed.id });
  return annotationEnvelope(annotation, { source: "storage" });
}

async function readAnnotationFromStorage({ root, mapPath, id }: AnnotationStorageOptions): Promise<MapAnnotation> {
  const storePath = join(root, ".codecharter", "named-places.json");
  const store = namedPlacesFileFromValue(await readOptionalJson(storePath));
  const annotation = store.places.find((place) => place.id === id);
  if (!annotation) throw new Error(`No annotation found for id: ${id}`);

  const codemap = codemapFromValue(await readOptionalJson(mapPath));
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
    const id = reference.slice("#/annotation/".length).split(/[?#]/)[0];
    if (!id) throw new Error("Annotation hash route must include an id");
    return { id: decodeURIComponent(id) };
  }

  if (/^https?:\/\//.test(reference)) {
    const url = new URL(reference);
    const hashMatch = url.hash.match(/^#\/annotation\/([^?]+)/);
    if (hashMatch?.[1]) return { id: decodeURIComponent(hashMatch[1]), origin: url.origin };
    const apiMatch = url.pathname.match(/\/api\/annotations\/([^/]+)/);
    if (apiMatch?.[1]) return { id: decodeURIComponent(apiMatch[1]), origin: url.origin };
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
    const value = JSON.parse(await readFile(path, "utf8"));
    return {
      path,
      exists: true,
      ok: true,
      validJson: true,
      ...optionalProperty("keys", value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).sort() : undefined),
    };
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return { path, exists: false, ok: false };
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

function namedPlacesFileFromValue(value: unknown): NamedPlacesFile {
  const record = objectRecord(value);
  return { places: Array.isArray(record?.places) ? record.places.filter(isMapAnnotation) : [] };
}

function codemapFromValue(value: unknown): CodecharterCodemap | undefined {
  return isCodecharterCodemap(value) ? value : undefined;
}

function isCodecharterCodemap(value: unknown): value is CodecharterCodemap {
  const record = objectRecord(value);
  return Boolean(record)
    && typeof record?.files === "object"
    && record.files !== null
    && typeof record.folders === "object"
    && record.folders !== null;
}

function isMapAnnotation(value: unknown): value is MapAnnotation {
  const record = objectRecord(value);
  return record?.kind === "mapAnnotation"
    && MAP_ANNOTATION_STRING_FIELDS.every((key) => typeof record[key] === "string")
    && isMapLevel(record.level)
    && objectRecord(record.geometry) !== null;
}

function isMapLevel(value: unknown): value is MapAnnotation["level"] {
  return typeof value === "string" && Object.hasOwn(MAP_LEVELS, value);
}

async function readPreviousCodemap(root: string, out: string): Promise<CodecharterCodemap | undefined> {
  const current = codemapFromValue(await readOptionalJson(out));
  if (current) return current;
  if (relative(root, out) === DEFAULT_MAP_FILE) {
    return codemapFromValue(await readOptionalJson(join(root, ROOT_MAP_FILE)))
      ?? codemapFromValue(await readOptionalJson(join(root, LEGACY_MAP_FILE)));
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
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

main().catch((error) => {
  if (process.argv.slice(2).includes("--json")) {
    printJson({ ok: false, error: { message: errorMessage(error) } });
  } else {
    console.error(errorMessage(error));
  }
  process.exitCode = 1;
});
