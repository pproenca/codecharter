import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { changedCodeChanges } from "./activity-watcher.js";
import { appendActivityEvents, ensureActivityArchive } from "./activity-store.js";
import { createActivityEvent } from "./activity.js";
import { resolveAddress } from "./resolver.js";
import { readJson } from "./store.js";

const execFileAsync = promisify(execFile);
const DEFAULT_CONFIG_PATH = ".codecharter/config.json";
const DEFAULT_MAP_PATH = ".codecharter/codecharter.json";
const ROOT_MAP_PATH = "codecharter.json";
const LEGACY_MAP_PATH = "codemap.json";
const DEFAULT_ACTIVITY_PATH = ".codecharter/activity.jsonl";

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
  const base = {
    agentId: "codex",
    hookEventName: payload.hook_event_name,
    sessionId: payload.session_id,
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
  const codemap = await readCodemap(mapPath);
  const readChanges = activityState === "testing" ? [] : readCommandChanges(root, codemap, payload);
  const changes = [...readChanges, ...await changedCodeChanges(root)];
  const events = [];
  for (const change of changes) {
    try {
      const address = resolveAddress(codemap, change);
      events.push(createActivityEvent(address, {
        id: randomUUID(),
        agentId: "codex",
        activityState: change.activityState ?? activityState,
        note: change.note ?? `Codex ${payload.tool_name ?? "tool"} activity`,
        hookEventName: payload.hook_event_name,
        sessionId: payload.session_id,
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

function heartbeatEvent(input) {
  return {
    id: randomUUID(),
    agentId: input.agentId,
    activityState: input.activityState,
    timestamp: new Date().toISOString(),
    note: input.note,
    hookEventName: input.hookEventName,
    sessionId: input.sessionId,
    turnId: input.turnId,
    model: input.model,
  };
}

function inferActivityState(payload) {
  if (payload.tool_name !== "Bash") return "editing";
  const command = payload.tool_input?.command ?? "";
  if (/\b(pnpm|npm|yarn|bun)\s+(test|vitest|jest)\b/.test(command)) return "testing";
  if (/\b(vitest|jest|pytest|cargo\s+test|go\s+test|swift\s+test|xcodebuild\s+test)\b/.test(command)) return "testing";
  return "editing";
}

function readCommandChanges(root, codemap, payload) {
  if (payload.tool_name !== "Bash") return [];
  const command = payload.tool_input?.command ?? payload.tool_input?.cmd ?? "";
  if (!command) return [];

  const changes = [];
  const seen = new Set();
  for (const segment of command.split(/\n|&&|;/)) {
    const tokens = shellWords(segment);
    if (tokens.length === 0) continue;
    const commandName = basename(tokens[0]);
    if (!["cat", "nl", "less", "head", "tail", "sed", "rg"].includes(commandName)) continue;

    const lineRange = readLineRange(commandName, tokens, codemap);
    for (const candidate of readCommandPathCandidates(commandName, tokens)) {
      const path = normalizeCommandPath(root, candidate);
      if (!codemap.files?.[path]) continue;
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
  return changes;
}

function shellWords(segment) {
  const words = [];
  for (const match of segment.matchAll(/"([^"]*)"|'([^']*)'|[^\s]+/g)) {
    words.push(match[1] ?? match[2] ?? match[0]);
  }
  return words;
}

function readCommandPathCandidates(commandName, tokens) {
  const candidates = [];
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token || token.startsWith("-") || token === "|" || token === ">" || token === "2>") continue;
    if (commandName === "sed" && (looksLikeSedScript(token) || tokens[index - 1] === "-e")) continue;
    if (commandName === "rg" && !token.includes("/") && !token.includes(".")) continue;
    candidates.push(token);
  }
  return candidates;
}

function readLineRange(commandName, tokens, codemap) {
  if (commandName === "sed") {
    for (const token of tokens) {
      const range = token.match(/^(\d+)(?:,(\d+))?p$/);
      if (range) {
        const lineStart = Number(range[1]);
        return { lineStart, lineEnd: Number(range[2] ?? range[1]) };
      }
    }
  }

  if (commandName === "head") {
    const count = numericOption(tokens, "-n");
    if (count) return { lineStart: 1, lineEnd: count };
  }

  if (commandName === "tail") {
    const path = readCommandPathCandidates(commandName, tokens).find((candidate) => codemap.files?.[candidate]);
    const count = numericOption(tokens, "-n");
    const lineCount = path ? codemap.files[path]?.lineCount : undefined;
    if (count && lineCount) return { lineStart: Math.max(1, lineCount - count + 1), lineEnd: lineCount };
  }

  return {};
}

function numericOption(tokens, name) {
  const index = tokens.indexOf(name);
  if (index !== -1) return Number(tokens[index + 1]);
  const compact = tokens.find((token) => token.startsWith(name) && token.length > name.length);
  return compact ? Number(compact.slice(name.length)) : undefined;
}

function looksLikeSedScript(token) {
  return /^\d+(?:,\d+)?p$/.test(token) || token.includes("s/");
}

function normalizeCommandPath(root, candidate) {
  const stripped = candidate.replace(/^['"]|['"]$/g, "");
  const normalized = isAbsolute(stripped) ? relative(root, stripped) : stripped;
  return normalized.replaceAll("\\", "/");
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
  const candidates = [
    configuredPath,
    DEFAULT_MAP_PATH,
    ROOT_MAP_PATH,
    LEGACY_MAP_PATH,
  ].filter(Boolean).map((path) => resolveFromRoot(root, path));

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
