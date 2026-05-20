#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve as resolvePath } from "node:path";
import { createActivityEvent } from "../src/activity.js";
import { appendActivityEvents, ensureActivityArchive } from "../src/activity-store.js";
import { startActivityWatcher } from "../src/activity-watcher.js";
import { generateCodemap } from "../src/generator.js";
import { ensureLocalGitExcludes } from "../src/local-git-exclude.js";
import { resolveAddress } from "../src/resolver.js";
import { startServer } from "../src/server.js";
import { writeJson } from "../src/store.js";

function usage() {
  return `Usage:
  codemap generate [--root <dir>] [--out <file>]
  codemap setup [--root <dir>] [--out <file>] [--fresh]
  codemap dev [--root <dir>] [--map <file>] [--port <port>] [--agent <id>] [--no-watch] [--fresh]
  codemap resolve <path> [lineStart] [lineEnd] [--column-start <n>] [--column-end <n>] [--map <file>]
  codemap activity <path> [lineStart] [lineEnd] [--column-start <n>] [--column-end <n>] [--agent <id>] [--state <state>] [--note <text>] [--map <file>] [--out <file.jsonl>]
  codemap serve [--root <dir>] [--map <file>] [--port <port>]
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

  if (command === "generate") {
    const root = resolvePath(takeOption(args, "--root", "."));
    const out = resolveMapPath(root, takeOption(args, "--out", "codemap.json"));
    const fresh = takeFlag(args, "--fresh");
    if (args.length > 0) throw new Error(`Unknown arguments: ${args.join(" ")}`);

    await writeCodemap({ root, out, fresh });
    return;
  }

  if (command === "setup") {
    const root = resolvePath(takeOption(args, "--root", "."));
    const out = resolveMapPath(root, takeOption(args, "--out", "codemap.json"));
    const fresh = takeFlag(args, "--fresh");
    if (args.length > 0) throw new Error(`Unknown arguments: ${args.join(" ")}`);

    await ensureLocalGitExcludes(root);
    await writeCodemap({ root, out, fresh });
    await ensureActivityStream(root);
    console.log("Setup complete.");
    console.log("Run `npm run dev` to serve the map and stream local Codex activity.");
    return;
  }

  if (command === "dev") {
    const root = resolvePath(takeOption(args, "--root", "."));
    const mapPath = resolveMapPath(root, takeOption(args, "--map", "codemap.json"));
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
            note: "codemap dev watcher",
          };
        },
      });
      console.log(`Activity watcher streaming git changes as ${agentId}`);
    }
    return;
  }

  if (command === "resolve") {
    const mapPath = resolvePath(takeOption(args, "--map", "codemap.json"));
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
      const mapPath = resolvePath(takeOption(args, "--map", "codemap.json"));
      const outPath = resolvePath(takeOption(args, "--out", ".scratch/activity-stream.jsonl"));
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

  if (command === "serve") {
    const root = resolvePath(takeOption(args, "--root", "."));
    const mapPath = resolveMapPath(root, takeOption(args, "--map", "codemap.json"));
    const port = Number(takeOption(args, "--port", "4173"));
    if (!Number.isInteger(port) || port < 1) throw new Error("Port must be a positive integer");
    if (args.length > 0) throw new Error(`Unknown arguments: ${args.join(" ")}`);

    await startServer({ root, mapPath, port });
    return;
  }

  console.error(usage());
  process.exitCode = 1;
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
  const previousCodemap = fresh ? undefined : await readOptionalJson(out);
  const codemap = await generateCodemap({ root, excludePaths: [relative(root, out)], previousCodemap });
  await writeJson(out, codemap);
  if (!quiet) {
    console.log(`Wrote ${out}`);
    console.log(`Mapped ${Object.keys(codemap.files).length} files and ${Object.keys(codemap.folders).length} folders`);
  }
  return codemap;
}

async function ensureActivityStream(root) {
  await ensureActivityArchive(join(root, ".scratch", "activity-stream.jsonl"));
}

function resolveMapPath(root, path) {
  return isAbsolute(path) ? path : resolvePath(root, path);
}

function optionalNumber(value) {
  return value === undefined ? undefined : Number(value);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
