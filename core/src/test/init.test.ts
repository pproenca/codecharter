import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureCodecharterSkill } from "../main/init.ts";

test("generated CodeCharter skill resolves compact prompts through local CLIs before npx", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-skill-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const { skillPath } = await ensureCodecharterSkill(root);
  const skill = await readFile(skillPath, "utf8");

  assert.match(skill, /codecharter --json resolve/);
  assert.match(skill, /\.\/node_modules\/\.bin\/codecharter/);
  assert.match(skill, /\.\/node_modules\/\.bin\/tsx core\/bin\/codemap\.mts/);
  assert.match(skill, /npx --yes codecharter@0\.2\.0 --json resolve/);
});
