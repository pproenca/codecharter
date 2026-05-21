#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve as resolvePath } from "node:path";
import { createActivityEvent } from "../src/activity.js";
import { appendActivityEvents, ensureActivityArchive } from "../src/activity-store.js";
import { startActivityWatcher } from "../src/activity-watcher.js";
import { runCodexHook } from "../src/codex-hook.js";
import { generateCodemap } from "../src/generator.js";
import { initializeCodecharter } from "../src/init.js";
import { ensureLocalGitExcludes } from "../src/local-git-exclude.js";
import { resolveAddress } from "../src/resolver.js";
import { startServer } from "../src/server.js";
import { writeJson } from "../src/store.js";

const DEFAULT_MAP_FILE = "codecharter.json";
const LEGACY_MAP_FILE = "codemap.json";
const DEFAULT_ACTIVITY_ARCHIVE = ".scratch/codecharter/activity.jsonl";
const METADATA_EXCLUDE_PATHS = [
  DEFAULT_MAP_FILE,
  LEGACY_MAP_FILE,
  ".codecharter/config.json",
  ".codex/hooks.json",
  ".codex/hooks/codecharter-codex-hook.mjs",
];

function usage() {
  return `Usage:
  codecharter init [--root <dir>] [--out <file>] [--fresh] [--yes] [--no-codex] [--no-git-hooks]
  codecharter generate [--root <dir>] [--out <file>] [--fresh] [--quiet]
  codecharter dev [--root <dir>] [--map <file>] [--port <port>] [--agent <id>] [--no-watch] [--fresh]
  codecharter resolve <path> [lineStart] [lineEnd] [--column-start <n>] [--column-end <n>] [--map <file>]
  codecharter activity <path> [lineStart] [lineEnd] [--column-start <n>] [--column-end <n>] [--agent <id>] [--state <state>] [--note <text>] [--map <file>] [--out <file.jsonl>]
  codecharter codex-hook
  codecharter serve [--root <dir>] [--map <file>] [--port <port>]
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
  const command = args.shift();
  stripArgumentSeparator(args);

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
    const noCodex = takeFlag(args, "--no-codex");
    const noGitHooks = takeFlag(args, "--no-git-hooks");
    if (args.length > 0) throw new Error(`Unknown arguments: ${args.join(" ")}`);

    const installCodex = noCodex ? false : yes ? true : await confirm("Install Codex activity tracking hooks?", true);
    const installGitHooks = noGitHooks ? false : yes ? true : await confirm("Install local Git hooks to refresh the map?", true);
    await ensureLocalGitExcludes(root);
    await initializeCodecharter({
      root,
      mapPath: out,
      fresh,
      installCodex,
      installGitHooks,
      writeCodemap,
    });
    await ensureActivityStream(root);
    console.log("CodeCharter setup complete.");
    if (installCodex) console.log("Open `/hooks` in Codex to review and trust the repo-local hook.");
    console.log("Run `codecharter dev` to serve the map and stream local activity.");
    return;
  }

  if (command === "dev") {
    const root = resolvePath(takeOption(args, "--root", "."));
    const mapPath = resolveMapPath(root, takeOption(args, "--map", DEFAULT_MAP_FILE));
    const port = Number(takeOption(args, "--port", "4173"));
    const agentId = takeOption(args, "--agent", process.env.CODEMAP_AGENT_ID ?? "codex");
    const watch = !takeFlag(args, "--no-watch");
    const fresh = takeFlag(args, "--fresh");
    if (!Number.isInteger(port) || port < 1) throw new Error("Port must be a positive integer");
    if (args.length > 0) throw new Error(`Unknown arguments: ${args.join(" ")}`);

    await ensureLocalGitExcludes(root);
    let currentCodemap = await writeCodemap({ root, out: mapPath, fresh });
    await ensureActivityStream(root);
    const server = await startServer({ root, mapPath, port });
    const actualPort = server.address().port;
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
      console.log(`Activity watcher streaming git changes as ${agentId}`);
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
    console.log(JSON.stringify(address, null, 2));
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
      console.log(JSON.stringify({ accepted: true, event }, null, 2));
    } catch (error) {
      console.log(JSON.stringify({ accepted: false, error: error.message }, null, 2));
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
    if (!Number.isInteger(port) || port < 1) throw new Error("Port must be a positive integer");
    if (args.length > 0) throw new Error(`Unknown arguments: ${args.join(" ")}`);

    await startServer({ root, mapPath, port });
    return;
  }

  console.error(usage());
  process.exitCode = 1;
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
    console.log(`Wrote ${out}`);
    console.log(`Mapped ${Object.keys(codemap.files).length} files and ${Object.keys(codemap.folders).length} folders`);
  }
  return codemap;
}

function sortedUnique(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

async function ensureActivityStream(root) {
  await ensureActivityArchive(join(root, DEFAULT_ACTIVITY_ARCHIVE));
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
  if (relative(root, out) === DEFAULT_MAP_FILE) return readOptionalJson(join(root, LEGACY_MAP_FILE));
  return undefined;
}

async function resolveCliMapPath(option) {
  if (option) return resolvePath(option);
  if (await readOptionalJson(resolvePath(DEFAULT_MAP_FILE))) return resolvePath(DEFAULT_MAP_FILE);
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
  console.error(error.message);
  process.exitCode = 1;
});
