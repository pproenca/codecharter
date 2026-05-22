import { execFile } from "node:child_process";
import type { ExecFileOptions } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { changedCodeChanges, changedLineRange } from "./activity-watcher.ts";
import { appendActivityEvents, ensureActivityArchive } from "./activity-store.ts";
import { createActivityEvent } from "./activity.ts";
import { generateCodemap } from "./generator.ts";
import { normalizePathForMap, resolveAddress } from "./resolver.ts";
import { readJson, writeJson } from "./store.ts";
import type { ActivityStateInput } from "./activity.js";
import type { StoredActivityEvent } from "./activity-store.js";
import type { CodeChange } from "./activity-watcher.js";
import type { AddressRequest } from "./resolver.js";
import type { CodecharterCodemap } from "./resolver.js";

type ExecFileTextOptions = Omit<ExecFileOptions, "encoding"> & {
  encoding?: BufferEncoding;
};
type ExecFileAsync = (
  file: string,
  args: readonly string[],
  options: ExecFileTextOptions,
) => Promise<{ stdout: string; stderr: string }>;

const execFileAsync: ExecFileAsync = (file, args, options) =>
  new Promise((resolve, reject) => {
    execFile(file, [...args], { ...options, encoding: options.encoding ?? "utf8" }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
const DEFAULT_CONFIG_PATH = ".codecharter/config.json";
const DEFAULT_MAP_PATH = ".codecharter/codecharter.json";
const ROOT_MAP_PATH = "codecharter.json";
const LEGACY_MAP_PATH = "codemap.json";
const DEFAULT_ACTIVITY_PATH = ".codecharter/activity.jsonl";
const DEFAULT_CHANGE_RANGE_CONCURRENCY = 32;
type HookPayload = Record<string, unknown> & {
  cwd?: string;
  hook_event_name?: string;
  session_id?: string;
  turn_id?: string;
  model?: string;
  source?: string;
  tool_name?: string;
  tool_input?: unknown;
  thread_id?: string;
  threadId?: string;
  codex_thread_id?: string;
  thread_uri?: string;
  threadUri?: string;
  thread?: { id?: string; uri?: string };
};

type CodexHookConfig = {
  mapPath?: string;
  activityPath?: string;
  agents?: {
    codex?: {
      activityPath?: string;
    };
  };
};

type ReadLineRange = {
  lineStart?: number;
  lineEnd?: number;
};

type ReadCommandContext = {
  root: string;
  commandName: string;
  tokens: string[];
  codemap: CodecharterCodemap;
};

type ReadCommandStrategy = {
  pathCandidates(context: ReadCommandContext): string[];
  lineRange(context: ReadCommandContext): ReadLineRange;
};

type CodexChange = Omit<CodeChange, "signature"> & {
  signature?: string;
  activityState?: ActivityStateInput;
  note?: string;
};
type RunCodexHookOptions = {
  input?: string;
  cwd?: string;
};
type CodexHookEventsOptions = {
  root: string;
  mapPath: string;
  payload: HookPayload;
};
type HookEventBase = {
  agentId: string;
  hookEventName?: string;
  sessionId?: string;
  threadId?: string;
  threadUri?: string;
  turnId?: string;
  model?: string;
};
type HeartbeatInput = HookEventBase & {
  activityState: ActivityStateInput;
  note: string;
};
type ToolInputPathStrategy = {
  matches(toolName: string): boolean;
  paths(input: unknown): string[];
};

const GENERIC_READ_COMMAND_STRATEGY: ReadCommandStrategy = { pathCandidates: genericReadPathCandidates, lineRange: emptyLineRange };
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

const READ_COMMAND_STRATEGIES: Map<string, ReadCommandStrategy> = new Map([
  ["cat", GENERIC_READ_COMMAND_STRATEGY],
  ["nl", GENERIC_READ_COMMAND_STRATEGY],
  ["less", GENERIC_READ_COMMAND_STRATEGY],
  ["head", { pathCandidates: optionAwareReadPathCandidates, lineRange: headLineRange }],
  ["tail", { pathCandidates: optionAwareReadPathCandidates, lineRange: tailLineRange }],
  ["sed", { pathCandidates: sedPathCandidates, lineRange: sedLineRange }],
  ["rg", { pathCandidates: ripgrepPathCandidates, lineRange: emptyLineRange }],
]);

const TOOL_INPUT_PATH_STRATEGIES: ToolInputPathStrategy[] = [
  {
    matches: (toolName: string) => toolName.includes("apply_patch"),
    paths: (input: unknown) => applyPatchPaths(toolInputText(input)),
  },
  {
    matches: isStructuredWriteTool,
    paths: structuredToolPaths,
  },
];
const READ_PATH_STOP_TOKENS = new Set(["|", ">", "2>"]);

export async function runCodexHook({ input = "", cwd = process.cwd() }: RunCodexHookOptions = {}) {
  const payload = parseHookPayload(input);
  const root = await resolveRoot(payload.cwd ?? cwd);
  const config = codexHookConfigFromValue(await readJson(join(root, DEFAULT_CONFIG_PATH), {}));
  const activityPath = resolveFromRoot(root, config.agents?.codex?.activityPath ?? config.activityPath ?? DEFAULT_ACTIVITY_PATH);
  const mapPath = await resolveMapPath(root, config.mapPath);
  const events = await codexHookEvents({ root, mapPath, payload });
  await ensureActivityArchive(activityPath);
  await appendActivityEvents(activityPath, events);
  return { accepted: true, eventsWritten: events.length, activityPath };
}

async function codexHookEvents({ root, mapPath, payload }: CodexHookEventsOptions): Promise<StoredActivityEvent[]> {
  const threadId = codexThreadId(payload);
  const threadUri = codexThreadUri(payload, threadId);
  const base = hookEventBase(payload, threadId, threadUri);

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
  const changes: CodexChange[] = [];
  for (const change of readChanges) changes.push(change);
  for (const change of writeChanges) changes.push(change);
  const events: StoredActivityEvent[] = [];
  for (const change of changes) {
    try {
      const address = resolveChangeAddress(codemap, previousCodemap, change);
      events.push(createActivityEvent(address, {
        id: randomUUID(),
        activityState: change.activityState ?? activityState,
        note: change.note ?? `Codex ${payload.tool_name ?? "tool"} activity`,
        ...hookEventBase(payload, threadId, threadUri),
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

function hookEventBase(payload: HookPayload, threadId: string | undefined, threadUri: string | undefined): HookEventBase {
  return {
    agentId: "codex",
    ...(payload.hook_event_name === undefined ? {} : { hookEventName: payload.hook_event_name }),
    ...(payload.session_id === undefined ? {} : { sessionId: payload.session_id }),
    ...(threadId === undefined ? {} : { threadId }),
    ...(threadUri === undefined ? {} : { threadUri }),
    ...(payload.turn_id === undefined ? {} : { turnId: payload.turn_id }),
    ...(payload.model === undefined ? {} : { model: payload.model }),
  };
}

async function refreshCodemap(root: string, mapPath: string, previousCodemap: CodecharterCodemap): Promise<CodecharterCodemap> {
  const codemap = await generateCodemap({ root, previousCodemap });
  await writeJson(mapPath, codemap);
  return codemap;
}

function resolveChangeAddress(
  codemap: CodecharterCodemap,
  previousCodemap: CodecharterCodemap,
  change: CodexChange,
) {
  try {
    return resolveAddress(codemap, change);
  } catch (error) {
    if (previousCodemap && previousCodemap !== codemap) {
      return resolveAddress(previousCodemap, change);
    }
    throw error;
  }
}

function heartbeatEvent(input: HeartbeatInput): StoredActivityEvent {
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

function codexThreadId(payload: HookPayload): string | undefined {
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

function codexThreadUri(payload: HookPayload, threadId: string | undefined): string | undefined {
  const explicit = payload.thread_uri ?? payload.threadUri ?? payload.thread?.uri ?? process.env.CODEX_THREAD_URI;
  if (explicit) return String(explicit);
  return threadId ? `codex://threads/${threadId}` : undefined;
}

function normalizeCodexThreadId(value: unknown): string | undefined {
  if (!value) return undefined;
  const text = String(value);
  const match = text.match(/^codex:\/\/threads\/([^/?#]+)/);
  return match ? match[1] : text;
}

function inferActivityState(payload: HookPayload): ActivityStateInput {
  if (!isShellTool(payload)) return "editing";
  const command = shellCommand(payload);
  if (/\b(pnpm|npm|yarn|bun)\s+(test|vitest|jest)\b/.test(command)) return "testing";
  if (/\b(vitest|jest|pytest|cargo\s+test|go\s+test|swift\s+test|xcodebuild\s+test)\b/.test(command)) return "testing";
  return "editing";
}

function readCommandActivity(root: string, codemap: CodecharterCodemap, payload: HookPayload): { changes: CodexChange[]; matchedReadCommand: boolean } {
  if (!isShellTool(payload)) return { changes: [], matchedReadCommand: false };
  const command = shellCommand(payload);
  if (!command) return { changes: [], matchedReadCommand: false };

  const changes: CodexChange[] = [];
  const seen = new Set<string>();
  let matchedReadCommand = false;
  for (const segment of commandSegments(command)) {
    const tokens = shellWords(segment);
    if (tokens.length === 0) continue;
    const commandToken = tokens[0];
    if (!commandToken) continue;
    const commandName = basename(commandToken);
    const strategy = readCommandStrategy(commandName);
    if (!strategy) continue;
    matchedReadCommand = true;

    const lineRange = strategy.lineRange({ root, commandName, tokens, codemap });
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

function* commandSegments(command: string): Generator<string> {
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

function isShellTool(payload: HookPayload): boolean {
  const toolName = String(payload.tool_name ?? "");
  return toolName === "Bash"
    || toolName === "bash"
    || toolName === "shell"
    || toolName === "exec_command"
    || toolName === "functions.exec_command"
    || toolName.endsWith(".exec_command");
}

function shellCommand(payload: HookPayload): string {
  return findShellCommand(payload.tool_input);
}

function findShellCommand(value: unknown): string {
  if (typeof value === "string") return value;
  const record = objectRecord(value);
  if (!record) return "";

  for (const key of ["command", "cmd", "script"]) {
    if (typeof record[key] === "string") return record[key];
  }

  for (const key of ["input", "arguments", "args"]) {
    const nested = record[key];
    if (typeof nested === "string") {
      const parsed = parseHookPayload(nested);
      if (parsed && typeof parsed === "object" && hasOwnEnumerableProperty(parsed)) {
        const parsedCommand: string = findShellCommand(parsed);
        if (parsedCommand) return parsedCommand;
      }
      return nested;
    }

    const nestedCommand: string = findShellCommand(nested);
    if (nestedCommand) return nestedCommand;
  }

  for (const key in record) {
    if (!Object.hasOwn(record, key)) continue;
    const child = record[key];
    const nestedCommand: string = findShellCommand(child);
    if (nestedCommand) return nestedCommand;
  }

  return "";
}

async function toolInputChanges(root: string, payload: HookPayload): Promise<CodexChange[]> {
  const paths = toolInputPaths(root, payload);
  return mapChangedRanges(root, paths, DEFAULT_CHANGE_RANGE_CONCURRENCY);
}

async function mapChangedRanges(root: string, paths: string[], concurrency: number): Promise<CodexChange[]> {
  const changes = new Array<CodexChange>(paths.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(paths.length, concurrency));
  const workers: Promise<void>[] = [];
  for (let worker = 0; worker < workerCount; worker += 1) {
    workers.push((async () => {
      while (next < paths.length) {
        const index = next;
        next += 1;
        const path = paths[index];
        if (path !== undefined) {
          changes[index] = {
            path,
            ...await changedLineRange(root, path),
          };
        }
      }
    })());
  }
  await Promise.all(workers);
  return changes;
}

function toolInputPaths(root: string, payload: HookPayload): string[] {
  const toolName = String(payload.tool_name ?? "").toLowerCase();
  const input = payload.tool_input ?? {};
  const paths = new Set<string>();

  for (const strategy of TOOL_INPUT_PATH_STRATEGIES) {
    if (!strategy.matches(toolName)) continue;
    for (const path of strategy.paths(input)) {
      paths.add(normalizeCommandPath(root, path));
    }
  }

  const result: string[] = [];
  for (const path of paths) {
    if (path) result.push(path);
  }
  return result;
}

function isStructuredWriteTool(toolName: string): boolean {
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

function toolInputText(input: unknown): string {
  let text = "";
  const record = objectRecord(input);
  if (!record) return text;
  for (const key of ["command", "cmd", "patch", "input"]) {
    const value = record[key];
    if (typeof value !== "string") continue;
    text = text ? `${text}\n${value}` : value;
  }
  return text;
}

function applyPatchPaths(text: string): string[] {
  const paths: string[] = [];
  for (const match of text.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) {
    const path = match[1]?.trim();
    if (path) paths.push(path);
  }
  return paths;
}

function structuredToolPaths(value: unknown): string[] {
  const paths: string[] = [];
  collectStructuredToolPaths(value, paths);
  return paths;
}

function collectStructuredToolPaths(value: unknown, paths: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectStructuredToolPaths(item, paths);
    return;
  }
  const record = objectRecord(value);
  if (!record) return;

  for (const key in record) {
    if (!Object.hasOwn(record, key)) continue;
    const child = record[key];
    if (isPathKey(key) && typeof child === "string") {
      paths.push(child);
      continue;
    }
    if (child && typeof child === "object") collectStructuredToolPaths(child, paths);
  }
}

function isPathKey(key: string): boolean {
  return /^(file_?path|path|filename)$/i.test(key);
}

function shellWords(segment: string): string[] {
  const words: string[] = [];
  for (const match of segment.matchAll(/"([^"]*)"|'([^']*)'|[^\s]+/g)) {
    words.push(match[1] ?? match[2] ?? match[0]);
  }
  return words;
}

function readCommandStrategy(commandName: string): ReadCommandStrategy | null {
  return READ_COMMAND_STRATEGIES.get(commandName) ?? null;
}

function readCommandPathCandidates(commandName: string, tokens: string[], codemap: CodecharterCodemap, root = ""): string[] {
  const strategy = readCommandStrategy(commandName);
  return strategy ? strategy.pathCandidates({ root, commandName, tokens, codemap }) : [];
}

function genericReadPathCandidates({ tokens }: ReadCommandContext): string[] {
  return readPathCandidateTokens(tokens, { optionConsumesNext: null });
}

function optionAwareReadPathCandidates({ tokens }: ReadCommandContext): string[] {
  return readPathCandidateTokens(tokens);
}

function sedPathCandidates({ tokens }: ReadCommandContext): string[] {
  return readPathCandidateTokens(tokens, { reject: looksLikeSedScript });
}

function readPathCandidateTokens(
  tokens: string[],
  { optionConsumesNext = readOptionConsumesNext, reject = () => false }: {
    optionConsumesNext?: ((token: string) => boolean) | null;
    reject?: (token: string) => boolean;
  } = {},
): string[] {
  const candidates: string[] = [];
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

function ripgrepPathCandidates({ tokens, codemap }: ReadCommandContext): string[] {
  const candidates: string[] = [];
  const positionals: string[] = [];
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

function readOptionConsumesNext(token: string): boolean {
  return READ_OPTIONS_WITH_VALUE.has(token);
}

function rgOptionConsumesNext(token: string): boolean {
  return RG_OPTIONS_WITH_VALUE.has(token);
}

function emptyLineRange(_context: ReadCommandContext): ReadLineRange {
  return {};
}

function sedLineRange({ tokens }: ReadCommandContext): ReadLineRange {
  for (const token of tokens) {
    const range = token.match(/^(\d+)(?:,(\d+))?p$/);
    if (range) {
      const lineStart = Number(range[1]);
      return { lineStart, lineEnd: Number(range[2] ?? range[1]) };
    }
  }
  return {};
}

function headLineRange({ tokens }: ReadCommandContext): ReadLineRange {
  const count = numericOption(tokens, "-n");
  if (count) return { lineStart: 1, lineEnd: count };
  return {};
}

function tailLineRange({ root, tokens, codemap }: ReadCommandContext): ReadLineRange {
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

function numericOption(tokens: string[], name: string): number | undefined {
  let compact: string | undefined;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    if (token === name) return Number(tokens[index + 1]);
    if (compact === undefined && token.startsWith(name) && token.length > name.length) compact = token;
  }
  return compact ? Number(compact.slice(name.length)) : undefined;
}

function looksLikeSedScript(token: string): boolean {
  return /^\d+(?:,\d+)?p$/.test(token) || /^s([^A-Za-z0-9\s]).*\1/.test(token);
}

function normalizeCommandPath(root: string, candidate: string): string {
  const stripped = candidate.replace(/^['"]|['"]$/g, "");
  const normalized = isAbsolute(stripped) ? relative(root, stripped) : stripped;
  return normalizePathForMap(normalized);
}

function parseHookPayload(input: string): HookPayload {
  try {
    return input ? JSON.parse(input) : {};
  } catch {
    return {};
  }
}

function hasOwnEnumerableProperty(value: object): boolean {
  for (const key in value) {
    if (Object.hasOwn(value, key)) return true;
  }
  return false;
}

async function readCodemap(mapPath: string): Promise<CodecharterCodemap> {
  return JSON.parse(await readFile(mapPath, "utf8"));
}

async function resolveMapPath(root: string, configuredPath?: string): Promise<string> {
  const candidates: string[] = [];
  for (const path of [configuredPath, DEFAULT_MAP_PATH, ROOT_MAP_PATH, LEGACY_MAP_PATH]) {
    if (path) candidates.push(resolveFromRoot(root, path));
  }

  for (const candidate of candidates) {
    try {
      await readFile(candidate, "utf8");
      return candidate;
    } catch (error) {
      if (!isErrnoException(error) || error.code !== "ENOENT") throw error;
    }
  }

  return resolveFromRoot(root, configuredPath ?? DEFAULT_MAP_PATH);
}

async function resolveRoot(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd });
    return stdout.trim() || cwd;
  } catch {
    return cwd;
  }
}

function resolveFromRoot(root: string, path: string): string {
  return isAbsolute(path) ? path : resolve(root, path);
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : null;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

function codexHookConfigFromValue(value: unknown): CodexHookConfig {
  const record = objectRecord(value);
  if (!record) return {};
  const agents = codexHookAgentsFromValue(record.agents);
  return {
    ...(typeof record.mapPath === "string" ? { mapPath: record.mapPath } : {}),
    ...(typeof record.activityPath === "string" ? { activityPath: record.activityPath } : {}),
    ...(agents ? { agents } : {}),
  };
}

function codexHookAgentsFromValue(value: unknown): CodexHookConfig["agents"] | undefined {
  const record = objectRecord(value);
  if (!record) return undefined;
  const codex = objectRecord(record.codex);
  if (!codex) return {};
  return {
    codex: {
      ...(typeof codex.activityPath === "string" ? { activityPath: codex.activityPath } : {}),
    },
  };
}
