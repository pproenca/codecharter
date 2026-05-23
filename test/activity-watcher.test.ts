import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { once } from "node:events";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UnifiedDiffChangeRangeParser, changedRangeFromUnifiedDiff, lineRangeFromUnifiedDiff } from "../src/activity-change-range.ts";
import { ActivityWatcher, parseGitStatusPorcelain, startActivityWatcher } from "../src/activity-watcher.ts";
import { execFileText } from "../src/exec-file.ts";
import { required } from "../test-support/assertions.ts";
import type { ActivityWatcherPayload } from "../src/activity-watcher.ts";

test("parses git porcelain paths for watchable code files only", () => {
  const raw = [
    " M src/app.js",
    "?? docs/decision.md",
    "R  src/new-name.ts",
    "src/old-name.ts",
    "?? codecharter.json",
    "?? .codecharter/activity.jsonl",
    "?? public/logo.png",
    "?? notes.txt",
    "",
  ].join("\0");

  assert.deepEqual(parseGitStatusPorcelain(raw), [
    "src/app.js",
    "docs/decision.md",
    "src/new-name.ts",
  ]);
});

test("parses porcelain copy and rename records from either status column", () => {
  const raw = [
    "R  src/index-renamed.js",
    "src/index.js",
    " R src/view-renamed.ts",
    "src/view.ts",
    "C  src/copied.js",
    "src/source.js",
    " C src/copied-view.tsx",
    "src/source-view.tsx",
    "",
  ].join("\0");

  assert.deepEqual(parseGitStatusPorcelain(raw), [
    "src/index-renamed.js",
    "src/view-renamed.ts",
    "src/copied.js",
    "src/copied-view.tsx",
  ]);
});

test("resolves changed line range across unified diff hunks", () => {
  const diff = [
    "diff --git a/src/app.js b/src/app.js",
    "@@ -4,0 +5,3 @@",
    "+const added = true;",
    "+const more = true;",
    "+export { added };",
    "@@ -20 +24 @@",
    "-old();",
    "+newCall();",
  ].join("\n");

  assert.deepEqual(lineRangeFromUnifiedDiff(diff), { lineStart: 5, lineEnd: 24 });
});

test("resolves touched token columns across unified diff hunks", () => {
  const diff = [
    "diff --git a/src/app.js b/src/app.js",
    "@@ -20 +24 @@",
    "-old();",
    "+  const newCall = run(value);",
  ].join("\n");

  assert.deepEqual(changedRangeFromUnifiedDiff(diff), {
    lineStart: 24,
    lineEnd: 24,
    columnStart: 3,
    columnEnd: 29,
    fragments: [
      { lineStart: 24, lineEnd: 24, columnStart: 3, columnEnd: 29 },
    ],
  });
});

test("keeps token fragments on their changed text-bearing lines", () => {
  const diff = [
    "diff --git a/src/app.js b/src/app.js",
    "@@ -4,0 +5,2 @@",
    "+short();",
    "+        longerCall(value);",
  ].join("\n");

  assert.deepEqual(changedRangeFromUnifiedDiff(diff).fragments, [
    { lineStart: 5, lineEnd: 5, columnStart: 1, columnEnd: 8 },
    { lineStart: 6, lineEnd: 6, columnStart: 9, columnEnd: 26 },
  ]);
});

test("anchors deletion-only hunks to the next surviving line", () => {
  const diff = [
    "diff --git a/src/app.js b/src/app.js",
    "@@ -2 +1,0 @@ const removed = true;",
    "-const removed = true;",
  ].join("\n");

  assert.deepEqual(lineRangeFromUnifiedDiff(diff), { lineStart: 2, lineEnd: 2 });
});

test("returns an empty line range when a diff has no hunks", () => {
  assert.deepEqual(lineRangeFromUnifiedDiff(""), {});
});

test("UnifiedDiffChangeRangeParser keeps the exported class facade behaviour", () => {
  const diff = [
    "diff --git a/src/app.js b/src/app.js",
    "@@ -20 +24 @@",
    "-old();",
    "+  const newCall = run(value);",
  ].join("\n");
  const parser = new UnifiedDiffChangeRangeParser();

  assert.deepEqual(parser.lineRange(diff), lineRangeFromUnifiedDiff(diff));
  assert.deepEqual(parser.changedRange(diff), changedRangeFromUnifiedDiff(diff));
  assert.deepEqual(parser.changedHunkRange("4", "0"), { start: 5, end: 5 });
  assert.deepEqual(parser.tokenColumnSpan("  const value = 1;"), { start: 3, end: 18 });
});

test("watcher prepares changed map state before posting each new diff signature", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-watcher-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.js"), "const app = true;\n");
  await execFileText("git", ["init"], { cwd: root });
  await execFileText("git", ["add", "src/app.js"], { cwd: root });

  const posted: ActivityWatcherPayload[] = [];
  let prepared = false;
  const server = createServer(async (request, response) => {
    assert.equal(prepared, true);
    posted.push(await readBody(request));
    response.writeHead(202, { "content-type": "application/json" });
    response.end(JSON.stringify({ accepted: true }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const watcher = startActivityWatcher({
    root,
    endpoint: `http://127.0.0.1:${serverPort(server)}/api/activity`,
    intervalMs: 20,
    throttleMs: 0,
    prepareChanges: async (changes) => {
      assert.equal(required(changes[0]).path, "src/app.js");
      prepared = true;
    },
  });

  try {
    await waitFor(() => posted.length === 1);
    const first = required(posted[0]);
    assert.equal(first.path, "src/app.js");
    assert.deepEqual({ lineStart: first.lineStart, lineEnd: first.lineEnd }, { lineStart: 1, lineEnd: 1 });
    assert.deepEqual({ columnStart: first.columnStart, columnEnd: first.columnEnd }, { columnStart: 1, columnEnd: 17 });
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(posted.length, 1);
  } finally {
    watcher.close();
    server.close();
    await once(server, "close");
  }
});

test("watcher reports untracked code files as line ranges", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-watcher-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "new-file.js"), "const first = true;\nexport const second = first;\n");
  await execFileText("git", ["init"], { cwd: root });

  const posted: ActivityWatcherPayload[] = [];
  const watcher = startActivityWatcher({
    root,
    endpoint: "http://127.0.0.1:1/api/activity",
    intervalMs: 60_000,
    throttleMs: 0,
    postActivity: async (_endpoint, body) => {
      posted.push(body);
    },
  });

  try {
    watcher.close();
    await watcher.poll();
    const first = required(posted[0]);
    assert.equal(first.path, "src/new-file.js");
    assert.deepEqual(
      { lineStart: first.lineStart, lineEnd: first.lineEnd },
      { lineStart: 1, lineEnd: 2 },
    );
  } finally {
    watcher.close();
  }
});

test("watcher reports later edits to the same untracked file", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-watcher-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "new-file.js"), "const first = true;\n");
  await execFileText("git", ["init"], { cwd: root });

  const posted: ActivityWatcherPayload[] = [];
  const watcher = startActivityWatcher({
    root,
    endpoint: "http://127.0.0.1:1/api/activity",
    intervalMs: 60_000,
    throttleMs: 0,
    postActivity: async (_endpoint, body) => {
      posted.push(body);
    },
  });

  try {
    watcher.close();
    await watcher.poll();
    await writeFile(join(root, "src", "new-file.js"), "const first = true;\nexport const second = first;\n");
    await watcher.poll();

    assert.equal(posted.length, 2);
    const second = required(posted[1]);
    assert.deepEqual(
      { lineStart: second.lineStart, lineEnd: second.lineEnd },
      { lineStart: 1, lineEnd: 2 },
    );
  } finally {
    watcher.close();
  }
});

test("watcher reports whole-file ranges without relying on a trailing newline", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-watcher-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "new-file.js"), "const first = true;\n\nexport const third = first;");
  await execFileText("git", ["init"], { cwd: root });

  const posted: ActivityWatcherPayload[] = [];
  const watcher = startActivityWatcher({
    root,
    endpoint: "http://127.0.0.1:1/api/activity",
    intervalMs: 60_000,
    throttleMs: 0,
    postActivity: async (_endpoint, body) => {
      posted.push(body);
    },
  });

  try {
    watcher.close();
    await watcher.poll();
    const first = required(posted[0]);
    assert.equal(first.path, "src/new-file.js");
    assert.deepEqual(
      { lineStart: first.lineStart, lineEnd: first.lineEnd },
      { lineStart: 1, lineEnd: 3 },
    );
  } finally {
    watcher.close();
  }
});

test("watcher treats an empty untracked code file as a one-line range", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-watcher-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "empty.js"), "");
  await execFileText("git", ["init"], { cwd: root });

  const posted: ActivityWatcherPayload[] = [];
  const watcher = startActivityWatcher({
    root,
    endpoint: "http://127.0.0.1:1/api/activity",
    intervalMs: 60_000,
    throttleMs: 0,
    postActivity: async (_endpoint, body) => {
      posted.push(body);
    },
  });

  try {
    watcher.close();
    await watcher.poll();
    const first = required(posted[0]);
    assert.equal(first.path, "src/empty.js");
    assert.deepEqual(
      { lineStart: first.lineStart, lineEnd: first.lineEnd },
      { lineStart: 1, lineEnd: 1 },
    );
  } finally {
    watcher.close();
  }
});

test("watcher polling does not wait for activity delivery", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-watcher-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.js"), "const app = true;\n");
  await execFileText("git", ["init"], { cwd: root });
  await execFileText("git", ["add", "src/app.js"], { cwd: root });

  let sendStarted = false;
  const watcher = startActivityWatcher({
    root,
    endpoint: "http://127.0.0.1:1/api/activity",
    intervalMs: 60_000,
    throttleMs: 0,
    postActivity: async () => {
      sendStarted = true;
      await new Promise(() => {});
    },
  });

  try {
    watcher.close();
    await Promise.race([
      watcher.poll(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("watcher poll waited for activity delivery")), 100)),
    ]);
    assert.equal(sendStarted, true);
  } finally {
    watcher.close();
  }
});

test("watcher handles rejected activity delivery without unhandled rejections", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-watcher-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.js"), "const app = true;\n");
  await execFileText("git", ["init"], { cwd: root });

  const unhandled: unknown[] = [];
  const warnings: string[] = [];
  const onUnhandledRejection = (error: unknown) => {
    unhandled.push(error);
  };
  const originalWarn = console.warn;
  process.on("unhandledRejection", onUnhandledRejection);
  console.warn = (message?: unknown) => {
    warnings.push(String(message));
  };
  const watcher = startActivityWatcher({
    root,
    endpoint: "http://127.0.0.1:1/api/activity",
    intervalMs: 60_000,
    throttleMs: 0,
    postActivity: async () => {
      throw new Error("send failed");
    },
  });

  try {
    watcher.close();
    await watcher.poll();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(unhandled.length, 0);
    const warning = required(warnings[0]);
    assert.match(warning, /activity-watcher-post-skipped/);
    assert.match(warning, /send failed/);
  } finally {
    watcher.close();
    process.off("unhandledRejection", onUnhandledRejection);
    console.warn = originalWarn;
  }
});

test("watcher skips overlapping poll work", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-watcher-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.js"), "const app = true;\n");
  await execFileText("git", ["init"], { cwd: root });

  let prepareCount = 0;
  let releasePrepare: (() => void) | undefined;
  let resolvePrepareStarted: (() => void) | undefined;
  const prepareStarted = new Promise<void>((resolve) => {
    resolvePrepareStarted = resolve;
  });
  const prepareGate = new Promise<void>((resolve) => {
    releasePrepare = resolve;
  });
  const posted: ActivityWatcherPayload[] = [];
  const watcher = new ActivityWatcher({
    root,
    endpoint: "http://127.0.0.1:1/api/activity",
    intervalMs: 60_000,
    throttleMs: 0,
    prepareChanges: async () => {
      prepareCount += 1;
      required(resolvePrepareStarted)();
      await prepareGate;
    },
    postActivity: async (_endpoint, body) => {
      posted.push(body);
    },
  });

  const firstPoll = watcher.poll();
  await prepareStarted;
  const secondPoll = watcher.poll();
  const secondPollState = await Promise.race([
    secondPoll.then(() => "resolved"),
    new Promise((resolve) => setTimeout(() => resolve("pending"), 50)),
  ]);
  required(releasePrepare)();
  await Promise.allSettled([firstPoll, secondPoll]);

  assert.equal(secondPollState, "resolved");
  assert.equal(prepareCount, 1);
  assert.equal(posted.length, 1);
});

test("watcher can post pre-resolved map addresses without path resolution at the endpoint", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-watcher-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.js"), "const app = true;\n");
  await execFileText("git", ["init"], { cwd: root });
  await execFileText("git", ["add", "src/app.js"], { cwd: root });

  const posted: ActivityWatcherPayload[] = [];
  const server = createServer(async (request, response) => {
    posted.push(await readBody(request));
    response.writeHead(202, { "content-type": "application/json" });
    response.end(JSON.stringify({ accepted: true }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const watcher = startActivityWatcher({
    root,
    endpoint: `http://127.0.0.1:${serverPort(server)}/api/activity`,
    intervalMs: 60_000,
    throttleMs: 0,
    createActivityPayload: (change, { agentId, activityState }) => ({
      agentId,
      activityState,
      address: {
        level: "lineRange",
        targetType: "lineRange",
        geohash: "s00000000000",
        deepLink: `codecharter://lineRange/s00000000000?path=${encodeURIComponent(change.path)}&lines=${change.lineStart}-${change.lineEnd}`,
        breadcrumb: `${change.path}:${change.lineStart}-${change.lineEnd}`,
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        geo: { lat: 0, lon: 0, geohash: "s00000000000" },
        lineRange: { start: change.lineStart, end: change.lineEnd },
      },
      note: "pre-resolved",
    }),
  });

  try {
    watcher.close();
    await watcher.poll();
    await waitFor(() => posted.length === 1);
    const first = required(posted[0]);
    const address = objectRecord(first.address);
    const lineRange = objectRecord(address?.lineRange);
    assert.equal(first.path, undefined);
    assert.equal(address?.targetType, "lineRange");
    assert.equal(lineRange?.start, 1);
  } finally {
    watcher.close();
    server.close();
    await once(server, "close");
  }
});

async function readBody(request: IncomingMessage): Promise<ActivityWatcherPayload> {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  return activityWatcherPayloadFromValue(JSON.parse(raw));
}

function activityWatcherPayloadFromValue(value: unknown): ActivityWatcherPayload {
  const record = objectRecord(value);
  if (!record) throw new Error("Expected activity watcher payload object");
  return {
    agentId: stringFromValue(record.agentId, "unknown"),
    activityState: stringFromValue(record.activityState, "reading"),
    note: stringFromValue(record.note, ""),
    ...(typeof record.path === "string" ? { path: record.path } : {}),
    ...("address" in record ? { address: record.address } : {}),
    ...(numberProperty(record, "lineStart")),
    ...(numberProperty(record, "lineEnd")),
    ...(numberProperty(record, "columnStart")),
    ...(numberProperty(record, "columnEnd")),
  };
}

function numberProperty<K extends "lineStart" | "lineEnd" | "columnStart" | "columnEnd">(
  record: Record<string, unknown>,
  key: K,
): Partial<Record<K, number>> {
  const value = record[key];
  const result: Partial<Record<K, number>> = {};
  if (typeof value === "number") result[key] = value;
  return result;
}

function stringFromValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : null;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Timed out waiting for watcher activity");
}

function serverPort(server: Server): number {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP test server");
  return address.port;
}
