import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { changedRangeFromUnifiedDiff } from "./activity-change-range.js";
import { isCodeFile } from "./extensions.js";

const execFileAsync = promisify(execFile);
const DEFAULT_INTERVAL_MS = 1800;
const DEFAULT_THROTTLE_MS = 5000;

export class ActivityWatcher {
  constructor({
    root,
    endpoint,
    agentId = "codex",
    activityState = "editing",
    intervalMs = DEFAULT_INTERVAL_MS,
    throttleMs = DEFAULT_THROTTLE_MS,
    prepareChanges = async () => {},
    createActivityPayload = defaultActivityPayload,
    postActivity = sendActivityDatagram,
  } = {}) {
    this.root = root;
    this.endpoint = endpoint;
    this.agentId = agentId;
    this.activityState = activityState;
    this.intervalMs = intervalMs;
    this.throttleMs = throttleMs;
    this.prepareChanges = prepareChanges;
    this.createActivityPayload = createActivityPayload;
    this.postActivity = postActivity;
    this.recent = new Map();
    this.initialPoll = null;
    this.timer = null;
    this.poll = this.poll.bind(this);
    this.close = this.close.bind(this);
  }

  start() {
    this.initialPoll = setTimeout(() => {
      this.poll().catch((error) => {
        console.warn(`warning: activity-watcher-initial-poll-skipped error=${error.message}`);
      });
    }, 0);
    this.timer = setInterval(() => {
      this.poll().catch((error) => {
        console.warn(`warning: activity-watcher-poll-skipped error=${error.message}`);
      });
    }, this.intervalMs);
    return this;
  }

  close() {
    clearTimeout(this.initialPoll);
    clearInterval(this.timer);
  }

  async poll() {
    const paths = await changedGitPaths(this.root);
    const activePaths = new Set(paths);
    const now = Date.now();
    for (const path of this.recent.keys()) {
      if (!activePaths.has(path)) this.recent.delete(path);
    }

    const changes = await Promise.all(paths.map(async (path) => ({
      path,
      ...await changedLineRange(this.root, path),
    })));
    await this.prepareChanges(changes);

    for (const change of changes) {
      const { path } = change;
      const previous = this.recent.get(path);
      if (previous?.signature === change.signature) continue;
      if (previous && now - previous.timestamp < this.throttleMs) continue;
      this.recent.set(path, { signature: change.signature, timestamp: now });
      let payload;
      try {
        payload = this.createActivityPayload(change, {
          agentId: this.agentId,
          activityState: this.activityState,
        });
      } catch (error) {
        console.warn(`warning: activity-watcher-skipped path=${path} error=${error.message}`);
        continue;
      }
      if (!payload) continue;
      void this.postActivity(this.endpoint, payload);
    }
  }
}

export function startActivityWatcher(options = {}) {
  return new ActivityWatcher(options).start();
}

export async function changedCodeChanges(root) {
  const paths = await changedGitPaths(root);
  return Promise.all(paths.map(async (path) => ({
    path,
    ...await changedLineRange(root, path),
  })));
}

export function parseGitStatusPorcelain(raw) {
  const entries = raw.split("\0").filter(Boolean);
  const paths = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const status = entry.slice(0, 2);
    const path = entry.slice(3);
    if (status.includes("R") || status.includes("C")) index += 1;
    if (isActivityWatchablePath(path)) paths.push(path);
  }

  return paths;
}

async function changedGitPaths(root) {
  const { stdout } = await execFileAsync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd: root });
  return parseGitStatusPorcelain(stdout);
}

export async function changedLineRange(root, path) {
  const diffs = await Promise.all([
    gitDiff(root, ["diff", "--unified=0", "--", path]),
    gitDiff(root, ["diff", "--cached", "--unified=0", "--", path]),
  ]);
  const diff = diffs.join("\n");
  const range = changedRangeFromUnifiedDiff(diff);
  if (range.lineStart !== undefined) {
    return {
      ...range,
      signature: hashString(diff),
    };
  }

  const fallbackRange = await wholeFileRange(root, path);
  return {
    ...fallbackRange,
    signature: fallbackRange.signature ?? (diff ? hashString(diff) : "file"),
  };
}

async function gitDiff(root, args) {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd: root, maxBuffer: 10 * 1024 * 1024 });
    return stdout;
  } catch {
    return "";
  }
}

function defaultActivityPayload(change, { agentId, activityState }) {
  return {
    agentId,
    activityState,
    path: change.path,
    lineStart: change.lineStart,
    lineEnd: change.lineEnd,
    columnStart: change.columnStart,
    columnEnd: change.columnEnd,
    fragments: change.fragments,
    note: "codecharter dev watcher",
  };
}

async function sendActivityDatagram(endpoint, body) {
  try {
    await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(500),
    });
  } catch {
    // Telemetry is deliberately best-effort.
  }
}

function isActivityWatchablePath(path) {
  return path
    && path !== "codemap.json"
    && path !== "codecharter.json"
    && !path.startsWith(".git/")
    && !path.startsWith(".codecharter/")
    && !path.startsWith(".scratch/")
    && isCodeFile(path);
}

async function wholeFileRange(root, path) {
  try {
    const content = await readFile(join(root, path), "utf8");
    const lineCount = contentLineCount(content);
    return { lineStart: 1, lineEnd: lineCount, signature: `file:${hashString(content)}` };
  } catch {
    return {};
  }
}

function contentLineCount(content) {
  if (content.length === 0) return 1;
  const lines = content.split("\n");
  if (content.endsWith("\n")) lines.pop();
  return Math.max(1, lines.length);
}

function hashString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}
