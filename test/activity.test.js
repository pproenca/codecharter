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
    { deepLink: "codemap://file/s123456?path=src%2Fa.ts", bounds: { x: 0, y: 0, width: 1, height: 1 } },
    { agentId: "codex", activityState: "editing", timestamp: "2026-05-20T00:00:00.000Z" },
  );

  assert.equal(event.agentId, "codex");
  assert.equal(event.activityState, "editing");
  assert.equal(event.timestamp, "2026-05-20T00:00:00.000Z");
  assert.equal(event.address.deepLink, "codemap://file/s123456?path=src%2Fa.ts");
});

test("CLI appends Codex activity events to the shared activity stream", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemaps-activity-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "codemap.json"), JSON.stringify(sampleCodemap()));

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

  const stream = JSON.parse(await readFile(join(root, ".scratch/activity-stream.json"), "utf8"));

  assert.equal(stream.events.length, 1);
  assert.equal(stream.events[0].agentId, "codex");
  assert.equal(stream.events[0].activityState, "editing");
  assert.equal(stream.events[0].address.targetType, "lineRange");
  assert.deepEqual(stream.events[0].address.lineRange, { start: 2, end: 4 });
});

function sampleCodemap() {
  return {
    version: 1,
    mapLevels: { world: 1, region: 2, folder: 4, file: 7, code: 10, lineRange: 12 },
    folders: {},
    files: {
      "src/app.ts": {
        path: "src/app.ts",
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        geo: { lat: 0, lon: 0, geohash: "s00000000000" },
        lineCount: 10,
      },
    },
  };
}
