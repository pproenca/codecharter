import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { changedCodeChanges, changedLineRange } from "./activity-watcher.js";
import { appendActivityEvents, ensureActivityArchive } from "./activity-store.js";
import { createActivityEvent } from "./activity.js";
import { generateCodemap } from "./generator.js";
import { normalizePathForMap, resolveAddress } from "./resolver.js";
import { readJson, writeJson } from "./store.js";

const execFileAsync = promisify(execFile);
const DEFAULT_CONFIG_PATH = ".codecharter/config.json";
const DEFAULT_MAP_PATH = ".codecharter/codecharter.json";
const ROOT_MAP_PATH = "codecharter.json";
const LEGACY_MAP_PATH = "codemap.json";
const DEFAULT_ACTIVITY_PATH = ".codecharter/activity.jsonl";
const DEFAULT_CHANGE_RANGE_CONCURRENCY = 32;
const GENERIC_READ_COMMAND_STRATEGY = { pathCandidates: genericReadPathCandidates, lineRange: emptyLineRange };
const READ_OPTIONS_WITH_VALUE = new Set(["-n", "--lines", "-e", "--expression"]);
const RG_OPTIONS_WITH_VALUE = new Set([
  "-e",
  "--regexp",
  "-g",
  "--glob",
  "-t",
  "--type",
  "-T",
  "--type-not",
  "-m",
  "--max-count",
  "-A",
  "--after-context",
  "-B",
  "--before-context",
  "-C",
  "--context",
]);

const READ_COMMAND_STRATEGIES = new Map([
  ["cat", GENERIC_READ_COMMAND_STRATEGY],
  ["nl", GENERIC_READ_COMMAND_STRATEGY],
  ["less", GENERIC_READ_COMMAND_STRATEGY],
  ["head", { pathCandidates: optionAwareReadPathCandidates, lineRange: headLineRange }],
  ["tail", { pathCandidates: optionAwareReadPathCandidates, lineRange: tailLineRange }],
  ["sed", { pathCandidates: sedPathCandidates, lineRange: sedLineRange }],
  ["rg", { pathCandidates: ripgrepPathCandidates, lineRange: emptyLineRange }],
]);

const TOOL_INPUT_PATH_STRATEGIES = [
  {
    matches: (toolName) => toolName.includes("apply_patch"),
    paths: (input) => applyPatchPaths(toolInputText(input)),
  },
  {
    matches: isStructuredWriteTool,
    paths: structuredToolPaths,
  },
];
const READ_PATH_STOP_TOKENS = new Set(["|", ">", "2>"]);

export async function runCodexHook({ input = "", cwd = process.cwd() } = {}) {
  const payload = parseHookPayload(input);
  const root = await resolveRoot(payload.cwd ?? cwd);
  const config = await readJson(join(root, DEFAULT_CONFIG_PATH), {});
  const activityPath = resolveFromRoot(root, config.agents?.codex?.activityPath ?? config.activityPath ?? DEFAULT_ACTIVITY_PATH);
  const mapPath = await resolveMapPath(root, config.mapPath);
  const events = await codexHookEvents({ root, mapPath, payload });
  await ensureActivityArchive(activityPath);
  await appendActivityEvents(activityPath, events);
  return { accepted: true, eventsWritten: events.length, activityPath };
}

async function codexHookEvents({ root, mapPath, payload }) {
  const threadId = codexThreadId(payload);
  const threadUri = codexThreadUri(payload, threadId);
  const base = {
    agentId: "codex",
    hookEventName: payload.hook_event_name,
    sessionId: payload.session_id,
    threadId,
    threadUri,
    turnId: payload.turn_id,
    model: payload.model,
  };

  if (payload.hook_event_name === "SessionStart") {
    return [heartbeatEvent({ ...base, activityState: "reading", note: `Codex session ${payload.source ?? "started"}` })];
  }

  if (payload.hook_event_name === "Stop") {
    return [heartbeatEvent({ ...base, activityState: "reviewing", note: "Codex turn stopped" })];
  }

  if (payload.hook_event_name !== "PostToolUse") return [];

  const activityState = inferActivityState(payload);
  let codemap = await readCodemap(mapPath);
  const readActivity = activityState === "testing"
    ? { changes: [], matchedReadCommand: false }
    : readCommandActivity(root, codemap, payload);
  const readChanges = readActivity.changes;
  let writeChanges = activityState === "testing" ? [] : await toolInputChanges(root, payload);
  if (writeChanges.length === 0 && readChanges.length === 0 && !readActivity.matchedReadCommand) {
    writeChanges = await changedCodeChanges(root);
  }
  const previousCodemap = codemap;
  if (writeChanges.length > 0) {
    codemap = await refreshCodemap(root, mapPath, previousCodemap);
  }
  const changes = [];
  for (const change of readChanges) changes.push(change);
  for (const change of writeChanges) changes.push(change);
  const events = [];
  for (const change of changes) {
    try {
      const address = resolveChangeAddress(codemap, previousCodemap, change);
      events.push(createActivityEvent(address, {
        id: randomUUID(),
        agentId: "codex",
        activityState: change.activityState ?? activityState,
        note: change.note ?? `Codex ${payload.tool_name ?? "tool"} activity`,
        hookEventName: payload.hook_event_name,
        sessionId: payload.session_id,
        threadId,
        threadUri,
        turnId: payload.turn_id,
        model: payload.model,
      }));
    } catch {
      // Unmapped paths are ignored; the map update hooks will catch up separately.
    }
  }
  if (events.length === 0 && activityState === "testing") {
    events.push(heartbeatEvent({ ...base, activityState, note: "Codex ran tests" }));
  }
  return events;
}

async function refreshCodemap(root, mapPath, previousCodemap) {
  const codemap = await generateCodemap({ root, previousCodemap });
  await writeJson(mapPath, codemap);
  return codemap;
}

function resolveChangeAddress(codemap, previousCodemap, change) {
  try {
    return resolveAddress(codemap, change);
  } catch (error) {
    if (previousCodemap && previousCodemap !== codemap) {
      return resolveAddress(previousCodemap, change);
    }
    throw error;
  }
}

function heartbeatEvent(input) {
  return {
    id: randomUUID(),
    agentId: input.agentId,
    activityState: input.activityState,
    timestamp: new Date().toISOString(),
    note: input.note,
    hookEventName: input.hookEventName,
    sessionId: input.sessionId,
    threadId: input.threadId,
    threadUri: input.threadUri,
    turnId: input.turnId,
    model: input.model,
  };
}

function codexThreadId(payload) {
  return normalizeCodexThreadId(
    payload.thread_id
      ?? payload.threadId
      ?? payload.codex_thread_id
      ?? payload.thread_uri
      ?? payload.threadUri
      ?? payload.thread?.id
      ?? payload.thread?.uri
      ?? payload.session_id
      ?? process.env.CODEX_THREAD_ID,
  );
}

function codexThreadUri(payload, threadId) {
  const explicit = payload.thread_uri ?? payload.threadUri ?? payload.thread?.uri ?? process.env.CODEX_THREAD_URI;
  if (explicit) return String(explicit);
  return threadId ? `codex://threads/${threadId}` : undefined;
}

function normalizeCodexThreadId(value) {
  if (!value) return undefined;
  const text = String(value);
  const match = text.match(/^codex:\/\/threads\/([^/?#]+)/);
  return match ? match[1] : text;
}

function inferActivityState(payload) {
  if (!isShellTool(payload)) return "editing";
  const command = shellCommand(payload);
  if (/\b(pnpm|npm|yarn|bun)\s+(test|vitest|jest)\b/.test(command)) return "testing";
  if (/\b(vitest|jest|pytest|cargo\s+test|go\s+test|swift\s+test|xcodebuild\s+test)\b/.test(command)) return "testing";
  return "editing";
}

function readCommandActivity(root, codemap, payload) {
  if (!isShellTool(payload)) return { changes: [], matchedReadCommand: false };
  const command = shellCommand(payload);
  if (!command) return { changes: [], matchedReadCommand: false };

  const changes = [];
  const seen = new Set();
  let matchedReadCommand = false;
  for (const segment of commandSegments(command)) {
    const tokens = shellWords(segment);
    if (tokens.length === 0) continue;
    const commandName = basename(tokens[0]);
    const strategy = readCommandStrategy(commandName);
    if (!strategy) continue;
    matchedReadCommand = true;

    const lineRange = strategy.lineRange({ root, tokens, codemap });
    for (const candidate of strategy.pathCandidates({ root, commandName, tokens, codemap })) {
      const path = normalizeCommandPath(root, candidate);
      if (!codemap.files?.[path] && !codemap.folders?.[path]) continue;
      const key = `${path}:${lineRange.lineStart ?? ""}:${lineRange.lineEnd ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      changes.push({
        path,
        ...lineRange,
        activityState: "reading",
        note: `Codex read ${path}`,
      });
    }
  }
  return { changes, matchedReadCommand };
}

function* commandSegments(command) {
  let start = 0;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (char !== "\n" && char !== ";") {
      if (char !== "&" || command[index + 1] !== "&") continue;
      yield command.slice(start, index);
      index += 1;
      start = index + 1;
      continue;
    }
    yield command.slice(start, index);
    start = index + 1;
  }
  yield command.slice(start);
}

function isShellTool(payload) {
  const toolName = String(payload.tool_name ?? "");
  return toolName === "Bash"
    || toolName === "bash"
    || toolName === "shell"
    || toolName === "exec_command"
    || toolName === "functions.exec_command"
    || toolName.endsWith(".exec_command");
}

function shellCommand(payload) {
  return findShellCommand(payload.tool_input);
}

function findShellCommand(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";

  for (const key of ["command", "cmd", "script"]) {
    if (typeof value[key] === "string") return value[key];
  }

  for (const key of ["input", "arguments", "args"]) {
    const nested = value[key];
    if (typeof nested === "string") {
      const parsed = parseHookPayload(nested);
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
        const parsedCommand = findShellCommand(parsed);
        if (parsedCommand) return parsedCommand;
      }
      return nested;
    }

    const nestedCommand = findShellCommand(nested);
    if (nestedCommand) return nestedCommand;
  }

  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    const child = value[key];
    const nestedCommand = findShellCommand(child);
    if (nestedCommand) return nestedCommand;
  }

  return "";
}

async function toolInputChanges(root, payload) {
  const paths = toolInputPaths(root, payload);
  return mapChangedRanges(root, paths, DEFAULT_CHANGE_RANGE_CONCURRENCY);
}

async function mapChangedRanges(root, paths, concurrency) {
  const changes = new Array(paths.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(paths.length, concurrency));
  const workers = [];
  for (let worker = 0; worker < workerCount; worker += 1) {
    workers.push((async () => {
      while (next < paths.length) {
        const index = next;
        next += 1;
        changes[index] = {
          path: paths[index],
          ...await changedLineRange(root, paths[index]),
        };
      }
    })());
  }
  await Promise.all(workers);
  return changes;
}

function toolInputPaths(root, payload) {
  const toolName = String(payload.tool_name ?? "").toLowerCase();
  const input = payload.tool_input ?? {};
  const paths = new Set();

  for (const strategy of TOOL_INPUT_PATH_STRATEGIES) {
    if (!strategy.matches(toolName)) continue;
    for (const path of strategy.paths(input)) {
      paths.add(normalizeCommandPath(root, path));
    }
  }

  const result = [];
  for (const path of paths) {
    if (path) result.push(path);
  }
  return result;
}

function isStructuredWriteTool(toolName) {
  return toolName === "edit"
    || toolName.endsWith(".edit")
    || toolName === "edit_file"
    || toolName.endsWith(".edit_file")
    || toolName === "write"
    || toolName.endsWith(".write")
    || toolName === "write_file"
    || toolName.endsWith(".write_file")
    || toolName.includes("multiedit")
    || toolName.includes("multi_edit");
}

function toolInputText(input) {
  let text = "";
  for (const key of ["command", "cmd", "patch", "input"]) {
    const value = input[key];
    if (typeof value !== "string") continue;
    text = text ? `${text}\n${value}` : value;
  }
  return text;
}

function applyPatchPaths(text) {
  const paths = [];
  for (const match of text.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) {
    const path = match[1].trim();
    if (path) paths.push(path);
  }
  return paths;
}

function structuredToolPaths(value) {
  const paths = [];
  collectStructuredToolPaths(value, paths);
  return paths;
}

function collectStructuredToolPaths(value, paths) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectStructuredToolPaths(item, paths);
    return;
  }

  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    const child = value[key];
    if (isPathKey(key) && typeof child === "string") {
      paths.push(child);
      continue;
    }
    if (child && typeof child === "object") collectStructuredToolPaths(child, paths);
  }
}

function isPathKey(key) {
  return /^(file_?path|path|filename)$/i.test(key);
}

function shellWords(segment) {
  const words = [];
  for (const match of segment.matchAll(/"([^"]*)"|'([^']*)'|[^\s]+/g)) {
    words.push(match[1] ?? match[2] ?? match[0]);
  }
  return words;
}

function readCommandStrategy(commandName) {
  return READ_COMMAND_STRATEGIES.get(commandName) ?? null;
}

function readCommandPathCandidates(commandName, tokens, codemap, root = "") {
  const strategy = readCommandStrategy(commandName);
  return strategy ? strategy.pathCandidates({ root, commandName, tokens, codemap }) : [];
}

function genericReadPathCandidates({ tokens }) {
  return readPathCandidateTokens(tokens, { optionConsumesNext: null });
}

function optionAwareReadPathCandidates({ tokens }) {
  return readPathCandidateTokens(tokens);
}

function sedPathCandidates({ tokens }) {
  return readPathCandidateTokens(tokens, { reject: looksLikeSedScript });
}

function readPathCandidateTokens(tokens, { optionConsumesNext = readOptionConsumesNext, reject = () => false } = {}) {
  const candidates = [];
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token || READ_PATH_STOP_TOKENS.has(token)) continue;
    if (optionConsumesNext?.(token)) {
      index += 1;
      continue;
    }
    if (token.startsWith("-")) continue;
    if (reject(token)) continue;
    candidates.push(token);
  }
  return candidates;
}

function ripgrepPathCandidates({ tokens, codemap }) {
  const candidates = [];
  const positionals = [];
  let patternConsumed = false;
  let filesMode = false;

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token || token === "|" || token === ">" || token === "2>") continue;
    if (token === "--files" || token === "--files-with-matches") {
      filesMode = true;
      continue;
    }
    if (rgOptionConsumesNext(token)) {
      index += 1;
      continue;
    }
    if (token.startsWith("-")) continue;
    positionals.push(token);
  }

  for (const positional of positionals) {
    const path = normalizeCommandPath("", positional);
    if (!filesMode && !patternConsumed && !codemap.files?.[path] && !codemap.folders?.[path]) {
      patternConsumed = true;
      continue;
    }
    candidates.push(positional);
  }

  return candidates;
}

function readOptionConsumesNext(token) {
  return READ_OPTIONS_WITH_VALUE.has(token);
}

function rgOptionConsumesNext(token) {
  return RG_OPTIONS_WITH_VALUE.has(token);
}

function emptyLineRange() {
  return {};
}

function sedLineRange({ tokens }) {
  for (const token of tokens) {
    const range = token.match(/^(\d+)(?:,(\d+))?p$/);
    if (range) {
      const lineStart = Number(range[1]);
      return { lineStart, lineEnd: Number(range[2] ?? range[1]) };
    }
  }
  return {};
}

function headLineRange({ tokens }) {
  const count = numericOption(tokens, "-n");
  if (count) return { lineStart: 1, lineEnd: count };
  return {};
}

function tailLineRange({ root, tokens, codemap }) {
  let path;
  for (const candidate of readCommandPathCandidates("tail", tokens, codemap, root)) {
    const normalized = normalizeCommandPath(root, candidate);
    if (codemap.files?.[normalized]) {
      path = normalized;
      break;
    }
  }
  const count = numericOption(tokens, "-n");
  const lineCount = path ? codemap.files[path]?.lineCount : undefined;
  if (count && lineCount) return { lineStart: Math.max(1, lineCount - count + 1), lineEnd: lineCount };

  return {};
}

function numericOption(tokens, name) {
  let compact;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === name) return Number(tokens[index + 1]);
    if (compact === undefined && token.startsWith(name) && token.length > name.length) compact = token;
  }
  return compact ? Number(compact.slice(name.length)) : undefined;
}

function looksLikeSedScript(token) {
  return /^\d+(?:,\d+)?p$/.test(token) || /^s([^A-Za-z0-9\s]).*\1/.test(token);
}

function normalizeCommandPath(root, candidate) {
  const stripped = candidate.replace(/^['"]|['"]$/g, "");
  const normalized = isAbsolute(stripped) ? relative(root, stripped) : stripped;
  return normalizePathForMap(normalized);
}

function parseHookPayload(input) {
  try {
    return input ? JSON.parse(input) : {};
  } catch {
    return {};
  }
}

async function readCodemap(mapPath) {
  return JSON.parse(await readFile(mapPath, "utf8"));
}

async function resolveMapPath(root, configuredPath) {
  const candidates = [];
  for (const path of [configuredPath, DEFAULT_MAP_PATH, ROOT_MAP_PATH, LEGACY_MAP_PATH]) {
    if (path) candidates.push(resolveFromRoot(root, path));
  }

  for (const candidate of candidates) {
    try {
      await readFile(candidate, "utf8");
      return candidate;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  return resolveFromRoot(root, configuredPath ?? DEFAULT_MAP_PATH);
}

async function resolveRoot(cwd) {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd });
    return stdout.trim() || cwd;
  } catch {
    return cwd;
  }
}

function resolveFromRoot(root, path) {
  return isAbsolute(path) ? path : resolve(root, path);
}
