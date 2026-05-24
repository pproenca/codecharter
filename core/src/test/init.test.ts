import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ensureCodecharterSkill } from "../main/init.ts";

test("generated CodeCharter skill resolves compact prompts through local CLIs before npx", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-skill-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const { skillPath } = await ensureCodecharterSkill(root);
  const skill = await readFile(skillPath, "utf8");

  assert.match(skill, /codecharter --json resolve/);
  assert.match(skill, /\.\/node_modules\/\.bin\/codecharter/);
  assert.match(skill, /\.\/node_modules\/\.bin\/tsx core\/bin\/codemap\.mts/);
  assert.match(
    skill,
    new RegExp(`npx --yes codecharter@${escapeRegExp(await rootPackageVersion())} --json resolve`),
  );
});

async function rootPackageVersion(): Promise<string> {
  const manifest = JSON.parse(
    await readFile(new URL("../../../package.json", import.meta.url), "utf8"),
  ) as { version?: unknown };
  const { version } = manifest;
  if (typeof version !== "string") {
    throw new TypeError("package.json version must be a string");
  }
  return version;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
