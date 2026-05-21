import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ensureLocalGitExcludes, LOCAL_SCRATCH_EXCLUDES } from "../src/local-git-exclude.js";

const execFileAsync = promisify(execFile);

test("adds scratch telemetry paths to local git excludes without touching tracked ignores", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemaps-local-exclude-"));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src", "app.js"), "export const app = true;\n");
  await execFileAsync("git", ["init"], { cwd: root });

  const result = await ensureLocalGitExcludes(root);
  const exclude = await readFile(join(root, ".git", "info", "exclude"), "utf8");

  assert.deepEqual(result.patternsAdded, LOCAL_SCRATCH_EXCLUDES);
  for (const pattern of LOCAL_SCRATCH_EXCLUDES) assert.match(exclude, new RegExp(escapeRegExp(pattern)));

  await mkdir(join(root, ".scratch"));
  await writeFile(join(root, ".scratch", "activity-stream.jsonl"), "{}\n");
  const { stdout } = await execFileAsync("git", ["status", "--short", "--", ".scratch/codecharter/activity.jsonl"], { cwd: root });
  assert.equal(stdout, "");
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
