import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";
import type { StoredActivityEvent } from "../main/activity-store.ts";
import { startServer } from "../main/server.ts";

type ActivityJsonResponse = {
  events: StoredActivityEvent[];
  version?: string;
  unchanged?: true;
};
type SourceJsonResponse = {
  error?: string;
  lines?: { number: number; text: string }[];
};

test("startServer serves viewer/dist when running from source", async (t) => {
  const server = await startFixtureServer(t);

  const response = await fetch(`${serverUrl(server)}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
  assert.equal(await response.text(), "<!doctype html><title>viewer</title>");
});

test("startServer canonicalizes absolute public root overrides", async (t) => {
  const root = await fixtureRoot();
  let server: Server | null = null;
  t.after(async () => {
    if (server) {
      await closeServer(server);
    }
    await rm(root, { recursive: true, force: true });
  });
  server = await startServer({
    root,
    mapPath: join(root, ".codecharter", "codecharter.json"),
    publicRoot: `${join(root, "viewer", "dist")}/`,
    port: 0,
    activityFlushIntervalMs: 0,
  });

  const response = await fetch(`${serverUrl(server)}/`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "<!doctype html><title>viewer</title>");
});

test("startServer accepts relative root and map paths for source reads", async (t) => {
  const previousCwd = process.cwd();
  const root = await sourceFixtureRoot();
  let server: Server | null = null;
  t.after(async () => {
    if (server) {
      await closeServer(server);
    }
    process.chdir(previousCwd);
    await rm(root, { recursive: true, force: true });
  });

  process.chdir(root);
  server = await startServer({
    root: ".",
    mapPath: ".codecharter/codecharter.json",
    port: 0,
    activityFlushIntervalMs: 0,
  });

  const response = await fetch(`${serverUrl(server)}/api/source?path=scripts/build.mjs`);
  const body = (await response.json()) as SourceJsonResponse;
  assert.equal(response.status, 200);
  assert.equal(body.lines?.[0]?.text, "export const value = 1;");
});

test("invalid numeric query parameters return 400 instead of 500", async (t) => {
  const server = await startSourceServer(t);
  for (const path of [
    "/api/resolve?path=scripts/build.mjs&lineStart=1.5",
    "/api/source?path=scripts/build.mjs&lineStart=1.5",
    "/api/source?path=scripts/build.mjs&lineStart=",
    "/api/source?path=scripts/build.mjs&lineStart=%20",
    `/api/source?path=scripts/build.mjs&lineStart=${"9".repeat(400)}`,
  ]) {
    const response = await fetch(`${serverUrl(server)}${path}`);
    const body = (await response.json()) as SourceJsonResponse;
    assert.equal(response.status, 400);
    assert.match(body.error ?? "", /Query parameter must be (?:an|a safe) integer/);
  }
});

test("source reads reject symlink-backed mapped files outside the repo", async (t) => {
  const root = await sourceFixtureRoot();
  const outside = await mkdtemp(join(tmpdir(), "codecharter-outside-source-"));
  let server: Server | null = null;
  t.after(async () => {
    if (server) {
      await closeServer(server);
    }
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  await writeFile(join(outside, "secret.md"), "outside secret\n");
  await symlink(join(outside, "secret.md"), join(root, "scripts", "leak.mjs"));
  await writeFile(
    join(root, ".codecharter", "codecharter.json"),
    JSON.stringify({
      folders: {},
      files: {
        "scripts/leak.mjs": {
          path: "scripts/leak.mjs",
          bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
          geo: { lat: 0, lon: 0, geohash: "s00000000000" },
          lineCount: 1,
          maxLineLength: 14,
        },
      },
    }),
  );
  server = await startServer({
    root,
    mapPath: join(root, ".codecharter", "codecharter.json"),
    port: 0,
    activityFlushIntervalMs: 0,
  });

  const response = await fetch(`${serverUrl(server)}/api/source?path=scripts/leak.mjs`);
  const body = (await response.json()) as SourceJsonResponse;
  assert.equal(response.status, 400);
  assert.match(body.error ?? "", /escapes repository root/);
  assert.equal(JSON.stringify(body).includes("outside secret"), false);
});

// CWE-367 (positive case): a source read follows an in-root symlink to its
// resolved target and returns that target's content — proving the read uses the
// exact resolved path the containment check approved (no check/use divergence).
test("source reads follow an in-root symlink to the resolved target", async (t) => {
  const root = await sourceFixtureRoot();
  let server: Server | null = null;
  t.after(async () => {
    if (server) {
      await closeServer(server);
    }
    await rm(root, { recursive: true, force: true });
  });

  await writeFile(join(root, "scripts", "real.mjs"), "const x = 1;\nexport default x;\n");
  await symlink(join(root, "scripts", "real.mjs"), join(root, "scripts", "alias.mjs"));
  await writeFile(
    join(root, ".codecharter", "codecharter.json"),
    JSON.stringify({
      folders: {},
      files: {
        "scripts/alias.mjs": {
          path: "scripts/alias.mjs",
          bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
          geo: { lat: 0, lon: 0, geohash: "s00000000000" },
          lineCount: 2,
          maxLineLength: 18,
        },
      },
    }),
  );
  server = await startServer({
    root,
    mapPath: join(root, ".codecharter", "codecharter.json"),
    port: 0,
    activityFlushIntervalMs: 0,
  });

  const response = await fetch(`${serverUrl(server)}/api/source?path=scripts/alias.mjs`);
  const body = (await response.json()) as SourceJsonResponse & { path?: string };
  assert.equal(response.status, 200);
  assert.equal(body.lines?.[0]?.text, "const x = 1;");
  assert.equal(body.path, "scripts/alias.mjs");
});

// CWE-1321: an untrusted map key colliding with an Object prototype property
// must resolve to a clean not-found, never reaching the prototype object.
test("source/resolve treat prototype-polluting path keys as not found", async (t) => {
  const server = await startSourceServer(t);
  const url = serverUrl(server);
  for (const key of ["__proto__", "constructor", "prototype"]) {
    const source = await fetch(`${url}/api/source?path=${encodeURIComponent(key)}`);
    assert.equal(source.status, 404, `source path=${key} should be 404`);

    const resolved = await fetch(`${url}/api/resolve?path=${encodeURIComponent(key)}`);
    const body = (await resolved.json()) as SourceJsonResponse;
    assert.equal(resolved.status, 500, `resolve path=${key} should be a plain not-found`);
    assert.match(body.error ?? "", /No map target found/);
  }
});

test("API mutations reject cross-site non-JSON requests", async (t) => {
  const server = await startSourceServer(t);
  const response = await fetch(`${serverUrl(server)}/api/annotations`, {
    method: "POST",
    headers: {
      "content-type": "text/plain",
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
    },
    body: JSON.stringify(annotationBody()),
  });
  const body = (await response.json()) as SourceJsonResponse;

  assert.equal(response.status, 403);
  assert.match(body.error ?? "", /Cross-site/);

  const annotations = (await (await fetch(`${serverUrl(server)}/api/annotations`)).json()) as {
    annotations?: unknown[];
  };
  assert.deepEqual(annotations.annotations, []);
});

test("API mutations accept same-origin JSON requests", async (t) => {
  const server = await startSourceServer(t);
  const url = serverUrl(server);
  const response = await fetch(`${url}/api/annotations`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: url },
    body: JSON.stringify(annotationBody()),
  });
  const body = (await response.json()) as { annotation?: { comment?: string } };

  assert.equal(response.status, 201);
  assert.equal(body.annotation?.comment, "trusted");
});

// BR-SERVER-001 — localhost bind + Host allowlist (anti DNS-rebinding)
test("BR-SERVER-001 rejects a non-localhost Host header", async (t) => {
  const server = await startSourceServer(t);
  const forbidden = await rawGet(server, "/api/source?path=scripts/build.mjs", {
    host: "attacker.example",
  });
  assert.equal(forbidden.status, 403);

  // A loopback Host is allowed (sanity that the allowlist is not blanket-deny).
  const allowed = await rawGet(server, "/api/source?path=scripts/build.mjs", {
    host: "127.0.0.1",
  });
  assert.equal(allowed.status, 200);
});

// BR-SERVER-001 (CWE-350): fail CLOSED — a request whose Host reaches the
// handler empty must not bypass the loopback allowlist. (A truly absent Host on
// HTTP/1.1 is already rejected by Node's parser before our handler runs.)
test("BR-SERVER-001 rejects a request with an empty Host header (fail closed)", async (t) => {
  const server = await startSourceServer(t);
  const response = await rawGet(
    server,
    "/api/source?path=scripts/build.mjs",
    { host: "" },
    { setHost: false },
  );
  assert.equal(response.status, 403);
});

// CWE-697: bare and bracketed loopback IPv6 Host headers are both accepted,
// including a bare `::1` (no surrounding brackets).
test("BR-SERVER-001 accepts bare and bracketed loopback IPv6 Host headers", async (t) => {
  const server = await startSourceServer(t);
  for (const host of ["::1", "[::1]", "[::1]:8080"]) {
    const response = await rawGet(server, "/api/source?path=scripts/build.mjs", { host });
    assert.equal(response.status, 200, `Host ${host} should be allowed`);
  }
});

// BR-SERVER-004 — 1 MB request body cap
test("BR-SERVER-004 a request body over 1 MB is rejected with 413", async (t) => {
  const server = await startSourceServer(t);
  const url = serverUrl(server);
  const oversized = "x".repeat(1024 * 1024 + 1024);
  const response = await fetch(`${url}/api/annotations`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: url },
    body: JSON.stringify({ ...annotationBody(), comment: oversized }),
  });
  assert.equal(response.status, 413);
});

// BR-SERVER-006 — map validation (corrupt / foreign maps are rejected)
test("BR-SERVER-006 a corrupt or foreign map is rejected with a clear 500", async (t) => {
  for (const { map, pattern } of [
    { map: "{ not valid json", pattern: /not valid JSON/ },
    { map: JSON.stringify({ version: 1 }), pattern: /missing files\/folders/ },
  ]) {
    const root = await fixtureRoot();
    const mapPath = join(root, ".codecharter", "codecharter.json");
    await writeFile(mapPath, map);
    const server = await startServer({ root, mapPath, port: 0, activityFlushIntervalMs: 0 });
    t.after(async () => {
      await closeServer(server);
      await rm(root, { recursive: true, force: true });
    });
    const response = await fetch(`${serverUrl(server)}/api/resolve?path=src/app.ts`);
    const body = (await response.json()) as SourceJsonResponse;
    assert.equal(response.status, 500);
    assert.match(body.error ?? "", pattern);
  }
});

// BR-SERVER-008 — static file MIME allowlist + 404 for missing files
test("BR-SERVER-008 serves known MIME types, falls back to octet-stream, and 404s misses", async (t) => {
  const root = await fixtureRoot();
  const publicRoot = join(root, "viewer", "dist");
  await writeFile(join(publicRoot, "style.css"), "body{}");
  await writeFile(join(publicRoot, "data.bin"), "binary");
  const server = await startServer({
    root,
    mapPath: join(root, ".codecharter", "codecharter.json"),
    port: 0,
    activityFlushIntervalMs: 0,
  });
  t.after(async () => {
    await closeServer(server);
    await rm(root, { recursive: true, force: true });
  });
  const url = serverUrl(server);

  const css = await fetch(`${url}/style.css`);
  assert.match(css.headers.get("content-type") ?? "", /^text\/css/);

  const bin = await fetch(`${url}/data.bin`);
  assert.equal(bin.headers.get("content-type"), "application/octet-stream");

  const missing = await fetch(`${url}/nope.js`);
  assert.equal(missing.status, 404);
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
  assert.ok(
    summary.version?.startsWith("summary:"),
    "summary version should include the detail mode",
  );
  assert.doesNotMatch(summaryText, /fragments/);
  assert.ok(
    summaryText.length < 1200,
    `summary response should stay compact; got ${summaryText.length} bytes`,
  );

  const unchanged = await fetchActivityJson(
    `${url}/api/activity?view=viewer&detail=summary&version=${encodeURIComponent(summary.version ?? "")}`,
  );
  assert.equal(unchanged.unchanged, true);
  assert.deepEqual(unchanged.events, []);
});

test("viewer activity full detail preserves trail geometry and emits compact fog markers", async (t) => {
  const server = await startActivityServer(t, activityScenario(20, 12));

  const full = await fetchActivityJson(`${serverUrl(server)}/api/activity?view=viewer&detail=full`);
  const liveEvent = full.events.find((event) => event.id === "live-viewer");
  const oldFog = full.events.find(
    (event) => event.viewerFogState && event.address?.path === "core/src/main/server.ts",
  );

  assert.ok(full.version?.startsWith("full:"), "full version should include the detail mode");
  assert.ok(liveEvent, "full detail should keep live event geometry for activity trails");
  assert.ok(Array.isArray(liveEvent.address?.fragments));
  assert.ok(oldFog, "full detail should include historical fog markers");
  assert.equal(oldFog?.viewerFogState, "explored");
  assert.equal(oldFog?.address?.fragments, undefined);
});

async function startActivityServer(
  t: TestContext,
  events: readonly StoredActivityEvent[],
): Promise<Server> {
  const root = await fixtureRoot();
  const activityArchivePath = join(root, ".scratch", "codecharter", "activity.jsonl");
  await mkdir(join(root, ".scratch", "codecharter"), { recursive: true });
  await writeFile(
    activityArchivePath,
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
  );
  return startFixtureServer(t, { root, activityArchivePath });
}

async function startSourceServer(t: TestContext): Promise<Server> {
  const root = await sourceFixtureRoot();
  let server: Server | null = null;
  t.after(async () => {
    if (server) {
      await closeServer(server);
    }
    await rm(root, { recursive: true, force: true });
  });
  server = await startServer({
    root,
    mapPath: join(root, ".codecharter", "codecharter.json"),
    port: 0,
    activityFlushIntervalMs: 0,
  });
  return server;
}

async function startFixtureServer(
  t: TestContext,
  { root: providedRoot, activityArchivePath }: { root?: string; activityArchivePath?: string } = {},
): Promise<Server> {
  const root = providedRoot ?? (await fixtureRoot());
  let server: Server | null = null;
  t.after(async () => {
    if (server) {
      await closeServer(server);
    }
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

function activityScenario(
  oldCoreFragments: number,
  liveViewerFragments: number,
): StoredActivityEvent[] {
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

async function sourceFixtureRoot(): Promise<string> {
  const root = await fixtureRoot();
  await mkdir(join(root, "scripts"), { recursive: true });
  await writeFile(
    join(root, "scripts", "build.mjs"),
    "export const value = 1;\nconsole.log(value);\n",
  );
  await writeFile(
    join(root, ".codecharter", "codecharter.json"),
    JSON.stringify({
      folders: {},
      files: {
        "scripts/build.mjs": {
          path: "scripts/build.mjs",
          bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
          geo: { lat: 0, lon: 0, geohash: "s00000000000" },
          lineCount: 2,
          maxLineLength: 22,
        },
      },
    }),
  );
  return root;
}

function annotationBody(): Record<string, unknown> {
  return {
    id: "annotation-1",
    comment: "trusted",
    level: "file",
    geometry: { type: "rect", bounds: { x: 0, y: 0, width: 0.5, height: 0.5 } },
  };
}

function serverUrl(server: Server): string {
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

// Raw request so we can set the otherwise-forbidden `Host` header (fetch strips
// it). `setHost: false` suppresses Node's automatic Host header so we can assert
// the missing-Host (fail-closed) path.
function rawGet(
  server: Server,
  path: string,
  headers: Record<string, string>,
  { setHost = true }: { setHost?: boolean } = {},
): Promise<{ status: number; body: string }> {
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port: address.port, path, method: "GET", headers, setHost },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function fetchActivityJson(url: string): Promise<ActivityJsonResponse> {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  return (await response.json()) as ActivityJsonResponse;
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
