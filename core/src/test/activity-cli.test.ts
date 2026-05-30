import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import type { StoredActivityEvent } from "../main/activity-store.ts";
import { startServer } from "../main/server.ts";

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const cliPath = join(repoRoot, "core", "bin", "codecharter.mts");

test("activity command can post a reading event to the running viewer server", async (t) => {
  const server = await startActivityFixtureServer(t);
  const result = await execCli([
    "--json",
    "activity",
    "scripts/build.mjs",
    "--state",
    "reading",
    "--note",
    "go explore here",
    "--server",
    serverUrl(server),
  ]);

  assert.equal(result.accepted, true);
  assert.equal(result.source, "server");
  assert.equal(result.path, "scripts/build.mjs");

  const event = await waitForActivity(server, "scripts/build.mjs");
  assert.equal(event?.activityState, "reading");
});

// CWE-918 (SSRF) — an agent-supplied full URL reference must stay on loopback;
// the CLI refuses to fetch an attacker-controlled origin and exits non-zero.
test("api command rejects a non-loopback URL reference", async () => {
  const { stdout, stderr, code } = await execCliRaw([
    "api",
    "http://attacker.example/api/map-version",
  ]);
  assert.equal(code, 1);
  assert.match(stdout + stderr, /non-loopback origin/);
});

// CWE-918 (SSRF) — a non-loopback --server is rejected before any request; the
// activity command surfaces the refusal in its result rather than fetching.
test("activity command rejects a non-loopback --server origin", async () => {
  const { stdout, stderr } = await execCliRaw([
    "--json",
    "activity",
    "scripts/build.mjs",
    "--state",
    "reading",
    "--server",
    "http://attacker.example",
  ]);
  assert.match(stdout + stderr, /non-loopback origin/);
});

async function startActivityFixtureServer(t: TestContext): Promise<Server> {
  const root = await mkdtemp(join(tmpdir(), "codecharter-activity-cli-"));
  let server: Server | null = null;
  t.after(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server?.close((error) => (error ? reject(error) : resolve())),
      );
    }
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, ".codecharter"), { recursive: true });
  await mkdir(join(root, "viewer", "dist"), { recursive: true });
  await writeFile(join(root, "viewer", "dist", "index.html"), "<!doctype html>");
  await writeFile(
    join(root, ".codecharter", "codecharter.json"),
    JSON.stringify({
      folders: {},
      files: {
        "scripts/build.mjs": {
          path: "scripts/build.mjs",
          bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
          geo: { lat: 0, lon: 0, geohash: "s00000000000" },
          lineCount: 10,
          maxLineLength: 80,
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
  return server;
}

function serverUrl(server: Server): string {
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

async function execCli(args: string[]): Promise<Record<string, any>> {
  const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
    execFile(
      process.execPath,
      ["--import", "tsx", cliPath, ...args],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`${error.message}\n${stderr}`));
        } else {
          resolve({ stdout });
        }
      },
    );
  });
  return JSON.parse(stdout);
}

// Capture raw stdout/stderr/exit code without throwing — needed to assert error
// output for commands that exit non-zero or report failure in their JSON result.
function execCliRaw(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["--import", "tsx", cliPath, ...args],
      { cwd: repoRoot, encoding: "utf8" },
      (error, stdout, stderr) => {
        const code = error && typeof error.code === "number" ? error.code : 0;
        resolve({ stdout, stderr, code });
      },
    );
  });
}

async function waitForActivity(
  server: Server,
  path: string,
): Promise<StoredActivityEvent | undefined> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const snapshot = (await fetch(`${serverUrl(server)}/api/activity`).then((response) =>
      response.json(),
    )) as { events: StoredActivityEvent[] };
    const event = snapshot.events.find((candidate) => candidate.address?.path === path);
    if (event) {
      return event;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return undefined;
}
