import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { changedCodeChanges } from "./activity-watcher.js";
import { appendActivityEvents, ensureActivityArchive } from "./activity-store.js";
import { createActivityEvent } from "./activity.js";
import { resolveAddress } from "./resolver.js";
import { readJson } from "./store.js";

const execFileAsync = promisify(execFile);
const DEFAULT_CONFIG_PATH = ".codecharter/config.json";
const DEFAULT_MAP_PATH = ".scratch/codecharter/codecharter.json";
const ROOT_MAP_PATH = "codecharter.json";
const LEGACY_MAP_PATH = "codemap.json";
const DEFAULT_ACTIVITY_PATH = ".scratch/codecharter/activity.jsonl";

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
  const changes = await changedCodeChanges(root);
  const events = [];
  for (const change of changes) {
    try {
      const address = resolveAddress(codemap, change);
      events.push(createActivityEvent(address, {
        id: randomUUID(),
        agentId: "codex",
        activityState,
        note: `Codex ${payload.tool_name ?? "tool"} activity`,
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
