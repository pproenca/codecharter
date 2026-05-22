import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJson, writeJson } from "../src/store.js";

test("writeJson uses unique temp files for concurrent writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-store-"));
  const path = join(root, "state.json");
  const originalNow = Date.now;
  Date.now = () => 123;

  try {
    await Promise.all([
      writeJson(path, { value: "a" }),
      writeJson(path, { value: "b" }),
    ]);
  } finally {
    Date.now = originalNow;
  }

  const saved = await readJson(path);
  assert.ok(["a", "b"].includes(saved.value));
  assert.deepEqual((await readdir(root)).filter((file) => file.endsWith(".tmp")), []);
});
