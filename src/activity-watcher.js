import { execFile } from "node:child_process";
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
      void postActivity(endpoint, {
        agentId,
        activityState,
        path,
        lineStart: change.lineStart,
        lineEnd: change.lineEnd,
        note: "codemap dev watcher",
      });
    }
  }

  const initialPoll = setTimeout(() => {
    poll().catch((error) => {
      console.warn(`Activity watcher skipped initial poll: ${error.message}`);
    });
  }, 0);
  const timer = setInterval(() => {
    poll().catch((error) => {
      console.warn(`Activity watcher skipped poll: ${error.message}`);
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
  const ranges = [...diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)]
    .map((match) => {
      const start = Number(match[1]);
      const count = match[2] === undefined ? 1 : Number(match[2]);
      return {
        start,
        end: start + Math.max(1, count) - 1,
      };
    });

  if (ranges.length === 0) return {};
  return {
    lineStart: Math.min(...ranges.map((range) => range.start)),
    lineEnd: Math.max(...ranges.map((range) => range.end)),
  };
}

async function changedGitPaths(root) {
  const { stdout } = await execFileAsync("git", ["status", "--porcelain=v1", "-z"], { cwd: root });
  return parseGitStatusPorcelain(stdout);
}

async function changedLineRange(root, path) {
  const diffs = await Promise.all([
    gitDiff(root, ["diff", "--unified=0", "--", path]),
    gitDiff(root, ["diff", "--cached", "--unified=0", "--", path]),
  ]);
  const diff = diffs.join("\n");
  return {
    ...lineRangeFromUnifiedDiff(diff),
    signature: diff ? hashString(diff) : "file",
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
    && !path.startsWith(".git/")
    && !path.startsWith(".scratch/")
    && isCodeFile(path);
}

function hashString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}
