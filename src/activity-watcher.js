import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { isCodeFile } from "./extensions.js";

const execFileAsync = promisify(execFile);
const DEFAULT_INTERVAL_MS = 1800;
const DEFAULT_THROTTLE_MS = 5000;

export function startActivityWatcher({
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
  const recent = new Map();

  async function poll() {
    const paths = await changedGitPaths(root);
    const activePaths = new Set(paths);
    const now = Date.now();
    for (const path of recent.keys()) {
      if (!activePaths.has(path)) recent.delete(path);
    }

    const changes = await Promise.all(paths.map(async (path) => ({
      path,
      ...await changedLineRange(root, path),
    })));
    await prepareChanges(changes);

    for (const change of changes) {
      const { path } = change;
      const previous = recent.get(path);
      if (previous?.signature === change.signature) continue;
      if (previous && now - previous.timestamp < throttleMs) continue;
      recent.set(path, { signature: change.signature, timestamp: now });
      let payload;
      try {
        payload = createActivityPayload(change, { agentId, activityState });
      } catch (error) {
        console.warn(`warning: activity-watcher-skipped path=${path} error=${error.message}`);
        continue;
      }
      if (!payload) continue;
      void postActivity(endpoint, payload);
    }
  }

  const initialPoll = setTimeout(() => {
    poll().catch((error) => {
      console.warn(`warning: activity-watcher-initial-poll-skipped error=${error.message}`);
    });
  }, 0);
  const timer = setInterval(() => {
    poll().catch((error) => {
      console.warn(`warning: activity-watcher-poll-skipped error=${error.message}`);
    });
  }, intervalMs);

  return {
    close() {
      clearTimeout(initialPoll);
      clearInterval(timer);
    },
    poll,
  };
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

export function lineRangeFromUnifiedDiff(diff) {
  const range = changedRangeFromUnifiedDiff(diff);
  if (range.lineStart === undefined) return {};
  return {
    lineStart: range.lineStart,
    lineEnd: range.lineEnd,
  };
}

export function changedRangeFromUnifiedDiff(diff) {
  const ranges = [...diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)]
    .map((match) => changedHunkRange(match[1], match[2]));

  if (ranges.length === 0) return {};
  const fragments = tokenFragmentsFromUnifiedDiff(diff);
  const tokenSpan = columnSpanFromFragments(fragments);
  return {
    lineStart: Math.min(...ranges.map((range) => range.start)),
    lineEnd: Math.max(...ranges.map((range) => range.end)),
    ...(tokenSpan ? {
      columnStart: tokenSpan.start,
      columnEnd: tokenSpan.end,
    } : {}),
    ...(fragments.length ? { fragments } : {}),
  };
}

function changedHunkRange(startRaw, countRaw) {
  const hunkStart = Number(startRaw);
  const count = countRaw === undefined ? 1 : Number(countRaw);
  const start = count === 0 ? Math.max(1, hunkStart + 1) : hunkStart;
  return {
    start,
    end: start + Math.max(1, count) - 1,
  };
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

function tokenFragmentsFromUnifiedDiff(diff) {
  const fragments = [];
  let nextLine = null;

  for (const rawLine of diff.split("\n")) {
    const hunk = rawLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunk) {
      nextLine = Number(hunk[1]);
      continue;
    }
    if (nextLine === null) continue;
    if (rawLine.startsWith("+") && !rawLine.startsWith("+++")) {
      const span = tokenColumnSpan(rawLine.slice(1));
      if (span) {
        fragments.push({
          lineStart: nextLine,
          lineEnd: nextLine,
          columnStart: span.start,
          columnEnd: span.end,
        });
      }
      nextLine += 1;
    } else if (!rawLine.startsWith("-")) {
      nextLine += 1;
    }
  }

  return fragments;
}

function columnSpanFromFragments(fragments) {
  if (!fragments.length) return null;
  return {
    start: Math.min(...fragments.map((fragment) => fragment.columnStart)),
    end: Math.max(...fragments.map((fragment) => fragment.columnEnd)),
  };
}

function tokenColumnSpan(line) {
  if (line.length === 0) return null;
  const pattern = /[A-Za-z_$][A-Za-z0-9_$]*|\d+(?:\.\d+)?|[^\s]/g;
  let match;
  let minColumn = Infinity;
  let maxColumn = 0;
  while ((match = pattern.exec(line))) {
    minColumn = Math.min(minColumn, match.index + 1);
    maxColumn = Math.max(maxColumn, match.index + match[0].length);
  }
  if (Number.isFinite(minColumn)) return { start: minColumn, end: maxColumn };
  return { start: 1, end: line.length };
}

function hashString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}
