import { execFile } from "node:child_process";
import type { ExecFileOptions } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { changedRangeFromUnifiedDiff } from "./activity-change-range.ts";
import { isCodeFile } from "./extensions.ts";
import type { ActivityStateInput } from "./activity.js";
import type { ChangedRange } from "./activity-change-range.js";

type ExecFileAsync = (
  file: string,
  args: readonly string[],
  options: ExecFileOptions & { encoding?: BufferEncoding },
) => Promise<{ stdout: string; stderr: string }>;

const execFileAsync = promisify(execFile) as ExecFileAsync;
const DEFAULT_INTERVAL_MS = 1800;
const DEFAULT_THROTTLE_MS = 5000;
const DEFAULT_CHANGE_RANGE_CONCURRENCY = 32;

export type CodeChange = ChangedRange & {
  path: string;
  signature: string;
};

export type ActivityWatcherPayload = {
  agentId: string;
  activityState: ActivityStateInput;
  path?: string;
  address?: unknown;
  lineStart?: number;
  lineEnd?: number;
  columnStart?: number;
  columnEnd?: number;
  fragments?: ChangedRange["fragments"];
  note: string;
};

type RecentChange = {
  signature: string;
  timestamp: number;
};

type ActivityPayloadContext = {
  agentId: string;
  activityState: ActivityStateInput;
};

export type ActivityWatcherOptions = {
  root?: string;
  endpoint?: string;
  agentId?: string;
  activityState?: ActivityStateInput;
  intervalMs?: number;
  throttleMs?: number;
  prepareChanges?: (changes: CodeChange[]) => void | Promise<void>;
  createActivityPayload?: (change: CodeChange, context: ActivityPayloadContext) => ActivityWatcherPayload | null | undefined;
  postActivity?: (endpoint: string | undefined, payload: ActivityWatcherPayload) => Promise<void>;
};

export class ActivityWatcher {
  private readonly root: string | undefined;
  private readonly endpoint: string | undefined;
  private readonly agentId: string;
  private readonly activityState: ActivityStateInput;
  private readonly intervalMs: number;
  private readonly throttleMs: number;
  private readonly prepareChanges: (changes: CodeChange[]) => void | Promise<void>;
  private readonly createActivityPayload: (change: CodeChange, context: ActivityPayloadContext) => ActivityWatcherPayload | null | undefined;
  private readonly postActivity: (endpoint: string | undefined, payload: ActivityWatcherPayload) => Promise<void>;
  private readonly recent: Map<string, RecentChange>;
  private initialPoll: NodeJS.Timeout | null;
  private timer: NodeJS.Timeout | null;
  private pollInFlight: boolean;

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
  }: ActivityWatcherOptions = {}) {
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
    this.pollInFlight = false;
    this.poll = this.poll.bind(this);
    this.close = this.close.bind(this);
  }

  start(): ActivityWatcher {
    this.initialPoll = setTimeout(() => {
      this.poll().catch((error) => {
        console.warn(`warning: activity-watcher-initial-poll-skipped error=${errorMessage(error)}`);
      });
    }, 0);
    this.timer = setInterval(() => {
      this.poll().catch((error) => {
        console.warn(`warning: activity-watcher-poll-skipped error=${errorMessage(error)}`);
      });
    }, this.intervalMs);
    return this;
  }

  close(): void {
    if (this.initialPoll) clearTimeout(this.initialPoll);
    if (this.timer) clearInterval(this.timer);
  }

  async poll(): Promise<void> {
    if (this.pollInFlight) return;
    this.pollInFlight = true;
    try {
      const paths = await changedGitPaths(this.root);
      const activePaths = new Set(paths);
      const now = Date.now();
      for (const path of this.recent.keys()) {
        if (!activePaths.has(path)) this.recent.delete(path);
      }

      const changes = await changedRangesForPaths(this.root, paths);
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
          console.warn(`warning: activity-watcher-skipped path=${path} error=${errorMessage(error)}`);
          continue;
        }
        if (!payload) continue;
        void this.postActivity(this.endpoint, payload).catch((error) => {
          console.warn(`warning: activity-watcher-post-skipped path=${path} error=${errorMessage(error)}`);
        });
      }
    } finally {
      this.pollInFlight = false;
    }
  }
}

export function startActivityWatcher(options: ActivityWatcherOptions = {}): ActivityWatcher {
  return new ActivityWatcher(options).start();
}

export async function changedCodeChanges(root?: string): Promise<CodeChange[]> {
  return changedRangesForPaths(root, await changedGitPaths(root));
}

function changedRangesForPaths(root: string | undefined, paths: string[]): Promise<CodeChange[]> {
  return mapChangedRanges(root, paths, DEFAULT_CHANGE_RANGE_CONCURRENCY);
}

async function mapChangedRanges(root: string | undefined, paths: string[], concurrency: number): Promise<CodeChange[]> {
  const changes = new Array<CodeChange>(paths.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(paths.length, concurrency));
  const workers: Promise<void>[] = [];
  for (let worker = 0; worker < workerCount; worker += 1) {
    workers.push((async () => {
      while (next < paths.length) {
        const index = next;
        next += 1;
        const path = paths[index];
        if (path === undefined) continue;
        changes[index] = {
          path,
          ...await changedLineRange(root, path),
        };
      }
    })());
  }
  await Promise.all(workers);
  return changes;
}

export function parseGitStatusPorcelain(raw: string): string[] {
  const paths: string[] = [];

  let start = 0;
  for (let index = 0; index <= raw.length; index += 1) {
    if (index < raw.length && raw[index] !== "\0") continue;
    if (index === start) {
      start = index + 1;
      continue;
    }
    const entry = raw.slice(start, index);
    start = index + 1;
    const status = entry.slice(0, 2);
    const path = entry.slice(3);
    if (isCopiedOrRenamedStatus(status)) {
      const nextStart = raw.indexOf("\0", start);
      start = nextStart === -1 ? raw.length : nextStart + 1;
      index = start - 1;
    }
    if (isActivityWatchablePath(path)) paths.push(path);
  }

  return paths;
}

function isCopiedOrRenamedStatus(status: string): boolean {
  return status.charCodeAt(0) === 82
    || status.charCodeAt(1) === 82
    || status.charCodeAt(0) === 67
    || status.charCodeAt(1) === 67;
}

async function changedGitPaths(root: string | undefined): Promise<string[]> {
  const { stdout } = await execFileAsync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd: root });
  return parseGitStatusPorcelain(stdout);
}

export async function changedLineRange(root: string | undefined, path: string): Promise<ChangedRange & { signature: string }> {
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

async function gitDiff(root: string | undefined, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd: root, maxBuffer: 10 * 1024 * 1024 });
    return stdout;
  } catch {
    return "";
  }
}

function defaultActivityPayload(change: CodeChange, { agentId, activityState }: ActivityPayloadContext): ActivityWatcherPayload {
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

async function sendActivityDatagram(endpoint: string | undefined, body: ActivityWatcherPayload): Promise<void> {
  if (!endpoint) return;
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

function isActivityWatchablePath(path: string): boolean {
  return path
    && path !== "codemap.json"
    && path !== "codecharter.json"
    && !path.startsWith(".git/")
    && !path.startsWith(".codecharter/")
    && !path.startsWith(".scratch/")
    && isCodeFile(path);
}

async function wholeFileRange(root: string | undefined, path: string): Promise<ChangedRange & { signature?: string }> {
  try {
    const content = await readFile(join(root, path), "utf8");
    const lineCount = contentLineCount(content);
    return { lineStart: 1, lineEnd: lineCount, signature: `file:${hashString(content)}` };
  } catch {
    return {};
  }
}

function contentLineCount(content: string): number {
  if (content.length === 0) return 1;
  let lines = 1;
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10 && index !== content.length - 1) lines += 1;
  }
  return lines;
}

function hashString(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
