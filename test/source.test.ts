import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSourceRange } from "../src/source.js";

test("reads a source line range for a mapped code file", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-source-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.ts"), "one\ntwo\nthree\nfour\n");

  const source = await readSourceRange(root, {
    path: "src/app.ts",
    lineCount: 4,
  }, {
    lineStart: 2,
    lineEnd: 3,
  });

  assert.deepEqual(source.lineRange, { start: 2, end: 3 });
  assert.deepEqual(source.lines, [
    { number: 2, text: "two" },
    { number: 3, text: "three" },
  ]);
});
