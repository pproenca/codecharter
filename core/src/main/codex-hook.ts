/**
 * Codex agent hook entry: parse a hook payload from stdin, infer activity
 * (read / edit / test) over trusted local context, refresh the codemap on edits,
 * and append activity events.
 *
 * Implements **BR-040** (event allowlist + lenient parse), **BR-041** (touched
 * path must be on the map), **BR-042** (read-command classification), **BR-043**
 * (test detection), **BR-045** (state mapping + map-refresh side effect). Pure
 * re-point of imports onto `@codecharter/core`; behavior preserved.
 */

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { changedCodeChanges, changedLineRange } from "./activity-watcher.ts";
import { appendActivityEvents, ensureActivityArchive } from "./activity-store.ts";
import { createActivityEvent } from "./activity.ts";
import { execFileText } from "./exec-file.ts";
import { generateCodemap } from "./generator.ts";
import { normalizePathForMap, resolveAddress } from "./resolver.ts";
import { readJson, writeJson } from "./store.ts";
import { isErrnoException } from "./errors.ts";
import { mapConcurrent, objectRecord } from "./collections.ts";
import type { ActivityEventInput, ActivityStateInput } from "./activity.ts";
import type { StoredActivityEvent } from "./activity-store.ts";
import type { CodeChange } from "./activity-watcher.ts";
import type { CodecharterCodemap } from "./resolver.ts";

const DEFAULT_CONFIG_PATH = ".codecharter/config.json";
const DEFAULT_MAP_PATH = ".codecharter/codecharter.json";
const ROOT_MAP_PATH = "codecharter.json";
const LEGACY_MAP_PATH = "codemap.json";
const DEFAULT_ACTIVITY_PATH = ".codecharter/activity.jsonl";
const DEFAULT_CHANGE_RANGE_CONCURRENCY = 32;
const SHELL_TOOL_NAMES = new Set([
  "Bash",
  "bash",
  "shell",
  "exec_command",
  "functions.exec_command",
]);
const STRUCTURED_WRITE_TOOL_NAMES = ["edit", "edit_file", "write", "write_file"];

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
  agents?: { codex?: { activityPath?: string } };
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
type HookEventBase = Pick<
  ActivityEventInput,
  "hookEventName" | "sessionId" | "threadId" | "threadUri" | "turnId" | "model"
> & {
  agentId: string;
};
type ToolInputPathStrategy = {
  matches(toolName: string): boolean;
  paths(input: unknown): string[];
};
type ToolInvocation = {
  name: string;
  input: unknown;
};

const GENERIC_READ_COMMAND_STRATEGY: ReadCommandStrategy = {
  pathCandidates: genericReadPathCandidates,
  lineRange: emptyLineRange,
};
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
  const activityPath = resolveFromRoot(
    root,
    config.agents?.codex?.activityPath ?? config.activityPath ?? DEFAULT_ACTIVITY_PATH,
  );
  const mapPath = await resolveMapPath(root, config.mapPath);
  const events = await codexHookEvents({ root, mapPath, payload });
  await ensureActivityArchive(activityPath);
  await appendActivityEvents(activityPath, events);
  return { accepted: true, eventsWritten: events.length, activityPath };
}

async function codexHookEvents({
  root,
  mapPath,
  payload,
}: CodexHookEventsOptions): Promise<StoredActivityEvent[]> {
  const threadId = codexThreadId(payload);
  const threadUri = codexThreadUri(payload, threadId);
  const base = hookEventBase(payload, threadId, threadUri);

  if (payload.hook_event_name === "SessionStart") {
    return [
      heartbeatEvent({
        ...base,
        activityState: "reading",
        note: `Codex session ${payload.source ?? "started"}`,
      }),
    ];
  }

  if (payload.hook_event_name === "Stop") {
    return [heartbeatEvent({ ...base, activityState: "reviewing", note: "Codex turn stopped" })];
  }

  if (payload.hook_event_name !== "PostToolUse") {
    return [];
  }

  const activityState = inferActivityState(payload);
  let codemap = await readCodemap(mapPath);
  const readActivity =
    activityState === "testing"
      ? { changes: [], matchedReadCommand: false }
      : readCommandActivity(root, codemap, payload);
  const readChanges = readActivity.changes;
  let writeChanges = activityState === "testing" ? [] : await toolInputChanges(root, payload);
  const shellEditFallback =
    activityState === "editing" &&
    writeChanges.length === 0 &&
    readChanges.length === 0 &&
    !readActivity.matchedReadCommand &&
    hasShellEditCommandSegment(payload);
  if (writeChanges.length === 0 && readChanges.length === 0 && !readActivity.matchedReadCommand) {
    writeChanges = await changedCodeChanges(root);
  }
  const previousCodemap = codemap;
  const refreshForShellEditFallback = shellEditFallback && writeChanges.length === 0;
  if (writeChanges.length > 0 || refreshForShellEditFallback) {
    codemap = await refreshCodemap(root, mapPath, previousCodemap);
  }
  const changes: CodexChange[] = [...readChanges, ...writeChanges];
  const events: StoredActivityEvent[] = [];
  for (const change of changes) {
    try {
      const address = resolveChangeAddress(codemap, previousCodemap, change);
      events.push(
        createActivityEvent(address, {
          id: randomUUID(),
          activityState: change.activityState ?? activityState,
          note: change.note ?? `Codex ${payload.tool_name ?? "tool"} activity`,
          ...hookEventBase(payload, threadId, threadUri),
        }),
      );
    } catch {
      // Unmapped paths are ignored; the map update hooks will catch up separately.
    }
  }
  if (events.length === 0 && activityState === "testing") {
    events.push(heartbeatEvent({ ...base, activityState, note: "Codex ran tests" }));
  }
  if (events.length === 0 && refreshForShellEditFallback) {
    events.push(heartbeatEvent({ ...base, activityState, note: "Codex shell edit activity" }));
  }
  return events;
}

function hookEventBase(
  payload: HookPayload,
  threadId: string | undefined,
  threadUri: string | undefined,
): HookEventBase {
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

async function refreshCodemap(
  root: string,
  mapPath: string,
  previousCodemap: CodecharterCodemap,
): Promise<CodecharterCodemap> {
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

function heartbeatEvent(
  input: HookEventBase & { activityState: ActivityStateInput; note: string },
): StoredActivityEvent {
  return {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    ...input,
  };
}

function codexThreadId(payload: HookPayload): string | undefined {
  return normalizeCodexThreadId(
    payload.thread_id ??
      payload.threadId ??
      payload.codex_thread_id ??
      payload.thread_uri ??
      payload.threadUri ??
      payload.thread?.id ??
      payload.thread?.uri ??
      payload.session_id ??
      process.env.CODEX_THREAD_ID,
  );
}

function codexThreadUri(payload: HookPayload, threadId: string | undefined): string | undefined {
  const explicit =
    payload.thread_uri ?? payload.threadUri ?? payload.thread?.uri ?? process.env.CODEX_THREAD_URI;
  if (explicit) {
    return String(explicit);
  }
  return threadId ? `codex://threads/${threadId}` : undefined;
}

function normalizeCodexThreadId(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }
  const text = String(value);
  const match = text.match(/^codex:\/\/threads\/([^/?#]+)/);
  return match ? match[1] : text;
}

function inferActivityState(payload: HookPayload): ActivityStateInput {
  for (const command of shellCommands(payload)) {
    if (/\b(pnpm|npm|yarn|bun)\s+(test|vitest|jest)\b/.test(command)) {
      return "testing";
    }
    if (
      /\b(vitest|jest|pytest|cargo\s+test|go\s+test|swift\s+test|xcodebuild\s+test)\b/.test(command)
    ) {
      return "testing";
    }
  }
  return "editing";
}

function readCommandActivity(
  root: string,
  codemap: CodecharterCodemap,
  payload: HookPayload,
): { changes: CodexChange[]; matchedReadCommand: boolean } {
  const changes: CodexChange[] = [];
  const seen = new Set<string>();
  let matchedReadCommand = false;
  for (const command of shellCommands(payload)) {
    for (const segment of commandSegments(command)) {
      const tokens = shellWords(segment);
      if (tokens.length === 0) {
        continue;
      }
      const commandToken = tokens[0];
      if (!commandToken) {
        continue;
      }
      const commandName = basename(commandToken);
      const strategy = READ_COMMAND_STRATEGIES.get(commandName);
      if (!strategy) {
        continue;
      }
      if (isMutatingReadCommand(commandName, tokens)) {
        continue;
      }
      matchedReadCommand = true;

      const lineRange = strategy.lineRange({ root, commandName, tokens, codemap });
      for (const candidate of strategy.pathCandidates({ root, commandName, tokens, codemap })) {
        const path = normalizeCommandPath(root, candidate);
        if (!codemap.files?.[path] && !codemap.folders?.[path]) {
          continue;
        }
        const key = `${path}:${lineRange.lineStart ?? ""}:${lineRange.lineEnd ?? ""}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        changes.push({
          path,
          ...lineRange,
          activityState: "reading",
          note: `Codex read ${path}`,
        });
      }
    }
  }
  return { changes, matchedReadCommand };
}

function commandSegments(command: string): string[] {
  return command.split(/\n|;|&&/);
}

function shellCommands(payload: HookPayload): string[] {
  const commands: string[] = [];
  for (const invocation of toolInvocations(payload)) {
    if (!isShellToolName(invocation.name)) {
      continue;
    }
    const command = findShellCommand(invocation.input);
    if (command) {
      commands.push(command);
    }
  }
  return commands;
}

function hasShellEditCommandSegment(payload: HookPayload): boolean {
  for (const command of shellCommands(payload)) {
    for (const segment of commandSegments(command)) {
      const tokens = shellWords(segment);
      const commandToken = tokens[0];
      if (!commandToken) {
        continue;
      }
      const commandName = basename(commandToken);
      if (!READ_COMMAND_STRATEGIES.has(commandName) || isMutatingReadCommand(commandName, tokens)) {
        return true;
      }
    }
  }
  return false;
}

function isMutatingReadCommand(commandName: string, tokens: string[]): boolean {
  return commandName === "sed" && tokens.some(isSedInPlaceOption);
}

function isSedInPlaceOption(token: string): boolean {
  return (
    token === "-i" ||
    token.startsWith("-i") ||
    token === "--in-place" ||
    token.startsWith("--in-place=")
  );
}

function isShellToolName(toolName: string): boolean {
  return SHELL_TOOL_NAMES.has(toolName) || toolName.endsWith(".exec_command");
}

function findShellCommand(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  const record = objectRecord(value);
  if (!record) {
    return "";
  }

  for (const key of ["command", "cmd", "script"]) {
    if (typeof record[key] === "string") {
      return record[key];
    }
  }

  for (const key of ["input", "arguments", "args"]) {
    const nested = record[key];
    if (typeof nested === "string") {
      const parsed = parseHookPayload(nested);
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
        const parsedCommand: string = findShellCommand(parsed);
        if (parsedCommand) {
          return parsedCommand;
        }
      }
      return nested;
    }

    const nestedCommand: string = findShellCommand(nested);
    if (nestedCommand) {
      return nestedCommand;
    }
  }

  for (const child of Object.values(record)) {
    const nestedCommand: string = findShellCommand(child);
    if (nestedCommand) {
      return nestedCommand;
    }
  }

  return "";
}

async function toolInputChanges(root: string, payload: HookPayload): Promise<CodexChange[]> {
  const paths = toolInputPaths(root, payload);
  return mapConcurrent(paths, DEFAULT_CHANGE_RANGE_CONCURRENCY, async (path) => ({
    path,
    ...(await changedLineRange(root, path)),
  }));
}

function toolInputPaths(root: string, payload: HookPayload): string[] {
  const paths = new Set<string>();

  for (const invocation of toolInvocations(payload)) {
    const toolName = invocation.name.toLowerCase();
    for (const strategy of TOOL_INPUT_PATH_STRATEGIES) {
      if (!strategy.matches(toolName)) {
        continue;
      }
      for (const path of strategy.paths(invocation.input)) {
        paths.add(normalizeCommandPath(root, path));
      }
    }
  }

  return [...paths].filter(Boolean);
}

function toolInvocations(payload: HookPayload): ToolInvocation[] {
  const invocations: ToolInvocation[] = [
    {
      name: String(payload.tool_name ?? ""),
      input: payload.tool_input ?? {},
    },
  ];
  collectNestedToolInvocations(payload.tool_input, invocations);
  return invocations;
}

function collectNestedToolInvocations(value: unknown, invocations: ToolInvocation[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectNestedToolInvocations(item, invocations);
    }
    return;
  }

  const record = objectRecord(value);
  if (!record) {
    return;
  }
  const name = record.recipient_name ?? record.tool_name ?? record.name;
  const input = record.parameters ?? record.tool_input ?? record.input;
  if (typeof name === "string") {
    invocations.push({ name, input: input ?? {} });
  }

  for (const child of Object.values(record)) {
    if (child && typeof child === "object") {
      collectNestedToolInvocations(child, invocations);
    }
  }
}

function isStructuredWriteTool(toolName: string): boolean {
  return (
    STRUCTURED_WRITE_TOOL_NAMES.includes(toolName) ||
    STRUCTURED_WRITE_TOOL_NAMES.some((name) => toolName.endsWith(`.${name}`)) ||
    toolName.includes("multiedit") ||
    toolName.includes("multi_edit")
  );
}

function toolInputText(input: unknown): string {
  const record = objectRecord(input);
  return record
    ? ["command", "cmd", "patch", "input"]
        .map((key) => record[key])
        .filter((value): value is string => typeof value === "string")
        .join("\n")
    : "";
}

function applyPatchPaths(text: string): string[] {
  const paths: string[] = [];
  for (const match of text.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) {
    const path = match[1]?.trim();
    if (path) {
      paths.push(path);
    }
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
    for (const item of value) {
      collectStructuredToolPaths(item, paths);
    }
    return;
  }
  const record = objectRecord(value);
  if (!record) {
    return;
  }

  for (const [key, child] of Object.entries(record)) {
    if (/^(file_?path|path|filename)$/i.test(key) && typeof child === "string") {
      paths.push(child);
      continue;
    }
    if (child && typeof child === "object") {
      collectStructuredToolPaths(child, paths);
    }
  }
}

function shellWords(segment: string): string[] {
  const words: string[] = [];
  for (const match of segment.matchAll(/"([^"]*)"|'([^']*)'|[^\s]+/g)) {
    words.push(match[1] ?? match[2] ?? match[0]);
  }
  return words;
}

function readCommandPathCandidates(
  commandName: string,
  tokens: string[],
  codemap: CodecharterCodemap,
  root = "",
): string[] {
  const strategy = READ_COMMAND_STRATEGIES.get(commandName);
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
  {
    optionConsumesNext = readOptionConsumesNext,
    reject = () => false,
  }: {
    optionConsumesNext?: ((token: string) => boolean) | null;
    reject?: (token: string) => boolean;
  } = {},
): string[] {
  const candidates: string[] = [];
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token || READ_PATH_STOP_TOKENS.has(token)) {
      continue;
    }
    if (optionConsumesNext?.(token)) {
      index += 1;
      continue;
    }
    if (token.startsWith("-")) {
      continue;
    }
    if (reject(token)) {
      continue;
    }
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
    if (!token || token === "|" || token === ">" || token === "2>") {
      continue;
    }
    if (token === "--files" || token === "--files-with-matches") {
      filesMode = true;
      continue;
    }
    if (RG_OPTIONS_WITH_VALUE.has(token)) {
      index += 1;
      continue;
    }
    if (token.startsWith("-")) {
      continue;
    }
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
  if (count) {
    return { lineStart: 1, lineEnd: count };
  }
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
  if (count && lineCount) {
    return { lineStart: Math.max(1, lineCount - count + 1), lineEnd: lineCount };
  }

  return {};
}

function numericOption(tokens: string[], name: string): number | undefined {
  let compact: string | undefined;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) {
      continue;
    }
    if (token === name) {
      return Number(tokens[index + 1]);
    }
    if (compact === undefined && token.startsWith(name) && token.length > name.length) {
      compact = token;
    }
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

async function readCodemap(mapPath: string): Promise<CodecharterCodemap> {
  return JSON.parse(await readFile(mapPath, "utf8"));
}

async function resolveMapPath(root: string, configuredPath?: string): Promise<string> {
  const candidates: string[] = [];
  for (const path of [configuredPath, DEFAULT_MAP_PATH, ROOT_MAP_PATH, LEGACY_MAP_PATH]) {
    if (path) {
      candidates.push(resolveFromRoot(root, path));
    }
  }

  for (const candidate of candidates) {
    try {
      await readFile(candidate, "utf8");
      return candidate;
    } catch (error) {
      if (!isErrnoException(error) || error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  return resolveFromRoot(root, configuredPath ?? DEFAULT_MAP_PATH);
}

async function resolveRoot(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileText("git", ["rev-parse", "--show-toplevel"], { cwd });
    return stdout.trim() || cwd;
  } catch {
    return cwd;
  }
}

function resolveFromRoot(root: string, path: string): string {
  return isAbsolute(path) ? path : resolve(root, path);
}

function codexHookConfigFromValue(value: unknown): CodexHookConfig {
  const record = objectRecord(value);
  if (!record) {
    return {};
  }
  const agents = codexHookAgentsFromValue(record.agents);
  return {
    ...(typeof record.mapPath === "string" ? { mapPath: record.mapPath } : {}),
    ...(typeof record.activityPath === "string" ? { activityPath: record.activityPath } : {}),
    ...(agents ? { agents } : {}),
  };
}

function codexHookAgentsFromValue(value: unknown): CodexHookConfig["agents"] | undefined {
  const record = objectRecord(value);
  if (!record) {
    return undefined;
  }
  const codex = objectRecord(record.codex);
  if (!codex) {
    return {};
  }
  return {
    codex: typeof codex.activityPath === "string" ? { activityPath: codex.activityPath } : {},
  };
}
