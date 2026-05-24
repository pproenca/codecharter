import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { listIncludedFiles } from "../main/scan.ts";

test("listIncludedFiles skips symlinks that resolve outside the repo", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-scan-"));
  const outside = await mkdtemp(join(tmpdir(), "codecharter-scan-outside-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  await writeFile(join(root, "safe.mjs"), "export const safe = true;\n");
  await writeFile(join(outside, "secret.mjs"), "export const secret = true;\n");
  await symlink(join(outside, "secret.mjs"), join(root, "leak.mjs"));

  assert.deepEqual(await listIncludedFiles(root), ["safe.mjs"]);
});
