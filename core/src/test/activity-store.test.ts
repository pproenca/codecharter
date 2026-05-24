import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createActivityStore } from "../main/activity-store.ts";
import type { StoredActivityEvent } from "../main/activity-store.ts";

test("clear keeps queued pre-clear events out of the archive while preserving post-clear events", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-activity-store-"));
  const beforeClearArchivePath = join(root, "before-clear.jsonl");
  const afterClearArchivePath = join(root, "after-clear.jsonl");
  const store = createActivityStore({ archivePath: beforeClearArchivePath, flushIntervalMs: 60_000 });
  t.after(async () => {
    await store.close();
    await rm(root, { recursive: true, force: true });
  });

  store.add(activityEvent("before-clear"));
  const preClearFlush = store.flush();
  const clear = store.clear();
  store.archivePath = afterClearArchivePath;
  store.add(activityEvent("after-clear"));
  const postClearFlush = store.flush();

  await Promise.all([preClearFlush, clear, postClearFlush]);

  assert.deepEqual(await archiveEventIds(beforeClearArchivePath), []);
  assert.deepEqual(await archiveEventIds(afterClearArchivePath), ["after-clear"]);
});

function activityEvent(id: string): StoredActivityEvent {
  return { id, agentId: "codex", activityState: "editing", timestamp: "2026-05-24T00:00:00.000Z" };
}

async function archiveEventIds(path: string): Promise<string[]> {
  try {
    const content = await readFile(path, "utf8");
    return content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line).id as string);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return [];
    throw error;
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
