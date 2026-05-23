import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";

import { startServer } from "../main/server.ts";

type JsonResponse = {
  events: Array<Record<string, unknown>>;
  version?: string;
  unchanged?: true;
};

test("startServer serves viewer/dist when running from source", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-server-"));
  const publicRoot = join(root, "viewer", "dist");
  await mkdir(publicRoot, { recursive: true });
  await mkdir(join(root, ".codecharter"), { recursive: true });
  await writeFile(join(publicRoot, "index.html"), "<!doctype html><title>viewer</title>");
  await writeFile(join(root, ".codecharter", "codecharter.json"), "{}");

  const server = await startServer({
    root,
    mapPath: join(root, ".codecharter", "codecharter.json"),
    port: 0,
    activityFlushIntervalMs: 0,
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
    assert.equal(await response.text(), "<!doctype html><title>viewer</title>");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await rm(root, { recursive: true, force: true });
  }
});

test("viewer activity summary omits full geometry and supports unchanged version responses", async () => {
  const root = await fixtureRoot();
  const activityArchivePath = join(root, ".scratch", "codecharter", "activity.jsonl");
  await mkdir(join(root, ".scratch", "codecharter"), { recursive: true });
  await writeFile(activityArchivePath, activityLines([
    activityEvent({
      id: "old-core",
      timestamp: "2026-05-22T10:00:00.000Z",
      path: "core/src/main/server.ts",
      fragments: 160,
    }),
    activityEvent({
      id: "live-viewer",
      timestamp: new Date().toISOString(),
      path: "viewer/src/main/app.ts",
      fragments: 120,
    }),
  ]));

  const server = await startServer({
    root,
    mapPath: join(root, ".codecharter", "codecharter.json"),
    port: 0,
    activityArchivePath,
    activityFlushIntervalMs: 0,
  });

  try {
    const url = serverUrl(server);
    const summary = await fetchJson<JsonResponse>(`${url}/api/activity?view=viewer&detail=summary`);
    const summaryText = JSON.stringify(summary);

    assert.equal(summary.events.length, 1);
    assert.equal(summary.events[0]?.id, "live-viewer");
    assert.ok(summary.version?.startsWith("summary:"), "summary version should include the detail mode");
    assert.doesNotMatch(summaryText, /fragments/);
    assert.ok(summaryText.length < 1200, `summary response should stay compact; got ${summaryText.length} bytes`);

    const unchanged = await fetchJson<JsonResponse>(`${url}/api/activity?view=viewer&detail=summary&version=${encodeURIComponent(summary.version ?? "")}`);
    assert.equal(unchanged.unchanged, true);
    assert.deepEqual(unchanged.events, []);
  } finally {
    await closeServer(server);
    await rm(root, { recursive: true, force: true });
  }
});

test("viewer activity full detail preserves trail geometry and emits compact fog markers", async () => {
  const root = await fixtureRoot();
  const activityArchivePath = join(root, ".scratch", "codecharter", "activity.jsonl");
  await mkdir(join(root, ".scratch", "codecharter"), { recursive: true });
  await writeFile(activityArchivePath, activityLines([
    activityEvent({
      id: "old-core",
      timestamp: "2026-05-22T10:00:00.000Z",
      path: "core/src/main/server.ts",
      fragments: 20,
    }),
    activityEvent({
      id: "live-viewer",
      timestamp: new Date().toISOString(),
      path: "viewer/src/main/app.ts",
      fragments: 12,
    }),
  ]));

  const server = await startServer({
    root,
    mapPath: join(root, ".codecharter", "codecharter.json"),
    port: 0,
    activityArchivePath,
    activityFlushIntervalMs: 0,
  });

  try {
    const full = await fetchJson<JsonResponse>(`${serverUrl(server)}/api/activity?view=viewer&detail=full`);
    const fogMarkers = full.events.filter((event) => event.viewerFogState);
    const liveEvent = full.events.find((event) => event.id === "live-viewer");
    const oldFog = fogMarkers.find((event) => (event.address as { path?: string } | undefined)?.path === "core/src/main/server.ts");

    assert.ok(full.version?.startsWith("full:"), "full version should include the detail mode");
    assert.ok(liveEvent, "full detail should keep live event geometry for activity trails");
    assert.ok(Array.isArray((liveEvent.address as { fragments?: unknown[] } | undefined)?.fragments));
    assert.ok(oldFog, "full detail should include historical fog markers");
    assert.equal(oldFog?.viewerFogState, "explored");
    assert.equal((oldFog?.address as { fragments?: unknown[] } | undefined)?.fragments, undefined);
  } finally {
    await closeServer(server);
    await rm(root, { recursive: true, force: true });
  }
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "codecharter-server-"));
  const publicRoot = join(root, "viewer", "dist");
  await mkdir(publicRoot, { recursive: true });
  await mkdir(join(root, ".codecharter"), { recursive: true });
  await writeFile(join(publicRoot, "index.html"), "<!doctype html><title>viewer</title>");
  await writeFile(join(root, ".codecharter", "codecharter.json"), "{}");
  return root;
}

function serverUrl(server: Server): string {
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  return await response.json() as T;
}

function activityLines(events: Array<Record<string, unknown>>): string {
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

function activityEvent({
  id,
  timestamp,
  path,
  fragments,
}: {
  id: string;
  timestamp: string;
  path: string;
  fragments: number;
}): Record<string, unknown> {
  return {
    id,
    agentId: "codex",
    sessionId: "test-session",
    activityState: "editing",
    timestamp,
    note: `activity for ${path}`,
    address: {
      path,
      geohash: "s00000000000",
      deepLink: `codecharter://file/s00000000000?path=${encodeURIComponent(path)}`,
      bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
      lineRange: { start: 1, end: 10 },
      fragments: Array.from({ length: fragments }, (_, index) => ({
        bounds: {
          x: 0.1 + index * 0.0001,
          y: 0.1,
          width: 0.001,
          height: 0.001,
        },
      })),
    },
  };
}
