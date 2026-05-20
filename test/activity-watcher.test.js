import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { lineRangeFromUnifiedDiff, parseGitStatusPorcelain, startActivityWatcher } from "../src/activity-watcher.js";

const execFileAsync = promisify(execFile);

test("parses git porcelain paths for watchable code files only", () => {
  const raw = [
    " M src/app.js",
    "?? docs/decision.md",
    "R  src/new-name.ts",
    "src/old-name.ts",
    "?? codemap.json",
    "?? .scratch/activity-stream.jsonl",
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
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(posted.length, 1);
  } finally {
    watcher.close();
    server.close();
    await once(server, "close");
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
