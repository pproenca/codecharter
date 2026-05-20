#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { relative, resolve as resolvePath } from "node:path";
import { createActivityEvent } from "../src/activity.js";
import { generateCodemap } from "../src/generator.js";
import { resolveAddress } from "../src/resolver.js";
import { startServer } from "../src/server.js";
import { readJson, writeJson } from "../src/store.js";

function usage() {
  return `Usage:
  codemap generate [--root <dir>] [--out <file>]
  codemap resolve <path> [lineStart] [lineEnd] [--map <file>]
  codemap activity <path> [lineStart] [lineEnd] [--agent <id>] [--state <state>] [--note <text>] [--map <file>] [--out <file>]
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

async function main() {
  const args = process.argv.slice(2);
  const command = args.shift();

  if (command === "generate") {
    const root = resolvePath(takeOption(args, "--root", "."));
    const out = resolvePath(takeOption(args, "--out", "codemap.json"));
    const fresh = args.includes("--fresh");
    if (fresh) args.splice(args.indexOf("--fresh"), 1);
    if (args.length > 0) throw new Error(`Unknown arguments: ${args.join(" ")}`);

    const previousCodemap = fresh ? undefined : await readOptionalJson(out);
    const codemap = await generateCodemap({ root, excludePaths: [relative(root, out)], previousCodemap });
    await writeFile(out, `${JSON.stringify(codemap, null, 2)}\n`);
    console.log(`Wrote ${out}`);
    console.log(`Mapped ${Object.keys(codemap.files).length} files and ${Object.keys(codemap.folders).length} folders`);
    return;
  }

  if (command === "resolve") {
    const mapPath = resolvePath(takeOption(args, "--map", "codemap.json"));
    const [path, lineStartRaw, lineEndRaw] = args;
    if (!path) throw new Error("resolve requires a path");

    const codemap = JSON.parse(await readFile(mapPath, "utf8"));
    const lineStart = lineStartRaw === undefined ? undefined : Number(lineStartRaw);
    const lineEnd = lineEndRaw === undefined ? lineStart : Number(lineEndRaw);
    const address = resolveAddress(codemap, { path, lineStart, lineEnd });
    console.log(JSON.stringify(address, null, 2));
    return;
  }

  if (command === "activity") {
    const mapPath = resolvePath(takeOption(args, "--map", "codemap.json"));
    const outPath = resolvePath(takeOption(args, "--out", ".scratch/activity-stream.json"));
    const agentId = takeOption(args, "--agent", "codex");
    const activityState = takeOption(args, "--state", "editing");
    const note = takeOption(args, "--note", "");
    const [path, lineStartRaw, lineEndRaw] = args;
    if (!path) throw new Error("activity requires a path");

    const codemap = JSON.parse(await readFile(mapPath, "utf8"));
    const lineStart = lineStartRaw === undefined ? undefined : Number(lineStartRaw);
    const lineEnd = lineEndRaw === undefined ? lineStart : Number(lineEndRaw);
    const address = resolveAddress(codemap, { path, lineStart, lineEnd });
    const event = createActivityEvent(address, { agentId, activityState, note });
    const stream = await readJson(outPath, { events: [] });
    stream.events.push(event);
    await writeJson(outPath, stream);
    console.log(JSON.stringify(event, null, 2));
    return;
  }

  if (command === "serve") {
    const root = resolvePath(takeOption(args, "--root", "."));
    const mapPath = resolvePath(takeOption(args, "--map", "codemap.json"));
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

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
