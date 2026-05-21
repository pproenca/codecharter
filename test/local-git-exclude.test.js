import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { CODECHARTER_GITIGNORE_PATTERNS, ensureCodecharterGitignore, ensureLocalGitExcludes, LOCAL_CODECHARTER_EXCLUDES } from "../src/local-git-exclude.js";

const execFileAsync = promisify(execFile);

test("adds CodeCharter artifact paths to local git excludes without touching tracked ignores", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemaps-local-exclude-"));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src", "app.js"), "export const app = true;\n");
  await execFileAsync("git", ["init"], { cwd: root });

  const result = await ensureLocalGitExcludes(root);
  const exclude = await readFile(join(root, ".git", "info", "exclude"), "utf8");

  assert.deepEqual(result.patternsAdded, LOCAL_CODECHARTER_EXCLUDES);
  for (const pattern of LOCAL_CODECHARTER_EXCLUDES) assert.match(exclude, new RegExp(escapeRegExp(pattern)));

  await mkdir(join(root, ".codecharter"));
  await writeFile(join(root, ".codecharter", "activity.jsonl"), "{}\n");
  const { stdout } = await execFileAsync("git", ["status", "--short", "--", ".codecharter/activity.jsonl"], { cwd: root });
  assert.equal(stdout, "");
});

test("adds CodeCharter outputs to the repo gitignore during setup", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemaps-gitignore-"));
  await writeFile(join(root, ".gitignore"), "node_modules/\n");

  const result = await ensureCodecharterGitignore(root);
  const gitignore = await readFile(join(root, ".gitignore"), "utf8");

  assert.deepEqual(result.patternsAdded, CODECHARTER_GITIGNORE_PATTERNS);
  assert.match(gitignore, /^node_modules\/$/m);
  for (const pattern of CODECHARTER_GITIGNORE_PATTERNS) assert.match(gitignore, new RegExp(`^${escapeRegExp(pattern)}$`, "m"));

  const second = await ensureCodecharterGitignore(root);
  assert.deepEqual(second.patternsAdded, []);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
