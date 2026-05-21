#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { access, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { createActivityEvent } from "../src/activity.js";
import { appendActivityEvents, ensureActivityArchive } from "../src/activity-store.js";
import { startActivityWatcher } from "../src/activity-watcher.js";
import { runCodexHook } from "../src/codex-hook.js";
import { parseCodemapDeepLink } from "../src/deep-links.js";
import { generateCodemap } from "../src/generator.js";
import { initializeCodecharter } from "../src/init.js";
import { ensureCodecharterGitignore, ensureLocalGitExcludes } from "../src/local-git-exclude.js";
import { resolveAddress } from "../src/resolver.js";
import { refreshPlaceResolution } from "../src/selections.js";
import { startServer } from "../src/server.js";
import { readSourceRange } from "../src/source.js";
import { writeJson } from "../src/store.js";

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

function usage() {
  return `Usage:
  codecharter setup [--root <dir>] [--port <port>] [--open]
  codecharter init [--root <dir>]
  codecharter dev [--root <dir>] [--port <port>] [--open]
  codecharter doctor [--json] [--root <dir>] [--server <url>]
  codecharter annotation <id-or-url> [--json] [--root <dir>] [--server <url>]
  codecharter source <path> [lineStart] [lineEnd] [--json] [--root <dir>]
  codecharter --version

Advanced:
  codecharter annotations [--json] [--root <dir>] [--server <url>] [--limit <n>]
  codecharter resolve <path> [lineStart] [lineEnd] [--json] [--map <file>]
  codecharter activity <path> [lineStart] [lineEnd] [--json] [--agent <id>] [--state <state>] [--note <text>]
  codecharter api <api-path-or-url> --server <url> [--json]
  codecharter generate [--root <dir>] [--out <file>] [--fresh] [--quiet]
  codecharter serve [--root <dir>] [--map <file>] [--port <port>] [--open]
`;
}

function takeOption(args, name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value) throw new Error(`Missing value for ${name}`);
  args.splice(index, 2);
  return value;
}

function takeFlag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  let jsonOutput = takeFlag(args, "--json");
  takeFlag(args, "--plain");
  const command = args.shift();
  stripArgumentSeparator(args);
  jsonOutput = takeFlag(args, "--json") || jsonOutput;
  takeFlag(args, "--plain");

  if (!command || command === "--help" || command === "-h" || command === "help") {
    console.log(usage());
    return;
  }

  if (command === "--version" || command === "-V" || command === "version") {
    console.log((await packageMetadata()).version);
    return;
  }

  if (command === "doctor") {
    const root = resolvePath(takeOption(args, "--root", "."));
    const mapPath = resolveMapPath(root, takeOption(args, "--map", DEFAULT_MAP_FILE));
    const server = takeOption(args, "--server", undefined);
    if (args.length > 0) throw new Error(`Unknown arguments: ${args.join(" ")}`);
    const result = await doctor({ root, mapPath, server });
    if (jsonOutput) printJson(result);
    else printDoctor(result);
    return;
  }

  if (command === "generate") {
    const root = resolvePath(takeOption(args, "--root", "."));
    const out = resolveMapPath(root, takeOption(args, "--out", DEFAULT_MAP_FILE));
    const fresh = takeFlag(args, "--fresh");
    const quiet = takeFlag(args, "--quiet");
    if (args.length > 0) throw new Error(`Unknown arguments: ${args.join(" ")}`);

    await writeCodemap({ root, out, fresh, quiet });
    return;
  }

  if (command === "init" || command === "setup") {
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
    if (!Number.isInteger(port) || port < 1) throw new Error("Port must be a positive integer");
    if (args.length > 0) throw new Error(`Unknown arguments: ${args.join(" ")}`);

    const installCodex = noCodex ? false : yes ? true : await confirm("Install Codex activity tracking hooks?", true);
    const installGitHooks = noGitHooks ? false : yes ? true : await confirm("Install local Git hooks to refresh the map?", true);
    const setupResult = await setupCodecharter({
      root,
      out,
      fresh,
      installCodex,
      installGitHooks,
    });

    if (startDev) {
      await runDevServer({ root, mapPath: out, port, agentId, watch, fresh: false, open, initialCodemap: setupResult.codemap });
      if (installCodex) console.log("next: /hooks");
    } else {
      console.log("next: codecharter dev");
    }
    return;
  }

  if (command === "dev") {
    const root = resolvePath(takeOption(args, "--root", "."));
    const mapPath = resolveMapPath(root, takeOption(args, "--map", DEFAULT_MAP_FILE));
    const port = Number(takeOption(args, "--port", "4173"));
    const agentId = takeOption(args, "--agent", process.env.CODEMAP_AGENT_ID ?? "codex");
    const watch = !takeFlag(args, "--no-watch");
    const fresh = takeFlag(args, "--fresh");
    const setup = takeFlag(args, "--setup");
    const open = takeFlag(args, "--open");
    if (!Number.isInteger(port) || port < 1) throw new Error("Port must be a positive integer");
    if (args.length > 0) throw new Error(`Unknown arguments: ${args.join(" ")}`);

    if (setup) {
      const setupResult = await setupCodecharter({
        root,
        out: mapPath,
        fresh,
        installCodex: true,
        installGitHooks: true,
      });
      await runDevServer({ root, mapPath, port, agentId, watch, fresh: false, open, initialCodemap: setupResult.codemap });
      console.log("next: /hooks");
    } else {
      await runDevServer({ root, mapPath, port, agentId, watch, fresh, open });
    }
    return;
  }

  if (command === "resolve") {
    const mapPath = await resolveCliMapPath(takeOption(args, "--map", undefined));
    const columnStart = optionalNumber(takeOption(args, "--column-start", undefined));
    const columnEnd = optionalNumber(takeOption(args, "--column-end", undefined));
    const [path, lineStartRaw, lineEndRaw] = args;
    if (!path) throw new Error("resolve requires a path");

    const codemap = JSON.parse(await readFile(mapPath, "utf8"));
    const lineStart = optionalNumber(lineStartRaw);
    const lineEnd = lineEndRaw === undefined ? lineStart : optionalNumber(lineEndRaw);
    const address = resolveAddress(codemap, { path, lineStart, lineEnd, columnStart, columnEnd });
    printResult(address, jsonOutput, printResolvedAddress);
    return;
  }

  if (command === "annotation") {
    const root = resolvePath(takeOption(args, "--root", "."));
    const mapPath = resolveMapPath(root, takeOption(args, "--map", DEFAULT_MAP_FILE));
    const server = takeOption(args, "--server", undefined);
    const [reference] = args;
    if (!reference) throw new Error("annotation requires an id, codecharter://annotation link, or CodeCharter URL");
    if (args.length > 1) throw new Error(`Unknown arguments: ${args.slice(1).join(" ")}`);

    printResult(await readAnnotation({ root, mapPath, reference, server }), jsonOutput, printAnnotation);
    return;
  }

  if (command === "annotations") {
    const root = resolvePath(takeOption(args, "--root", "."));
    const mapPath = resolveMapPath(root, takeOption(args, "--map", DEFAULT_MAP_FILE));
    const server = takeOption(args, "--server", undefined);
    const limit = optionalNumber(takeOption(args, "--limit", undefined));
    if (args.length > 0) throw new Error(`Unknown arguments: ${args.join(" ")}`);

    printResult(await listAnnotations({ root, mapPath, server, limit }), jsonOutput, printAnnotations);
    return;
  }

  if (command === "source") {
    const root = resolvePath(takeOption(args, "--root", "."));
    const mapPath = resolveMapPath(root, takeOption(args, "--map", DEFAULT_MAP_FILE));
    const [path, lineStartRaw, lineEndRaw] = args;
    if (!path) throw new Error("source requires a path");
    if (args.length > 3) throw new Error(`Unknown arguments: ${args.slice(3).join(" ")}`);

    const codemap = JSON.parse(await readFile(mapPath, "utf8"));
    const file = codemap.files[path];
    if (!file) throw new Error(`No source file found for path: ${path}`);
    const lineStart = optionalNumber(lineStartRaw);
    const lineEnd = lineEndRaw === undefined ? lineStart : optionalNumber(lineEndRaw);
    printResult({
      source: "storage",
      ...await readSourceRange(root, file, { lineStart, lineEnd }),
    }, jsonOutput, printSource);
    return;
  }

  if (command === "api") {
    const server = takeOption(args, "--server", undefined);
    const [reference] = args;
    if (!reference) throw new Error("api requires a local /api path or CodeCharter API URL");
    if (args.length > 1) throw new Error(`Unknown arguments: ${args.slice(1).join(" ")}`);

    printResult(await readApi({ reference, server }), jsonOutput, printApi);
    return;
  }

  if (command === "activity") {
    try {
      const mapPath = await resolveCliMapPath(takeOption(args, "--map", undefined));
      const outPath = resolvePath(takeOption(args, "--out", DEFAULT_ACTIVITY_ARCHIVE));
      const agentId = takeOption(args, "--agent", "codex");
      const activityState = takeOption(args, "--state", "editing");
      const note = takeOption(args, "--note", "");
      const columnStart = optionalNumber(takeOption(args, "--column-start", undefined));
      const columnEnd = optionalNumber(takeOption(args, "--column-end", undefined));
      const [path, lineStartRaw, lineEndRaw] = args;
      if (!path) throw new Error("activity requires a path");

      const codemap = JSON.parse(await readFile(mapPath, "utf8"));
      const lineStart = optionalNumber(lineStartRaw);
      const lineEnd = lineEndRaw === undefined ? lineStart : optionalNumber(lineEndRaw);
      const address = resolveAddress(codemap, { path, lineStart, lineEnd, columnStart, columnEnd });
      const event = createActivityEvent(address, { agentId, activityState, note });
      await appendActivityEvents(outPath, [event]);
      printResult({ accepted: true, event }, jsonOutput, printActivityResult);
    } catch (error) {
      printResult({ accepted: false, error: error.message }, jsonOutput, printActivityResult);
    }
    return;
  }

  if (command === "codex-hook") {
    const hookInput = await readStdin();
    await runCodexHook({ input: hookInput, cwd: process.cwd() });
    return;
  }

  if (command === "serve") {
    const root = resolvePath(takeOption(args, "--root", "."));
    const mapPath = resolveMapPath(root, takeOption(args, "--map", DEFAULT_MAP_FILE));
    const port = Number(takeOption(args, "--port", "4173"));
    const open = takeFlag(args, "--open");
    if (!Number.isInteger(port) || port < 1) throw new Error("Port must be a positive integer");
    if (args.length > 0) throw new Error(`Unknown arguments: ${args.join(" ")}`);

    const server = await startServer({ root, mapPath, port });
    await printViewerReady(server, { open });
    return;
  }

  if (jsonOutput) throw new Error(`Unknown command: ${command}`);
  console.error(usage());
  process.exitCode = 1;
}

async function doctor({ root, mapPath, server }) {
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
      nextStep: missingSetup.length ? "Run `codecharter setup` from the target repo." : undefined,
    },
    checks,
  };
}

async function cliStatus(root, currentVersion) {
  const localBinName = process.platform === "win32" ? "codecharter.cmd" : "codecharter";
  const packagePath = join(root, "package.json");
  const packageJson = await readOptionalJson(packagePath);
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

function packageDependencyStatus(packageJson, packagePath, expectedSpec) {
  if (!packageJson) {
    return { path: packagePath, packageJson: false, expected: expectedSpec, ok: true };
  }

  if (packageJson.name === "codecharter") {
    return { path: packagePath, packageJson: true, skipped: "self-package", expected: expectedSpec, ok: true };
  }

  const sections = ["devDependencies", "dependencies", "optionalDependencies", "peerDependencies"];
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

async function setupCodecharter({ root, out, fresh, installCodex, installGitHooks }) {
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

async function runDevServer({ root, mapPath, port, agentId, watch, fresh, open, initialCodemap }) {
  await ensureCodecharterGitignore(root);
  await ensureLocalGitExcludes(root);
  let currentCodemap = initialCodemap ?? await writeCodemap({ root, out: mapPath, fresh, quiet: true });
  if (!initialCodemap) printMapResult(root, mapPath, currentCodemap);
  await ensureActivityStream(root);
  const server = await startServer({ root, mapPath, port });
  const actualPort = server.address().port;
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

async function printViewerReady(server, { open }) {
  const url = viewerUrl(server);
  console.log(`viewer: ${url}`);
  if (open) await openBrowser(url);
}

function viewerUrl(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

async function openBrowser(url) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  await new Promise((resolve) => {
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

function stripArgumentSeparator(args) {
  if (args[0] === "--") args.shift();
}

async function readOptionalJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeCodemap({ root, out, fresh = false, quiet = false }) {
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

function printSetupResult(root, result, { installCodex, installGitHooks }) {
  console.log("setup: ok");
  if (result.codemap) printMapResult(root, result.mapPath, result.codemap);
  else console.log(`map: ${displayPath(root, result.mapPath)}`);
  console.log(`config: ${displayPath(root, result.configPath)}`);
  console.log(`skill: ${installCodex && result.codexSkillPath ? displayPath(root, result.codexSkillPath) : "skipped"}`);
  console.log(`hooks: ${[installCodex && "codex", installGitHooks && "git"].filter(Boolean).join(",") || "skipped"}`);
  console.log(`activity: ${DEFAULT_ACTIVITY_ARCHIVE}`);
}

function printMapResult(root, mapPath, codemap) {
  console.log(`map: ${displayPath(root, mapPath)}`);
  console.log(`files: ${Object.keys(codemap.files).length}`);
  console.log(`folders: ${Object.keys(codemap.folders).length}`);
}

function sortedUnique(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

async function ensureActivityStream(root) {
  await ensureActivityArchive(join(root, DEFAULT_ACTIVITY_ARCHIVE));
}

async function listAnnotations({ root, mapPath, server, limit }) {
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

async function listAnnotationsFromServer(origin) {
  const response = await fetch(`${origin}/api/annotations`);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  const body = await response.json();
  return Array.isArray(body.annotations) ? body.annotations : [];
}

async function listAnnotationsFromStorage({ root, mapPath }) {
  const storePath = join(root, ".codecharter", "named-places.json");
  const store = await readOptionalJson(storePath) ?? { places: [] };
  const codemap = await readOptionalJson(mapPath);
  return store.places
    .filter((place) => place.kind === "mapAnnotation")
    .map((annotation) => codemap ? refreshPlaceResolution(codemap, annotation) : annotation);
}

async function readAnnotation({ root, mapPath, reference, server }) {
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

async function readAnnotationFromStorage({ root, mapPath, id }) {
  const storePath = join(root, ".codecharter", "named-places.json");
  const store = await readOptionalJson(storePath) ?? { places: [] };
  const annotation = store.places.find((place) => place.kind === "mapAnnotation" && place.id === id);
  if (!annotation) throw new Error(`No annotation found for id: ${id}`);

  const codemap = await readOptionalJson(mapPath);
  return codemap ? refreshPlaceResolution(codemap, annotation) : annotation;
}

function annotationEnvelope(annotation, metadata) {
  return {
    ...metadata,
    annotation,
    resolvedTargets: annotation.resolvedTargets ?? [],
    targetCount: annotation.resolvedTargets?.length ?? 0,
  };
}

async function readApi({ reference, server }) {
  const url = apiUrl(reference, server);
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

function apiUrl(reference, server) {
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

function parseAnnotationReference(reference) {
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

function normalizeOrigin(value) {
  if (!value) return undefined;
  const url = new URL(value);
  return url.origin;
}

async function packageMetadata() {
  const packagePath = fileURLToPath(new URL("../package.json", import.meta.url));
  return JSON.parse(await readFile(packagePath, "utf8"));
}

async function pathStatus(path, expectedType) {
  try {
    const stats = await stat(path);
    return {
      path,
      exists: true,
      type: stats.isDirectory() ? "directory" : stats.isFile() ? "file" : "other",
      ok: expectedType === "directory" ? stats.isDirectory() : expectedType === "file" ? stats.isFile() : true,
    };
  } catch (error) {
    if (error.code === "ENOENT") return { path, exists: false, ok: false };
    throw error;
  }
}

async function jsonFileStatus(path) {
  try {
    await access(path);
  } catch (error) {
    if (error.code === "ENOENT") return { path, exists: false, ok: false };
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
      error: error.message,
    };
  }
}

async function probeServer(origin) {
  try {
    const response = await fetch(`${origin}/api/map-version`);
    if (!response.ok) return { configured: true, origin, ok: false, status: response.status };
    return { configured: true, origin, ok: true, status: response.status, mapVersion: await response.json() };
  } catch (error) {
    return { configured: true, origin, ok: false, error: error.message };
  }
}

function printDoctor(result) {
  console.log(`version: ${result.version}`);
  console.log(`root: ${result.root}`);
  console.log(`map: ${displayPath(result.root, result.mapPath)}`);
  console.log(`setup: ${result.setup.ready ? "ready" : "missing"}`);
  if (result.setup.missing.length) console.log(`missing: ${result.setup.missing.join(",")}`);
  console.log(`fallback: ${result.checks.cli.recommendedCommand}`);
  if (result.setup.nextStep) console.log(`next: ${result.setup.nextStep.replace(/^Run `(.+)` from the target repo\.$/, "$1")}`);
}

function printResult(value, jsonOutput, printPlain) {
  if (jsonOutput) printJson(value);
  else printPlain(value);
}

function printResolvedAddress(address) {
  console.log(`target: ${address.targetType}`);
  console.log(`path: ${address.path}`);
  if (address.lineRange) console.log(`lines: ${address.lineRange.start}-${address.lineRange.end}`);
  if (address.tokenRange) console.log(`columns: ${address.tokenRange.start}-${address.tokenRange.end}`);
  console.log(`geohash: ${address.geohash}`);
  console.log(`link: ${address.deepLink}`);
}

function printAnnotation(result) {
  console.log(`annotation: ${result.annotation.id}`);
  console.log(`source: ${result.source}`);
  if (result.origin) console.log(`origin: ${result.origin}`);
  console.log(`targets: ${result.targetCount}`);
  if (result.annotation.comment) console.log(`note: ${singleLine(result.annotation.comment)}`);
  for (const target of result.resolvedTargets.slice(0, 12)) {
    console.log(`target: ${target.path}${target.lineRange ? `:${target.lineRange.start}-${target.lineRange.end}` : ""}`);
  }
  if (result.targetCount > 12) console.log(`more: ${result.targetCount - 12}`);
  console.log(`json: codecharter --json annotation ${result.annotation.deepLink}`);
}

function printAnnotations(result) {
  console.log(`source: ${result.source}`);
  if (result.origin) console.log(`origin: ${result.origin}`);
  console.log(`annotations: ${result.count}`);
  if (result.totalCount !== result.count) console.log(`total: ${result.totalCount}`);
  for (const annotation of result.annotations) {
    console.log(`annotation: ${annotation.id} targets=${annotation.resolvedTargets?.length ?? 0} note=${singleLine(annotation.comment ?? annotation.name ?? "")}`);
  }
}

function printSource(result) {
  console.log(`source: ${result.path}`);
  console.log(`lines: ${result.lineRange.start}-${result.lineRange.end}`);
  for (const line of result.lines ?? []) {
    console.log(`${line.number}: ${line.text}`);
  }
}

function printApi(result) {
  console.log(`method: ${result.method}`);
  console.log(`status: ${result.status}`);
  console.log(`url: ${result.url}`);
  if (result.body && typeof result.body === "object" && !Array.isArray(result.body)) {
    console.log(`keys: ${Object.keys(result.body).sort().join(",")}`);
  } else if (result.body !== null && result.body !== undefined) {
    console.log(`body: ${singleLine(String(result.body))}`);
  }
}

function printActivityResult(result) {
  console.log(`accepted: ${result.accepted ? "true" : "false"}`);
  if (result.event) {
    console.log(`event: ${result.event.id}`);
    console.log(`state: ${result.event.activityState}`);
    console.log(`path: ${result.event.address?.path}`);
  }
  if (result.error) console.log(`error: ${result.error}`);
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function singleLine(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function displayPath(root, path) {
  const relativePath = relative(root, path);
  return relativePath && !relativePath.startsWith("..") && !isAbsolute(relativePath) ? relativePath : path;
}

function resolveMapPath(root, path) {
  return isAbsolute(path) ? path : resolvePath(root, path);
}

function optionalNumber(value) {
  return value === undefined ? undefined : Number(value);
}

async function readPreviousCodemap(root, out) {
  const current = await readOptionalJson(out);
  if (current) return current;
  if (relative(root, out) === DEFAULT_MAP_FILE) {
    return await readOptionalJson(join(root, ROOT_MAP_FILE)) ?? await readOptionalJson(join(root, LEGACY_MAP_FILE));
  }
  return undefined;
}

async function resolveCliMapPath(option) {
  if (option) return resolvePath(option);
  if (await readOptionalJson(resolvePath(DEFAULT_MAP_FILE))) return resolvePath(DEFAULT_MAP_FILE);
  if (await readOptionalJson(resolvePath(ROOT_MAP_FILE))) return resolvePath(ROOT_MAP_FILE);
  return resolvePath(LEGACY_MAP_FILE);
}

async function confirm(question, fallback) {
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

async function readStdin() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  return raw;
}

main().catch((error) => {
  if (process.argv.slice(2).includes("--json")) {
    printJson({ ok: false, error: { message: error.message } });
  } else {
    console.error(error.message);
  }
  process.exitCode = 1;
});
