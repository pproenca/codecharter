import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createActivityEvent } from "../src/activity.js";

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

test("CLI appends Codex activity events to the JSONL activity archive", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemaps-activity-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "codecharter.json"), JSON.stringify(sampleCodemap()));

  await execFileAsync("node", [
    join(process.cwd(), "bin/codemap.mjs"),
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
  const event = JSON.parse(lines[0]);

  assert.equal(lines.length, 1);
  assert.equal(event.agentId, "codex");
  assert.equal(event.activityState, "editing");
  assert.equal(event.address.targetType, "lineRange");
  assert.deepEqual(event.address.lineRange, { start: 2, end: 4 });
});

test("CLI activity can report a deterministic token-range map address", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemaps-activity-token-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "codecharter.json"), JSON.stringify(sampleCodemap()));

  await execFileAsync("node", [
    join(process.cwd(), "bin/codemap.mjs"),
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
  const event = JSON.parse(lines[0]);

  assert.equal(event.address.targetType, "tokenRange");
  assert.deepEqual(event.address.lineRange, { start: 2, end: 2 });
  assert.deepEqual(event.address.tokenRange, { start: 3, end: 8 });
  assert.match(event.address.deepLink, /columns=3-8/);
});

test("CLI resolve prints token-range map addresses", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemaps-resolve-token-"));
  await writeFile(join(root, "codecharter.json"), JSON.stringify(sampleCodemap()));

  const { stdout } = await execFileAsync("node", [
    join(process.cwd(), "bin/codemap.mjs"),
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

test("CLI activity telemetry never exits non-zero for an unmapped path", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemaps-activity-missing-"));
  await writeFile(join(root, "codecharter.json"), JSON.stringify(sampleCodemap()));

  const { stdout } = await execFileAsync("node", [
    join(process.cwd(), "bin/codemap.mjs"),
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
  const root = await mkdtemp(join(tmpdir(), "codemaps-activity-clear-"));
  await mkdir(join(root, ".codecharter"), { recursive: true });
  await writeFile(join(root, ".codecharter", "activity.jsonl"), `${JSON.stringify({ id: "event-1" })}\n`);

  const { stdout } = await execFileAsync("node", [
    join(process.cwd(), "bin/codemap.mjs"),
    "--json",
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
