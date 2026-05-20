import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { startServer } from "../src/server.js";

test("serves map, tiles, selections, named places, and activity APIs", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemaps-server-"));
  await mkdir(join(root, "public"));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "public", "index.html"), "<!doctype html><title>Codemap</title>");
  await writeFile(join(root, "src", "app.ts"), "const app = true;\nexport default app;\n");
  await writeFile(join(root, "codemap.json"), JSON.stringify(sampleCodemap()));

  const server = await startServer({ root, mapPath: join(root, "codemap.json"), port: 0 });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const map = await getJson(`${baseUrl}/api/map`);
    assert.equal(Object.keys(map.files).length, 1);

    const tiles = await getJson(`${baseUrl}/api/tiles?level=file`);
    assert.equal(tiles.length, 1);

    const resolved = await getJson(`${baseUrl}/api/resolve?path=src/app.ts&lineStart=1&lineEnd=2`);
    assert.equal(resolved.targetType, "lineRange");

    const source = await getJson(`${baseUrl}/api/source?path=src/app.ts&lineStart=1&lineEnd=2`);
    assert.deepEqual(source.lines.map((line) => line.text), ["const app = true;", "export default app;"]);

    const namedPlaceResponse = await postJson(`${baseUrl}/api/named-places`, {
      name: "App Area",
      level: "file",
      geometry: { type: "rect", bounds: { x: 0, y: 0, width: 1, height: 1 } },
    });
    assert.equal(namedPlaceResponse.place.name, "App Area");
    assert.equal(namedPlaceResponse.place.resolvedTargets.length, 1);
    assert.deepEqual(namedPlaceResponse.overlaps, []);

    const accepted = await postJson(`${baseUrl}/api/activity`, {
      agentId: "codex",
      activityState: "reading",
      path: "src/app.ts",
      lineStart: 1,
      lineEnd: 2,
    });
    assert.equal(accepted.accepted, true);

    const activityStream = await waitForActivityEvent(baseUrl);
    const activity = activityStream.events.at(-1);
    assert.equal(activity.agentId, "codex");
    assert.equal(activity.address.targetType, "lineRange");

    const badActivity = await postJson(`${baseUrl}/api/activity`, {
      agentId: "codex",
      activityState: "editing",
      path: "src/missing.ts",
      lineStart: 1,
      lineEnd: 2,
    });
    assert.equal(badActivity.accepted, true);
  } finally {
    server.close();
    await once(server, "close");
  }
});

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) assert.fail(await response.text());
  return response.json();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) assert.fail(await response.text());
  return response.json();
}

async function waitForActivityEvent(baseUrl) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const activity = await getJson(`${baseUrl}/api/activity`);
    if (activity.events.length > 0) return activity;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Activity event was not persisted");
}

function sampleCodemap() {
  return {
    version: 1,
    mapLevels: { world: 1, region: 2, folder: 4, file: 7, code: 10, lineRange: 12 },
    folders: {
      "": {
        path: "",
        name: "",
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        geo: { lat: 0, lon: 0, geohash: "s00000000000" },
        lineCount: 2,
        weight: 2,
      },
      src: {
        path: "src",
        name: "src",
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        geo: { lat: 0, lon: 0, geohash: "s00000000000" },
        lineCount: 2,
        weight: 2,
      },
    },
    files: {
      "src/app.ts": {
        path: "src/app.ts",
        name: "app.ts",
        extension: ".ts",
        contentType: "code",
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        geo: { lat: 0, lon: 0, geohash: "s00000000000" },
        lineCount: 2,
        weight: 2,
      },
    },
  };
}
