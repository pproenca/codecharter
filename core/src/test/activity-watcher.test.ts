import assert from "node:assert/strict";
import test from "node:test";
import { parseGitStatusPorcelain } from "../main/activity-watcher.ts";

test("activity watcher ignores Codex hook files that are excluded from the codemap", () => {
  const raw = [
    " M .codex/hooks.json",
    " M .codex/hooks/codecharter-codex-hook.mjs",
    " M core/src/main/server.ts",
    "",
  ].join("\0");

  assert.deepEqual(parseGitStatusPorcelain(raw), ["core/src/main/server.ts"]);
});
