import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ensureCodecharterSkill } from "../main/init.ts";
import { ensureCodecharterGitignore, ensureLocalGitExcludes } from "../main/local-git-exclude.ts";

test("generated CodeCharter skill resolves compact prompts through local CLIs before npx", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-skill-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const { skillPath } = await ensureCodecharterSkill(root);
  const skill = await readFile(skillPath, "utf8");

  assert.match(skill, /codecharter --json resolve/);
  assert.match(skill, /\.\/node_modules\/\.bin\/codecharter/);
  assert.match(skill, /\.\/node_modules\/\.bin\/tsx core\/bin\/codecharter\.mts/);
  assert.match(
    skill,
    new RegExp(`npx --yes codecharter@${escapeRegExp(await rootPackageVersion())} --json resolve`),
  );
});

test("ensureCodecharterGitignore refuses symlinked root ignore files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-gitignore-"));
  const outside = await mkdtemp(join(tmpdir(), "codecharter-gitignore-outside-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  const outsideIgnore = join(outside, "ignore");
  await mkdir(root, { recursive: true });
  await writeFile(outsideIgnore, "outside secret\n");
  await symlink(outsideIgnore, join(root, ".gitignore"));

  await assert.rejects(ensureCodecharterGitignore(root), /symlink/);
  assert.equal(await readFile(outsideIgnore, "utf8"), "outside secret\n");
});

test("ensureLocalGitExcludes refuses symlinked git info directories", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-local-exclude-"));
  const outside = await mkdtemp(join(tmpdir(), "codecharter-local-exclude-outside-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  await writeFile(join(outside, "exclude"), "outside secret\n");
  await rm(join(root, ".git", "info"), { recursive: true, force: true });
  await symlink(outside, join(root, ".git", "info"));

  await assert.rejects(ensureLocalGitExcludes(root), /symlink/);
  assert.equal(await readFile(join(outside, "exclude"), "utf8"), "outside secret\n");
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
