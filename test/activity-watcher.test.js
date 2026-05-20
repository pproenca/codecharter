import test from "node:test";
import assert from "node:assert/strict";
import { lineRangeFromUnifiedDiff, parseGitStatusPorcelain } from "../src/activity-watcher.js";

test("parses git porcelain paths for watchable code files only", () => {
  const raw = [
    " M src/app.js",
    "?? docs/decision.md",
    "R  src/new-name.ts",
    "src/old-name.ts",
    "?? codemap.json",
    "?? .scratch/activity-stream.json",
    "?? public/logo.png",
    "?? notes.txt",
    "",
  ].join("\0");

  assert.deepEqual(parseGitStatusPorcelain(raw), [
    "src/app.js",
    "docs/decision.md",
    "src/new-name.ts",
  ]);
});

test("resolves changed line range across unified diff hunks", () => {
  const diff = [
    "diff --git a/src/app.js b/src/app.js",
    "@@ -4,0 +5,3 @@",
    "+const added = true;",
    "+const more = true;",
    "+export { added };",
    "@@ -20 +24 @@",
    "-old();",
    "+newCall();",
  ].join("\n");

  assert.deepEqual(lineRangeFromUnifiedDiff(diff), { lineStart: 5, lineEnd: 24 });
});

test("returns an empty line range when a diff has no hunks", () => {
  assert.deepEqual(lineRangeFromUnifiedDiff(""), {});
});
