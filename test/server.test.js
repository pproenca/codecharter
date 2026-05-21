import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { appendFile, mkdtemp, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { startServer } from "../src/server.js";

const execFileAsync = promisify(execFile);

test("serves map, tiles, selections, named places, and activity APIs", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemaps-server-"));
  await mkdir(join(root, "public"));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "public", "index.html"), "<!doctype html><title>Codemap</title>");
  await writeFile(join(root, "src", "app.ts"), "const app = true;\nexport default app;\n");
  await writeFile(join(root, "codecharter.json"), JSON.stringify(sampleCodemap()));

  const server = await startServer({
    root,
    mapPath: join(root, "codecharter.json"),
    port: 0,
    activityFlushIntervalMs: 20,
    publicRoot: join(root, "public"),
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const map = await getJson(`${baseUrl}/api/map`);
    assert.equal(Object.keys(map.files).length, 1);
    const mapVersion = await getJson(`${baseUrl}/api/map-version`);
    assert.equal(typeof mapVersion.version, "string");

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

    const annotationResponse = await postJson(`${baseUrl}/api/annotations`, {
      comment: "hey explore this area",
      level: "file",
      geometry: { type: "rect", bounds: { x: 0, y: 0, width: 1, height: 1 } },
    });
    assert.equal(annotationResponse.annotation.kind, "mapAnnotation");
    assert.equal(annotationResponse.annotation.name, "hey explore this area");
    assert.equal(annotationResponse.annotation.comment, "hey explore this area");
    assert.equal(annotationResponse.annotation.deepLink, `codecharter://annotation/${annotationResponse.annotation.id}`);
    assert.equal(annotationResponse.annotation.browserHash, `#/annotation/${annotationResponse.annotation.id}`);
    assert.match(annotationResponse.annotation.codexPrompt, /CodeCharter annotation: codecharter:\/\/annotation\//);
    assert.match(annotationResponse.annotation.codexPrompt, /CLI: codecharter --json annotation codecharter:\/\/annotation\//);
    assert.match(annotationResponse.annotation.codexPrompt, /Note: hey explore this area/);
    assert.doesNotMatch(annotationResponse.annotation.codexPrompt, /Browser route/);
    assert.doesNotMatch(annotationResponse.annotation.codexPrompt, /Corner geohashes/);
    assert.doesNotMatch(annotationResponse.annotation.codexPrompt, /src\/app\.ts/);
    const annotations = await getJson(`${baseUrl}/api/annotations`);
    assert.equal(annotations.annotations.length, 1);
    assert.equal(annotations.annotations[0].resolvedTargets.length, 1);
    const annotationById = await getJson(`${baseUrl}/api/annotations/${annotationResponse.annotation.id}`);
    assert.equal(annotationById.annotation.id, annotationResponse.annotation.id);

    const cliAnnotations = await runCliJson([
      "annotations",
      "--server",
      baseUrl,
      "--root",
      root,
      "--map",
      join(root, "codecharter.json"),
    ]);
    assert.equal(cliAnnotations.source, "server");
    assert.equal(cliAnnotations.count, 1);
    assert.equal(cliAnnotations.annotations[0].id, annotationResponse.annotation.id);

    const { stdout: plainAnnotation } = await execFileAsync(process.execPath, [
      join(process.cwd(), "bin", "codemap.mjs"),
      "annotation",
      `${baseUrl}/#/annotation/${annotationResponse.annotation.id}`,
      "--root",
      root,
      "--map",
      join(root, "codecharter.json"),
    ]);
    assert.match(plainAnnotation, /^annotation: /m);
    assert.match(plainAnnotation, /^targets: 1$/m);
    assert.doesNotMatch(plainAnnotation.trim(), /^\{/);

    const cliSource = await runCliJson([
      "source",
      "src/app.ts",
      "1",
      "2",
      "--root",
      root,
      "--map",
      join(root, "codecharter.json"),
    ]);
    assert.deepEqual(cliSource.lines.map((line) => line.text), ["const app = true;", "export default app;"]);

    const cliApi = await runCliJson(["api", "/api/annotations", "--server", baseUrl]);
    assert.equal(cliApi.method, "GET");
    assert.equal(cliApi.status, 200);
    assert.equal(cliApi.body.annotations.length, 1);

    await writeFile(join(root, "codecharter.json"), JSON.stringify(sampleCodemap({ includeExtraFile: true })));
    const nextMapVersion = await waitForMapVersion(baseUrl, mapVersion.version);
    assert.notEqual(nextMapVersion.version, mapVersion.version);
    const refreshedPlaces = await getJson(`${baseUrl}/api/named-places`);
    assert.equal(refreshedPlaces.places[0].resolvedTargets.length, 2);
    assert.equal(refreshedPlaces.places[1].resolvedTargets.length, 2);

    const accepted = await postJson(`${baseUrl}/api/activity`, {
      agentId: "codex",
      activityState: "reading",
      path: "src/app.ts",
      lineStart: 1,
      lineEnd: 2,
      columnStart: 7,
      columnEnd: 10,
    });
    assert.equal(accepted.accepted, true);

    const activityStream = await waitForActivityEvent(baseUrl);
    const activity = activityStream.events.at(-1);
    assert.equal(activity.agentId, "codex");
    assert.equal(activity.address.targetType, "tokenRange");
    assert.deepEqual(activity.address.tokenRange, { start: 7, end: 10 });
    const archivedActivity = await waitForActivityArchive(root);
    assert.equal(archivedActivity.at(-1).agentId, "codex");
    assert.equal(archivedActivity.at(-1).address.targetType, "tokenRange");

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

test("serves bundled UI assets when mapping a repo without its own public directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemaps-bundled-ui-"));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src", "app.ts"), "export const app = true;\n");
  await writeFile(join(root, "codecharter.json"), JSON.stringify(sampleCodemap()));

  const server = await startServer({ root, mapPath: join(root, "codecharter.json"), port: 0 });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${baseUrl}/`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /<canvas id="mapCanvas"/);

    const map = await getJson(`${baseUrl}/api/map`);
    assert.ok(map.files["src/app.ts"]);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("accepts pre-resolved activity without reading the map sidecar", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemaps-address-activity-"));
  await writeFile(join(root, "codecharter.json"), "{");

  const server = await startServer({ root, mapPath: join(root, "codecharter.json"), port: 0 });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const accepted = await postJson(`${baseUrl}/api/activity`, {
      agentId: "codex",
      activityState: "editing",
      address: sampleActivityAddress(),
    });
    assert.equal(accepted.accepted, true);

    const activityStream = await waitForActivityEvent(baseUrl);
    assert.equal(activityStream.events.at(-1).address.deepLink, "codecharter://file/s000000?path=src%2Fapp.ts");
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("serves activity written directly to the JSONL archive by Codex hooks", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemaps-archived-activity-"));
  await mkdir(join(root, ".codecharter"), { recursive: true });
  await writeFile(join(root, "codecharter.json"), JSON.stringify(sampleCodemap()));

  const server = await startServer({ root, mapPath: join(root, "codecharter.json"), port: 0 });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const archivedEvent = {
      id: "hook-event-1",
      agentId: "codex",
      activityState: "editing",
      timestamp: "2026-05-21T19:28:54.728Z",
      note: "Codex Bash activity",
      hookEventName: "PostToolUse",
      sessionId: "thread-1",
      address: sampleActivityAddress(),
    };
    await appendFile(join(root, ".codecharter", "activity.jsonl"), `${JSON.stringify(archivedEvent)}\n`);

    const activity = await getJson(`${baseUrl}/api/activity`);
    assert.equal(activity.events.length, 1);
    assert.equal(activity.events[0].id, "hook-event-1");
    assert.equal(activity.events[0].sessionId, "thread-1");
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("deletes saved map annotations", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemaps-delete-annotation-"));
  await writeFile(join(root, "codecharter.json"), JSON.stringify(sampleCodemap()));

  const server = await startServer({ root, mapPath: join(root, "codecharter.json"), port: 0 });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const created = await postJson(`${baseUrl}/api/annotations`, {
      comment: "delete me",
      level: "file",
      geometry: { type: "rect", bounds: { x: 0, y: 0, width: 1, height: 1 } },
    });

    const deleted = await deleteJson(`${baseUrl}/api/annotations/${created.annotation.id}`);
    assert.equal(deleted.deleted, true);
    assert.equal(deleted.annotation.id, created.annotation.id);

    const annotations = await getJson(`${baseUrl}/api/annotations`);
    assert.equal(annotations.annotations.length, 0);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("CLI reads annotations from a CodeCharter URL or local storage without browser automation", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemaps-cli-annotation-"));
  await writeFile(join(root, "codecharter.json"), JSON.stringify(sampleCodemap()));

  const server = await startServer({ root, mapPath: join(root, "codecharter.json"), port: 0 });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  let created;
  try {
    created = await postJson(`${baseUrl}/api/annotations`, {
      comment: "read this through the CLI",
      level: "file",
      geometry: { type: "rect", bounds: { x: 0, y: 0, width: 1, height: 1 } },
    });

    const { stdout } = await execFileAsync(process.execPath, [
      join(process.cwd(), "bin", "codemap.mjs"),
      "--json",
      "annotation",
      `${baseUrl}/#/annotation/${created.annotation.id}`,
      "--root",
      root,
      "--map",
      join(root, "codecharter.json"),
    ]);
    const result = JSON.parse(stdout);
    assert.equal(result.source, "server");
    assert.equal(result.origin, baseUrl);
    assert.equal(result.annotation.id, created.annotation.id);
    assert.equal(result.targetCount, 1);
    assert.deepEqual(result.resolvedTargets.map((target) => target.path), ["src/app.ts"]);
    assert.equal(result.annotation.codexPrompt.includes("Geohash coverage"), false);
  } finally {
    server.close();
    await once(server, "close");
  }

  const { stdout } = await execFileAsync(process.execPath, [
    join(process.cwd(), "bin", "codemap.mjs"),
    "--json",
    "annotation",
    created.annotation.deepLink,
    "--root",
    root,
    "--map",
    join(root, "codecharter.json"),
  ]);
  const offline = JSON.parse(stdout);
  assert.equal(offline.source, "storage");
  assert.equal(offline.annotation.id, created.annotation.id);
  assert.equal(offline.targetCount, 1);
  assert.deepEqual(offline.resolvedTargets.map((target) => target.path), ["src/app.ts"]);
});

test("uses the next available port when the requested port is occupied", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemaps-port-fallback-"));
  await writeFile(join(root, "codecharter.json"), JSON.stringify(sampleCodemap()));
  const blocker = await listenOnFreePort();
  const requestedPort = blocker.address().port;
  const server = await startServer({
    root,
    mapPath: join(root, "codecharter.json"),
    port: requestedPort,
    portSearchLimit: 2,
  });

  try {
    const actualPort = server.address().port;
    assert.notEqual(actualPort, requestedPort);
    const map = await getJson(`http://127.0.0.1:${actualPort}/api/map`);
    assert.ok(map.files["src/app.ts"]);
  } finally {
    const serverClosed = once(server, "close");
    const blockerClosed = once(blocker, "close");
    server.close();
    blocker.close();
    await Promise.all([serverClosed, blockerClosed]);
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

async function deleteJson(url) {
  const response = await fetch(url, { method: "DELETE" });
  if (!response.ok) assert.fail(await response.text());
  return response.json();
}

async function runCliJson(args) {
  const { stdout } = await execFileAsync(process.execPath, [
    join(process.cwd(), "bin", "codemap.mjs"),
    "--json",
    ...args,
  ]);
  return JSON.parse(stdout);
}

async function waitForActivityEvent(baseUrl) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const activity = await getJson(`${baseUrl}/api/activity`);
    if (activity.events.length > 0) return activity;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Activity event was not visible in memory");
}

async function waitForActivityArchive(root) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const raw = await readFile(join(root, ".codecharter", "activity.jsonl"), "utf8");
      const events = raw.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
      if (events.length > 0) return events;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Activity event was not archived to JSONL");
}

async function waitForMapVersion(baseUrl, previousVersion) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const mapVersion = await getJson(`${baseUrl}/api/map-version`);
    if (mapVersion.version !== previousVersion) return mapVersion;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Map version did not change");
}

function sampleActivityAddress() {
  return {
    level: "file",
    targetType: "file",
    geohash: "s000000",
    deepLink: "codecharter://file/s000000?path=src%2Fapp.ts",
    breadcrumb: "src > app.ts",
    bounds: { x: 0, y: 0, width: 1, height: 1 },
    geo: { lat: 0, lon: 0, geohash: "s000000" },
  };
}

async function listenOnFreePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server;
}

function sampleCodemap({ includeExtraFile = false } = {}) {
  return {
    version: 1,
    mapLevels: { world: 1, region: 2, folder: 4, file: 7, code: 10, lineRange: 12, tokenRange: 12 },
    folders: {
      "": {
        path: "",
        name: "",
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        geo: { lat: 0, lon: 0, geohash: "s00000000000" },
        lineCount: 2,
        maxLineLength: 19,
        weight: 2,
      },
      src: {
        path: "src",
        name: "src",
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        geo: { lat: 0, lon: 0, geohash: "s00000000000" },
        lineCount: 2,
        maxLineLength: 19,
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
        maxLineLength: 19,
        weight: 2,
      },
      ...(includeExtraFile ? {
        "src/extra.ts": {
          path: "src/extra.ts",
          name: "extra.ts",
          extension: ".ts",
          contentType: "code",
          bounds: { x: 0.2, y: 0.2, width: 0.3, height: 0.3 },
          geo: { lat: 0, lon: 0, geohash: "s11111111111" },
          lineCount: 1,
          maxLineLength: 24,
          weight: 1,
        },
      } : {}),
    },
  };
}
