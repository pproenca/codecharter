import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ActivityEventBuilder, ActivityStateNormalizer, createActivityEvent } from "../src/activity.js";

const execFileAsync = promisify(execFile);

test("creates timestamped agent activity events at map addresses", () => {
  const event = createActivityEvent(
    { deepLink: "codecharter://file/s123456?path=src%2Fa.ts", bounds: { x: 0, y: 0, width: 1, height: 1 } },
    { agentId: "codex", activityState: "editing", timestamp: "2026-05-20T00:00:00.000Z" },
  );

  assert.equal(event.agentId, "codex");
  assert.equal(event.activityState, "editing");
  assert.equal(event.timestamp, "2026-05-20T00:00:00.000Z");
  assert.equal(event.address.deepLink, "codecharter://file/s123456?path=src%2Fa.ts");
});

test("normalizes blocked activity to an active reviewing state", () => {
  const event = createActivityEvent(
    { deepLink: "codecharter://file/s123456?path=src%2Fa.ts", bounds: { x: 0, y: 0, width: 1, height: 1 } },
    { agentId: "codex", activityState: "blocked", timestamp: "2026-05-20T00:00:00.000Z" },
  );

  assert.equal(event.activityState, "reviewing");
});

test("preserves Codex thread identity on activity events", () => {
  const event = createActivityEvent(
    { deepLink: "codecharter://file/s123456?path=src%2Fa.ts", bounds: { x: 0, y: 0, width: 1, height: 1 } },
    {
      agentId: "codex",
      activityState: "editing",
      sessionId: "session-1",
      threadId: "019e4c43-dd59-7f30-aea5-c00e63abc63f",
      threadUri: "codex://threads/019e4c43-dd59-7f30-aea5-c00e63abc63f",
    },
  );

  assert.equal(event.sessionId, "session-1");
  assert.equal(event.threadId, "019e4c43-dd59-7f30-aea5-c00e63abc63f");
  assert.equal(event.threadUri, "codex://threads/019e4c43-dd59-7f30-aea5-c00e63abc63f");
});

test("activity class facades preserve normalization and injected builder behavior", () => {
  const normalizer = new ActivityStateNormalizer();
  const builder = new ActivityEventBuilder({ normalize: () => "testing" });
  const event = builder.create(
    { deepLink: "codecharter://file/s123456?path=src%2Fa.ts", bounds: { x: 0, y: 0, width: 1, height: 1 } },
    { id: "event-1", state: "custom", timestamp: "2026-05-20T00:00:00.000Z" },
  );

  assert.equal(normalizer.normalize("blocked"), "reviewing");
  assert.equal(normalizer.normalize("not-a-state"), "reading");
  assert.equal(event.id, "event-1");
  assert.equal(event.activityState, "testing");
});

test("CLI appends Codex activity events to the JSONL activity archive", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-activity-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "codecharter.json"), JSON.stringify(sampleCodemap()));

  await execFileAsync("node", [
    join(process.cwd(), "bin/codemap.mts"),
    "activity",
    "src/app.ts",
    "2",
    "4",
    "--agent",
    "codex",
    "--state",
    "editing",
  ], { cwd: root });

  const lines = (await readFile(join(root, ".codecharter/activity.jsonl"), "utf8")).trim().split("\n");
  const event = JSON.parse(required(lines[0]));

  assert.equal(lines.length, 1);
  assert.equal(event.agentId, "codex");
  assert.equal(event.activityState, "editing");
  assert.equal(event.address.targetType, "lineRange");
  assert.deepEqual(event.address.lineRange, { start: 2, end: 4 });
});

test("CLI activity can report a deterministic token-range map address", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-activity-token-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "codecharter.json"), JSON.stringify(sampleCodemap()));

  await execFileAsync("node", [
    join(process.cwd(), "bin/codemap.mts"),
    "activity",
    "src/app.ts",
    "2",
    "2",
    "--column-start",
    "3",
    "--column-end",
    "8",
    "--agent",
    "codex",
  ], { cwd: root });

  const lines = (await readFile(join(root, ".codecharter/activity.jsonl"), "utf8")).trim().split("\n");
  const event = JSON.parse(required(lines[0]));

  assert.equal(event.address.targetType, "tokenRange");
  assert.deepEqual(event.address.lineRange, { start: 2, end: 2 });
  assert.deepEqual(event.address.tokenRange, { start: 3, end: 8 });
  assert.match(event.address.deepLink, /columns=3-8/);
});

test("CLI resolve prints token-range map addresses", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-resolve-token-"));
  await writeFile(join(root, "codecharter.json"), JSON.stringify(sampleCodemap()));

  const { stdout } = await execFileAsync("node", [
    join(process.cwd(), "bin/codemap.mts"),
    "--json",
    "resolve",
    "src/app.ts",
    "2",
    "2",
    "--column-start",
    "3",
    "--column-end",
    "8",
  ], { cwd: root });
  const address = JSON.parse(stdout);

  assert.equal(address.targetType, "tokenRange");
  assert.deepEqual(address.tokenRange, { start: 3, end: 8 });
});

test("CLI resolve honors POSIX end-of-options before dash-prefixed paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-posix-options-"));
  const codemap = sampleCodemap();
  codemap.files["--json"] = {
    ...codemap.files["src/app.ts"],
    path: "--json",
  };
  await writeFile(join(root, "codecharter.json"), JSON.stringify(codemap));

  const { stdout } = await execFileAsync("node", [
    join(process.cwd(), "bin/codemap.mts"),
    "--json",
    "resolve",
    "--",
    "--json",
  ], { cwd: root });
  const address = JSON.parse(stdout);

  assert.equal(address.targetType, "file");
  assert.equal(address.path, "--json");
});

test("CLI resolve and activity default omitted range ends for token addresses", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-cli-token-default-"));
  await writeFile(join(root, "codecharter.json"), JSON.stringify(sampleCodemap()));

  const { stdout: resolveStdout } = await execFileAsync("node", [
    join(process.cwd(), "bin/codemap.mts"),
    "--json",
    "resolve",
    "src/app.ts",
    "2",
    "--column-start",
    "3",
    "--column-end",
    "8",
  ], { cwd: root });
  const resolvedAddress = JSON.parse(resolveStdout);

  const { stdout: activityStdout } = await execFileAsync("node", [
    join(process.cwd(), "bin/codemap.mts"),
    "--json",
    "activity",
    "src/app.ts",
    "2",
    "--column-start",
    "3",
    "--column-end",
    "8",
  ], { cwd: root });
  const activityResult = JSON.parse(activityStdout);

  assert.equal(resolvedAddress.targetType, "tokenRange");
  assert.deepEqual(resolvedAddress.lineRange, { start: 2, end: 2 });
  assert.deepEqual(resolvedAddress.tokenRange, { start: 3, end: 8 });
  assert.equal(activityResult.accepted, true);
  assert.deepEqual(activityResult.event.address.lineRange, resolvedAddress.lineRange);
  assert.deepEqual(activityResult.event.address.tokenRange, resolvedAddress.tokenRange);
});

test("CLI resolve reports the resolved address kind for deep links with range metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-resolve-link-kind-"));
  await writeFile(join(root, "codecharter.json"), JSON.stringify(sampleCodemap()));

  const { stdout } = await execFileAsync("node", [
    join(process.cwd(), "bin/codemap.mts"),
    "--json",
    "resolve",
    "codecharter://file/s000000?path=src%2Fapp.ts&lines=2-4",
  ], { cwd: root });
  const result = JSON.parse(stdout);

  assert.equal(result.kind, "lineRange");
  assert.equal(result.address.targetType, "lineRange");
  assert.deepEqual(result.address.lineRange, { start: 2, end: 4 });
});

test("CLI activity telemetry never exits non-zero for an unmapped path", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-activity-missing-"));
  await writeFile(join(root, "codecharter.json"), JSON.stringify(sampleCodemap()));

  const { stdout } = await execFileAsync("node", [
    join(process.cwd(), "bin/codemap.mts"),
    "--json",
    "activity",
    "src/missing.ts",
    "1",
    "2",
  ], { cwd: root });
  const response = JSON.parse(stdout);

  assert.equal(response.accepted, false);
  assert.match(response.error, /No map target found/);
});

test("CLI activity clear truncates the local activity archive", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-activity-clear-"));
  await mkdir(join(root, ".codecharter"), { recursive: true });
  await writeFile(join(root, ".codecharter", "activity.jsonl"), `${JSON.stringify({ id: "event-1" })}\n`);

  const { stdout } = await execFileAsync("node", [
    join(process.cwd(), "bin/codemap.mts"),
    "--json",
    "clear",
  ], { cwd: root });
  const result = JSON.parse(stdout);

  assert.equal(result.cleared, true);
  assert.equal(result.source, "archive");
  assert.equal(await readFile(join(root, ".codecharter", "activity.jsonl"), "utf8"), "");
});

test("CLI nested activity clear truncates the local activity archive", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-activity-nested-clear-"));
  await mkdir(join(root, ".codecharter"), { recursive: true });
  await writeFile(join(root, ".codecharter", "activity.jsonl"), `${JSON.stringify({ id: "event-1" })}\n`);

  const { stdout } = await execFileAsync("node", [
    join(process.cwd(), "bin/codemap.mts"),
    "--json",
    "activity",
    "clear",
  ], { cwd: root });
  const result = JSON.parse(stdout);

  assert.equal(result.cleared, true);
  assert.equal(result.source, "archive");
  assert.equal(await readFile(join(root, ".codecharter", "activity.jsonl"), "utf8"), "");
});

function sampleCodemap() {
  return {
    version: 1,
    mapLevels: { world: 1, region: 2, folder: 4, file: 7, code: 10, lineRange: 12, tokenRange: 12 },
    folders: {},
    files: {
      "src/app.ts": {
        path: "src/app.ts",
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        geo: { lat: 0, lon: 0, geohash: "s00000000000" },
        lineCount: 10,
        maxLineLength: 20,
      },
    },
  };
}

function required<T>(value: T | null | undefined): T {
  assert.ok(value);
  return value;
}
