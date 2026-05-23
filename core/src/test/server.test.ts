import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { TestContext } from "node:test";

import { startServer } from "../main/server.ts";
import type { StoredActivityEvent } from "../main/activity-store.ts";

type ActivityJsonResponse = {
  events: StoredActivityEvent[];
  version?: string;
  unchanged?: true;
};

test("startServer serves viewer/dist when running from source", async (t) => {
  const server = await startFixtureServer(t);

  const response = await fetch(`${serverUrl(server)}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
  assert.equal(await response.text(), "<!doctype html><title>viewer</title>");
});

test("viewer activity summary omits full geometry and supports unchanged version responses", async (t) => {
  const server = await startActivityServer(t, activityScenario(160, 120));

  const url = serverUrl(server);
  const summary = await fetchActivityJson(`${url}/api/activity?view=viewer&detail=summary`);
  const summaryText = JSON.stringify(summary);

  assert.equal(summary.events.length, 1);
  assert.equal(summary.events[0]?.id, "live-viewer");
  assert.deepEqual(summary.events[0]?.address, {
    path: "viewer/src/main/app.ts",
    geohash: "s00000000000",
    deepLink: "codecharter://file/s00000000000?path=viewer%2Fsrc%2Fmain%2Fapp.ts",
    lineRange: { start: 1, end: 10 },
  });
  assert.ok(summary.version?.startsWith("summary:"), "summary version should include the detail mode");
  assert.doesNotMatch(summaryText, /fragments/);
  assert.ok(summaryText.length < 1200, `summary response should stay compact; got ${summaryText.length} bytes`);

  const unchanged = await fetchActivityJson(`${url}/api/activity?view=viewer&detail=summary&version=${encodeURIComponent(summary.version ?? "")}`);
  assert.equal(unchanged.unchanged, true);
  assert.deepEqual(unchanged.events, []);
});

test("viewer activity full detail preserves trail geometry and emits compact fog markers", async (t) => {
  const server = await startActivityServer(t, activityScenario(20, 12));

  const full = await fetchActivityJson(`${serverUrl(server)}/api/activity?view=viewer&detail=full`);
  const liveEvent = full.events.find((event) => event.id === "live-viewer");
  const oldFog = full.events.find((event) => event.viewerFogState && event.address?.path === "core/src/main/server.ts");

  assert.ok(full.version?.startsWith("full:"), "full version should include the detail mode");
  assert.ok(liveEvent, "full detail should keep live event geometry for activity trails");
  assert.ok(Array.isArray(liveEvent.address?.fragments));
  assert.ok(oldFog, "full detail should include historical fog markers");
  assert.equal(oldFog?.viewerFogState, "explored");
  assert.equal(oldFog?.address?.fragments, undefined);
});

async function startActivityServer(t: TestContext, events: readonly StoredActivityEvent[]): Promise<Server> {
  const root = await fixtureRoot();
  const activityArchivePath = join(root, ".scratch", "codecharter", "activity.jsonl");
  await mkdir(join(root, ".scratch", "codecharter"), { recursive: true });
  await writeFile(activityArchivePath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
  return startFixtureServer(t, { root, activityArchivePath });
}

async function startFixtureServer(
  t: TestContext,
  { root: providedRoot, activityArchivePath }: { root?: string; activityArchivePath?: string } = {},
): Promise<Server> {
  const root = providedRoot ?? await fixtureRoot();
  let server: Server | null = null;
  t.after(async () => {
    if (server) await closeServer(server);
    await rm(root, { recursive: true, force: true });
  });
  server = await startServer({
    root,
    mapPath: join(root, ".codecharter", "codecharter.json"),
    port: 0,
    ...(activityArchivePath === undefined ? {} : { activityArchivePath }),
    activityFlushIntervalMs: 0,
  });
  return server;
}

function activityScenario(oldCoreFragments: number, liveViewerFragments: number): StoredActivityEvent[] {
  return [
    activityEvent({
      id: "old-core",
      timestamp: "2026-05-22T10:00:00.000Z",
      path: "core/src/main/server.ts",
      fragments: oldCoreFragments,
    }),
    activityEvent({
      id: "live-viewer",
      timestamp: new Date().toISOString(),
      path: "viewer/src/main/app.ts",
      fragments: liveViewerFragments,
    }),
  ];
}

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

async function fetchActivityJson(url: string): Promise<ActivityJsonResponse> {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  return await response.json() as ActivityJsonResponse;
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
}): StoredActivityEvent {
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
