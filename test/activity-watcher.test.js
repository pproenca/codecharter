import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { changedRangeFromUnifiedDiff, lineRangeFromUnifiedDiff } from "../src/activity-change-range.js";
import { parseGitStatusPorcelain, startActivityWatcher } from "../src/activity-watcher.js";

const execFileAsync = promisify(execFile);

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

test("watcher prepares changed map state before posting each new diff signature", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemaps-watcher-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.js"), "const app = true;\n");
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["add", "src/app.js"], { cwd: root });

  const posted = [];
  let prepared = false;
  const server = createServer(async (request, response) => {
    assert.equal(prepared, true);
    posted.push(await readBody(request));
    response.writeHead(202, { "content-type": "application/json" });
    response.end(JSON.stringify({ accepted: true }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const watcher = startActivityWatcher({
    root,
    endpoint: `http://127.0.0.1:${server.address().port}/api/activity`,
    intervalMs: 20,
    throttleMs: 0,
    prepareChanges: async (changes) => {
      assert.equal(changes[0].path, "src/app.js");
      prepared = true;
    },
  });

  try {
    await waitFor(() => posted.length === 1);
    assert.equal(posted[0].path, "src/app.js");
    assert.deepEqual({ lineStart: posted[0].lineStart, lineEnd: posted[0].lineEnd }, { lineStart: 1, lineEnd: 1 });
    assert.deepEqual({ columnStart: posted[0].columnStart, columnEnd: posted[0].columnEnd }, { columnStart: 1, columnEnd: 17 });
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(posted.length, 1);
  } finally {
    watcher.close();
    server.close();
    await once(server, "close");
  }
});

test("watcher reports untracked code files as line ranges", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemaps-watcher-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "new-file.js"), "const first = true;\nexport const second = first;\n");
  await execFileAsync("git", ["init"], { cwd: root });

  const posted = [];
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
    assert.equal(posted[0].path, "src/new-file.js");
    assert.deepEqual(
      { lineStart: posted[0].lineStart, lineEnd: posted[0].lineEnd },
      { lineStart: 1, lineEnd: 2 },
    );
  } finally {
    watcher.close();
  }
});

test("watcher reports later edits to the same untracked file", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemaps-watcher-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "new-file.js"), "const first = true;\n");
  await execFileAsync("git", ["init"], { cwd: root });

  const posted = [];
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
    assert.deepEqual(
      { lineStart: posted[1].lineStart, lineEnd: posted[1].lineEnd },
      { lineStart: 1, lineEnd: 2 },
    );
  } finally {
    watcher.close();
  }
});

test("watcher polling does not wait for activity delivery", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemaps-watcher-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.js"), "const app = true;\n");
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["add", "src/app.js"], { cwd: root });

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

test("watcher can post pre-resolved map addresses without path resolution at the endpoint", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemaps-watcher-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.js"), "const app = true;\n");
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["add", "src/app.js"], { cwd: root });

  const posted = [];
  const server = createServer(async (request, response) => {
    posted.push(await readBody(request));
    response.writeHead(202, { "content-type": "application/json" });
    response.end(JSON.stringify({ accepted: true }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const watcher = startActivityWatcher({
    root,
    endpoint: `http://127.0.0.1:${server.address().port}/api/activity`,
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
    assert.equal(posted[0].path, undefined);
    assert.equal(posted[0].address.targetType, "lineRange");
    assert.equal(posted[0].address.lineRange.start, 1);
  } finally {
    watcher.close();
    server.close();
    await once(server, "close");
  }
});

async function readBody(request) {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  return JSON.parse(raw);
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Timed out waiting for watcher activity");
}
