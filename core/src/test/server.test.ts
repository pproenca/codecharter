import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startServer } from "../main/server.ts";

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
