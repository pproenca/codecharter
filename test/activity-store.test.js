import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createActivityStore } from "../src/activity-store.js";

test("keeps activity hot path in memory until an explicit or timed JSONL flush", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-activity-store-"));
  const archivePath = join(root, ".scratch", "activity-stream.jsonl");
  const event = {
    id: "event-1",
    agentId: "codex",
    activityState: "editing",
    address: { targetType: "file", deepLink: "codecharter://file/s000000?path=src%2Fapp.ts", bounds: { x: 0, y: 0, width: 1, height: 1 } },
    timestamp: "2026-05-20T00:00:00.000Z",
  };
  const store = createActivityStore({ archivePath, flushIntervalMs: 60_000 });

  try {
    store.add(event);
    assert.deepEqual(store.snapshot().events, [event]);
    await assert.rejects(readFile(archivePath, "utf8"), { code: "ENOENT" });

    await store.flush();
    const lines = (await readFile(archivePath, "utf8")).trim().split("\n");
    assert.deepEqual(lines.map((line) => JSON.parse(line)), [event]);
  } finally {
    await store.close();
  }
});

test("caps the archive queue in memory without checking JSONL file size", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-activity-store-"));
  const archivePath = join(root, ".scratch", "activity-stream.jsonl");
  const store = createActivityStore({
    archivePath,
    flushIntervalMs: 60_000,
    maxArchiveQueueEvents: 2,
  });

  try {
    store.add(activityEvent("event-1"));
    store.add(activityEvent("event-2"));
    store.add(activityEvent("event-3"));

    await store.flush();
    const lines = (await readFile(archivePath, "utf8")).trim().split("\n");
    assert.deepEqual(lines.map((line) => JSON.parse(line).id), ["event-2", "event-3"]);
  } finally {
    await store.close();
  }
});

test("caps live activity memory to the newest events", async () => {
  const store = createActivityStore({
    flushIntervalMs: 60_000,
    maxMemoryEvents: 2,
  });

  try {
    store.add(activityEvent("event-1"));
    store.add(activityEvent("event-2"));
    store.add(activityEvent("event-3"));

    assert.deepEqual(store.snapshot().events.map((event) => event.id), ["event-2", "event-3"]);
  } finally {
    await store.close();
  }
});

test("returns activity snapshots without exposing the live events array", async () => {
  const store = createActivityStore({ flushIntervalMs: 60_000 });

  try {
    store.add(activityEvent("event-1"));
    const snapshot = store.snapshot();
    snapshot.events.push(activityEvent("event-2"));

    assert.deepEqual(store.snapshot().events.map((event) => event.id), ["event-1"]);
  } finally {
    await store.close();
  }
});

test("recovers failed archive flushes before later queued activity", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-activity-store-"));
  const blockedArchivePath = join(root, "blocked-archive");
  const archivePath = join(root, ".scratch", "activity-stream.jsonl");
  await mkdir(blockedArchivePath);
  const store = createActivityStore({
    archivePath: blockedArchivePath,
    flushIntervalMs: 60_000,
    maxArchiveQueueEvents: 3,
  });

  try {
    store.add(activityEvent("event-1"));
    store.add(activityEvent("event-2"));
    await assert.rejects(store.flush());

    store.archivePath = archivePath;
    store.add(activityEvent("event-3"));
    await store.flush();

    const lines = (await readFile(archivePath, "utf8")).trim().split("\n");
    assert.deepEqual(lines.map((line) => JSON.parse(line).id), ["event-1", "event-2", "event-3"]);
  } finally {
    await store.close();
  }
});

test("clears live activity and truncates the JSONL archive", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-activity-store-"));
  const archivePath = join(root, ".scratch", "activity-stream.jsonl");
  const store = createActivityStore({ archivePath, flushIntervalMs: 60_000 });

  try {
    store.add(activityEvent("event-1"));
    await store.flush();
    store.add(activityEvent("event-2"));

    await store.clear();

    assert.deepEqual(store.snapshot().events, []);
    assert.equal(await readFile(archivePath, "utf8"), "");
  } finally {
    await store.close();
  }
});

function activityEvent(id) {
  return {
    id,
    agentId: "codex",
    activityState: "editing",
    address: { targetType: "file", deepLink: `codecharter://file/${id}?path=src%2Fapp.ts`, bounds: { x: 0, y: 0, width: 1, height: 1 } },
    timestamp: "2026-05-20T00:00:00.000Z",
  };
}
