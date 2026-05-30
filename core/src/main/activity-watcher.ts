/**
 * Dev-mode activity watcher: polls `git status`, diffs changed code files into
 * line/column ranges, and posts best-effort activity events.
 *
 * Implements **BR-025** (watchable-path eligibility), **BR-049** (poll interval
 * 1.8s, throttle 5s, dedup by change signature), and the BR-017 rolling hash.
 * `ActivityWatcher` is a class because it owns mutable state (timers + injected
 * collaborators); collaborators are injectable for testing.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { changedRangeFromUnifiedDiff } from "./activity-change-range.ts";
import type { ChangedRange } from "./activity-change-range.ts";
import type { ActivityAddress, ActivityStateInput } from "./activity.ts";
import { mapConcurrent } from "./collections.ts";
import { errorMessage } from "./errors.ts";
import { execFileText } from "./exec-file.ts";
import { isCodeFile } from "./extensions.ts";
import { CODECHARTER_DIR, CODEX_DIR, LEGACY_MAP_FILE, ROOT_MAP_FILE } from "./paths.ts";

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
  address?: ActivityAddress;
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
  createActivityPayload?: (
    change: CodeChange,
    context: ActivityPayloadContext,
  ) => ActivityWatcherPayload | null | undefined;
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
  private readonly createActivityPayload: (
    change: CodeChange,
    context: ActivityPayloadContext,
  ) => ActivityWatcherPayload | null | undefined;
  private readonly postActivity: (
    endpoint: string | undefined,
    payload: ActivityWatcherPayload,
  ) => Promise<void>;
  private readonly recent = new Map<string, RecentChange>();
  private initialPoll: NodeJS.Timeout | null = null;
  private timer: NodeJS.Timeout | null = null;
  private pollInFlight = false;

  constructor({
    root,
    endpoint,
    agentId = "codex",
    activityState = "editing",
    intervalMs = DEFAULT_INTERVAL_MS,
    throttleMs = DEFAULT_THROTTLE_MS,
    prepareChanges = () => {},
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
    if (this.initialPoll) {
      clearTimeout(this.initialPoll);
    }
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async poll(): Promise<void> {
    if (this.pollInFlight) {
      return;
    }
    this.pollInFlight = true;
    try {
      const paths = await changedGitPaths(this.root);
      const activePaths = new Set(paths);
      const now = Date.now();
      for (const path of this.recent.keys()) {
        if (!activePaths.has(path)) {
          this.recent.delete(path);
        }
      }

      const changes = await changedRangesForPaths(this.root, paths);
      await this.prepareChanges(changes);

      for (const change of changes) {
        const { path } = change;
        const previous = this.recent.get(path);
        if (previous?.signature === change.signature) {
          continue;
        }
        if (previous && now - previous.timestamp < this.throttleMs) {
          continue;
        }
        this.recent.set(path, { signature: change.signature, timestamp: now });
        let payload;
        try {
          payload = this.createActivityPayload(change, {
            agentId: this.agentId,
            activityState: this.activityState,
          });
        } catch (error) {
          console.warn(
            `warning: activity-watcher-skipped path=${path} error=${errorMessage(error)}`,
          );
          continue;
        }
        if (!payload) {
          continue;
        }
        void this.postActivity(this.endpoint, payload).catch((error) => {
          console.warn(
            `warning: activity-watcher-post-skipped path=${path} error=${errorMessage(error)}`,
          );
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
  return mapConcurrent(paths, DEFAULT_CHANGE_RANGE_CONCURRENCY, async (path) => ({
    path,
    ...(await changedLineRange(root, path)),
  }));
}

export function parseGitStatusPorcelain(raw: string): string[] {
  const paths: string[] = [];
  const entries = raw.split("\0");
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) {
      continue;
    }
    const status = entry.slice(0, 2);
    const path = entry.slice(3);
    if (isCopiedOrRenamedStatus(status)) {
      index += 1;
    }
    if (isActivityWatchablePath(path)) {
      paths.push(path);
    }
  }
  return paths;
}

function isCopiedOrRenamedStatus(status: string): boolean {
  return status.includes("R") || status.includes("C");
}

async function changedGitPaths(root: string | undefined): Promise<string[]> {
  const { stdout } = await execFileText(
    "git",
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    { cwd: root },
  );
  return parseGitStatusPorcelain(stdout);
}

export async function changedLineRange(
  root: string | undefined,
  path: string,
): Promise<ChangedRange & { signature: string }> {
  const diffs = await Promise.all([
    gitDiff(root, ["diff", "--unified=0", "--", path]),
    gitDiff(root, ["diff", "--cached", "--unified=0", "--", path]),
  ]);
  const diff = diffs.join("\n");
  const range = changedRangeFromUnifiedDiff(diff);
  if (range.lineStart !== undefined) {
    return { ...range, signature: hashString(diff) };
  }

  const fallbackRange = await wholeFileRange(root, path);
  return {
    ...fallbackRange,
    signature: fallbackRange.signature ?? (diff ? hashString(diff) : "file"),
  };
}

async function gitDiff(root: string | undefined, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileText("git", args, { cwd: root, maxBuffer: 10 * 1024 * 1024 });
    return stdout;
  } catch {
    return "";
  }
}

function defaultActivityPayload(
  change: CodeChange,
  { agentId, activityState }: ActivityPayloadContext,
): ActivityWatcherPayload {
  return {
    agentId,
    activityState,
    path: change.path,
    note: "codecharter dev watcher",
    ...(change.lineStart === undefined ? {} : { lineStart: change.lineStart }),
    ...(change.lineEnd === undefined ? {} : { lineEnd: change.lineEnd }),
    ...(change.columnStart === undefined ? {} : { columnStart: change.columnStart }),
    ...(change.columnEnd === undefined ? {} : { columnEnd: change.columnEnd }),
    ...(change.fragments === undefined ? {} : { fragments: change.fragments }),
  };
}

async function sendActivityDatagram(
  endpoint: string | undefined,
  body: ActivityWatcherPayload,
): Promise<void> {
  if (!endpoint) {
    return;
  }
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
  return (
    path !== "" &&
    path !== LEGACY_MAP_FILE &&
    path !== ROOT_MAP_FILE &&
    !path.startsWith(".git/") &&
    !path.startsWith(`${CODEX_DIR}/`) &&
    !path.startsWith(`${CODECHARTER_DIR}/`) &&
    !path.startsWith(".scratch/") &&
    isCodeFile(path)
  );
}

async function wholeFileRange(
  root: string | undefined,
  path: string,
): Promise<ChangedRange & { signature?: string }> {
  try {
    const content = await readFile(join(root ?? ".", path), "utf8");
    const lineCount = contentLineCount(content);
    return { lineStart: 1, lineEnd: lineCount, signature: `file:${hashString(content)}` };
  } catch {
    return {};
  }
}

function contentLineCount(content: string): number {
  if (content.length === 0) {
    return 1;
  }
  return content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
}

function hashString(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}
